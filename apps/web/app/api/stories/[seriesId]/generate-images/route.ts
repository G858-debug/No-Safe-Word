import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { submitRunPodJob, imageUrlToBase64, buildKontextWorkflow, buildKontextIdentityPrefix, selectKontextResources, rewritePromptForFlux, buildFluxPrompt, injectFluxFemaleEnhancement } from "@no-safe-word/image-gen";
import { concatImagesHorizontally, concatImagesVertically } from "@/lib/server/image-concat";
import type { KontextWorkflowType } from "@no-safe-word/image-gen";
import type { CharacterData } from "@no-safe-word/shared";

interface QueuedJob {
  promptId: string;
  jobId: string;
}

interface FailedJob {
  promptId: string;
  error: string;
}

/** Try stored_url first; if it fails (e.g. 400/404), fall back to sfw_url */
async function fetchRefImageBase64(
  img: { stored_url?: string | null; sfw_url?: string | null } | null,
  label: string,
): Promise<string | null> {
  if (!img) return null;
  const urls = [img.stored_url, img.sfw_url].filter(Boolean) as string[];
  for (const url of urls) {
    try {
      return await imageUrlToBase64(url);
    } catch (err) {
      console.warn(`[Kontext] ${label}: failed to fetch ${url.substring(0, 60)}...: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.warn(`[Kontext] ${label}: all URLs failed`);
  return null;
}

// POST /api/stories/[seriesId]/generate-images — Batch generate story images
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const params = await props.params;
  const { seriesId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { post_id, regenerate } = body as { post_id?: string; regenerate?: boolean };

    // 1. Verify all characters in the series are approved
    const { data: storyChars, error: charsError } = await (supabase as any)
      .from("story_characters")
      .select("id, character_id, approved, approved_seed")
      .eq("series_id", seriesId) as {
        data: Array<{
          id: string;
          character_id: string;
          approved: boolean;
          approved_seed: number | null;
        }> | null;
        error: any;
      };

    if (charsError) {
      return NextResponse.json({ error: charsError.message }, { status: 500 });
    }

    if (!storyChars || storyChars.length === 0) {
      return NextResponse.json(
        { error: "No characters found for this series" },
        { status: 400 }
      );
    }

    const unapproved = storyChars.filter((sc) => !sc.approved);
    if (unapproved.length > 0) {
      return NextResponse.json(
        {
          error:
            "All characters must be approved before generating story images",
          unapproved_count: unapproved.length,
        },
        { status: 400 }
      );
    }

    // Build character_id → approved_seed map
    const seedMap = new Map<string, number | null>();
    storyChars.forEach((sc) => {
      seedMap.set(sc.character_id, sc.approved_seed);
    });

    // 2. Find target posts
    let postIds: string[];
    if (post_id) {
      // Verify the post belongs to this series
      const { data: post } = await supabase
        .from("story_posts")
        .select("id")
        .eq("id", post_id)
        .eq("series_id", seriesId)
        .single();

      if (!post) {
        return NextResponse.json(
          { error: "Post not found in this series" },
          { status: 404 }
        );
      }
      postIds = [post_id];
    } else {
      const { data: posts } = await supabase
        .from("story_posts")
        .select("id")
        .eq("series_id", seriesId);

      postIds = (posts || []).map((p) => p.id);
    }

    if (postIds.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 3a. If regenerate flag is set, reset "generated" prompts back to "pending"
    //     so they get picked up by the batch generation below.
    if (regenerate) {
      await supabase
        .from("story_image_prompts")
        .update({ status: "pending", image_id: null })
        .in("post_id", postIds)
        .eq("status", "generated");
    }

    // 3. Fetch pending/stuck image prompts for those posts
    //    Include "generating" and "failed" so stuck prompts from previous attempts get retried
    const { data: prompts, error: promptsError } = await supabase
      .from("story_image_prompts")
      .select("id, post_id, image_type, position, character_name, character_id, secondary_character_name, secondary_character_id, prompt")
      .in("post_id", postIds)
      .in("status", ["pending", "generating", "failed"]);

    if (promptsError) {
      return NextResponse.json(
        { error: promptsError.message },
        { status: 500 }
      );
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, jobs: [] });
    }

    // 4. Pre-fetch all linked characters (primary + secondary) for building CharacterData
    const characterIds = Array.from(
      new Set(
        prompts
          .flatMap((p) => [p.character_id, p.secondary_character_id])
          .filter((id): id is string => id !== null)
      )
    );

    const characterDataMap = new Map<string, CharacterData>();
    if (characterIds.length > 0) {
      const { data: characters } = await supabase
        .from("characters")
        .select("id, name, description")
        .in("id", characterIds);

      if (characters) {
        for (const char of characters) {
          const desc = char.description as Record<string, string>;
          const resolvedGender = (['male', 'female', 'non-binary', 'other'].includes(desc.gender) ? desc.gender : 'female') as CharacterData["gender"];
          if (!desc.gender || desc.gender !== resolvedGender) {
            console.warn(`[StoryImage] Character ${char.name} (${char.id}): desc.gender=${JSON.stringify(desc.gender)}, resolved to "${resolvedGender}"`);
          } else {
            console.log(`[StoryImage] Character ${char.name} (${char.id}): gender="${resolvedGender}"`);
          }
          characterDataMap.set(char.id, {
            name: char.name,
            gender: resolvedGender,
            ethnicity: desc.ethnicity || "",
            bodyType: desc.bodyType || "",
            hairColor: desc.hairColor || "",
            hairStyle: desc.hairStyle || "",
            eyeColor: desc.eyeColor || "",
            skinTone: desc.skinTone || "",
            distinguishingFeatures: desc.distinguishingFeatures || "",
            clothing: desc.clothing || "",
            pose: desc.pose || "",
            expression: desc.expression || "",
            age: desc.age || "",
          });
        }
      }
    }

    // Empty character for prompts not linked to a character
    const emptyCharacter: CharacterData = {
      name: "",
      gender: "female",
      ethnicity: "",
      bodyType: "",
      hairColor: "",
      hairStyle: "",
      eyeColor: "",
      skinTone: "",
      distinguishingFeatures: "",
      clothing: "",
      pose: "",
      expression: "",
      age: "",
    };

    // 5. Generate each image sequentially with delays
    const jobs: QueuedJob[] = [];
    const failed: FailedJob[] = [];
    let skipped = 0;

    for (let i = 0; i < prompts.length; i++) {
      const imgPrompt = prompts[i];
      try {
        // Mark as generating
        await supabase
          .from("story_image_prompts")
          .update({ status: "generating" })
          .eq("id", imgPrompt.id);

        // Determine mode based on image_type
        const isNsfw = imgPrompt.image_type === "website_nsfw_paired";
        const mode: "sfw" | "nsfw" = isNsfw ? "nsfw" : "sfw";

        // Get character data and seed
        const charData = imgPrompt.character_id
          ? characterDataMap.get(imgPrompt.character_id) || emptyCharacter
          : emptyCharacter;

        // Calculate seed: approved_seed + position for consistency, or random
        let seed = -1;
        if (imgPrompt.character_id) {
          const approvedSeed = seedMap.get(imgPrompt.character_id);
          if (approvedSeed != null && approvedSeed > 0) {
            seed = approvedSeed + imgPrompt.position;
          }
        }
        if (seed === -1) {
          seed = Math.floor(Math.random() * 2_147_483_647) + 1;
        }

        const hasSecondary = !!imgPrompt.secondary_character_id;

        // Determine Kontext workflow type
        const kontextType: KontextWorkflowType = !imgPrompt.character_id
          ? "portrait"
          : hasSecondary
            ? "dual"
            : "single";

        // Determine SFW vs NSFW
        const sfwMode = imgPrompt.image_type !== "website_nsfw_paired";

        // Fetch reference images for character consistency
        let kontextImages: Array<{ name: string; image: string }> = [];

        if (kontextType !== "portrait" && imgPrompt.character_id) {
          // Fetch both face portrait and full-body reference for single-character scenes
          const { data: sc } = await supabase
            .from("story_characters")
            .select("approved_image_id, approved_fullbody_image_id")
            .eq("series_id", seriesId)
            .eq("character_id", imgPrompt.character_id)
            .single();

          const charName = characterDataMap.get(imgPrompt.character_id)?.name || imgPrompt.character_name || "Unknown";

          if (kontextType === "single") {
            // Single-character scene: require BOTH face + body, stitch vertically
            if (!sc?.approved_image_id || !sc?.approved_fullbody_image_id) {
              throw new Error(
                `Character "${charName}" requires both a face portrait and body shot to be approved before generating scene images. Please approve both in Stage 8.`
              );
            }

            // Fetch both image URLs in parallel (with fallback from stored_url → sfw_url)
            const [{ data: faceImg }, { data: bodyImg }] = await Promise.all([
              supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_image_id).single(),
              supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_fullbody_image_id).single(),
            ]);

            const [faceBase64, bodyBase64] = await Promise.all([
              fetchRefImageBase64(faceImg, `${charName} face`),
              fetchRefImageBase64(bodyImg, `${charName} body`),
            ]);

            if (!faceBase64 || !bodyBase64) {
              throw new Error(
                `Character "${charName}" has approved image IDs but the images could not be fetched. Face: ${faceBase64 ? "OK" : "failed"}, Body: ${bodyBase64 ? "OK" : "failed"}.`
              );
            }

            const combinedBase64 = await concatImagesVertically(faceBase64, bodyBase64, 768);
            kontextImages.push({ name: "primary_ref.png", image: combinedBase64 });
            console.log(`[Kontext][${imgPrompt.id}] Combined face + body ref images vertically for "${charName}"`);
          } else {
            // Dual-character scene: use face + full-body reference for primary character (same as single scenes)
            // so ReferenceLatent sees the approved body proportions, not just the face.
            console.log(`[Kontext][${imgPrompt.id}] Dual scene: fetching primary ref for "${charName}" (face: ${sc?.approved_image_id || 'NONE'}, body: ${sc?.approved_fullbody_image_id || 'NONE'})`);
            if (sc?.approved_image_id) {
              if (sc.approved_fullbody_image_id) {
                // Prefer face+body vertical stitch to anchor body proportions in ReferenceLatent
                const [{ data: faceImg }, { data: bodyImg }] = await Promise.all([
                  supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_image_id).single(),
                  supabase.from("images").select("stored_url, sfw_url").eq("id", sc.approved_fullbody_image_id).single(),
                ]);
                const [faceBase64, bodyBase64] = await Promise.all([
                  fetchRefImageBase64(faceImg, `${charName} face`),
                  fetchRefImageBase64(bodyImg, `${charName} body`),
                ]);
                if (faceBase64 && bodyBase64) {
                  const stitchedBase64 = await concatImagesVertically(faceBase64, bodyBase64, 512);
                  kontextImages.push({ name: "primary_ref.png", image: stitchedBase64 });
                  console.log(`[Kontext][${imgPrompt.id}] Primary ref: face+body vertically stitched (${Math.round(stitchedBase64.length / 1024)}KB base64)`);
                } else if (faceBase64) {
                  kontextImages.push({ name: "primary_ref.png", image: faceBase64 });
                  console.warn(`[Kontext][${imgPrompt.id}] Primary ref: face only (body fetch failed)`);
                }
              } else {
                // Fall back to face-only if no full-body approved yet
                const { data: img } = await supabase
                  .from("images")
                  .select("stored_url, sfw_url")
                  .eq("id", sc.approved_image_id)
                  .single();
                const primaryRefBase64 = await fetchRefImageBase64(img, `${charName} primary`);
                if (primaryRefBase64) {
                  kontextImages.push({ name: "primary_ref.png", image: primaryRefBase64 });
                  console.warn(`[Kontext][${imgPrompt.id}] Primary ref: face only — no approved_fullbody_image_id for "${charName}"`);
                }
              }
            } else {
              console.warn(`[Kontext][${imgPrompt.id}] WARNING: Primary character "${charName}" has no approved_image_id for dual scene`);
            }
          }
        }

        if (kontextType === "dual" && imgPrompt.secondary_character_id) {
          const secondaryName = characterDataMap.get(imgPrompt.secondary_character_id)?.name || imgPrompt.secondary_character_name || "Unknown";
          console.log(`[Kontext][${imgPrompt.id}] Dual scene: fetching secondary ref for "${secondaryName}" (character_id: ${imgPrompt.secondary_character_id})`);

          const { data: sc2 } = await supabase
            .from("story_characters")
            .select("approved_image_id")
            .eq("series_id", seriesId)
            .eq("character_id", imgPrompt.secondary_character_id)
            .single();

          console.log(`[Kontext][${imgPrompt.id}] Secondary "${secondaryName}" approved_image_id: ${sc2?.approved_image_id || 'NONE'}`);

          if (sc2?.approved_image_id) {
            const { data: img2 } = await supabase
              .from("images")
              .select("stored_url, sfw_url")
              .eq("id", sc2.approved_image_id)
              .single();

            const secondaryRefBase64 = await fetchRefImageBase64(img2, `${secondaryName} secondary`);
            if (secondaryRefBase64) {
              kontextImages.push({ name: "secondary_ref.png", image: secondaryRefBase64 });
              console.log(`[Kontext][${imgPrompt.id}] Secondary ref loaded (${Math.round(secondaryRefBase64.length / 1024)}KB base64)`);
            }
          } else {
            console.warn(`[Kontext][${imgPrompt.id}] WARNING: Secondary character "${secondaryName}" has no approved_image_id — no reference image for identity`);
          }
        }

        // For dual scenes: combine both ref images into one server-side
        if (kontextType === "dual" && kontextImages.length === 2) {
          try {
            const combined = await concatImagesHorizontally(kontextImages[0].image, kontextImages[1].image);
            kontextImages = [{ name: "combined_ref.png", image: combined }];
            console.log(`[Kontext][${imgPrompt.id}] Combined primary + secondary ref images server-side`);
          } catch (err) {
            console.warn(`[Kontext][${imgPrompt.id}] Failed to combine ref images, using primary only:`, err instanceof Error ? err.message : err);
            kontextImages = [kontextImages[0]];
          }
        }

        // Kontext dimensions: portrait-oriented by default, landscape for wide/establishing shots
        const isLandscape = /\b(wide|establishing|panoram)/i.test(imgPrompt.prompt);
        const kontextWidth = isLandscape ? 1216 : 832;
        const kontextHeight = isLandscape ? 832 : 1216;

        const refImageName = kontextType === "dual"
          ? (kontextImages[0]?.name || "combined_ref.png")
          : kontextType !== "portrait" ? "primary_ref.png" : undefined;

        // Build character identity prefix for Kontext prompts (natural-language prose)
        let identityPrefix = "";
        if (imgPrompt.character_id) {
          identityPrefix = buildKontextIdentityPrefix(charData);
          if (identityPrefix) {
            console.log(`[Kontext][${imgPrompt.id}] Identity prefix for primary character: ${identityPrefix.trim()}`);
          }
        }
        if (imgPrompt.secondary_character_id) {
          const secondaryCharData = characterDataMap.get(imgPrompt.secondary_character_id);
          if (secondaryCharData) {
            const secondaryPrefix = buildKontextIdentityPrefix(secondaryCharData);
            if (secondaryPrefix) {
              identityPrefix += `The second person in this scene is: ${secondaryPrefix}`;
              console.log(`[Kontext][${imgPrompt.id}] Identity prefix for secondary character: ${secondaryPrefix.trim()}`);
            }
          }
        }

        // Inject female attractiveness enhancement for Flux.
        // This adds beauty/body prose to the identity prefix since Flux has no negative prompt
        // enforcement and no emphasis weights — all attractiveness must come from positive text.
        const primaryIsFemale = charData?.gender === 'female';
        if (primaryIsFemale && identityPrefix) {
          identityPrefix = injectFluxFemaleEnhancement(identityPrefix, mode, imgPrompt.prompt);
        }

        // For dual-character interaction scenes, redirect camera gaze to interpersonal gaze.
        // Use plain text (no emphasis weights) since Flux's T5 doesn't support them.
        let sceneForFlux = imgPrompt.prompt;
        if (hasSecondary) {
          sceneForFlux = sceneForFlux.replace(
            /\(([^,)]+),\s*looking (directly )?(at|into) (the )?camera(:[0-9.]+)?\)/gi,
            (_, expr) => `${expr}, looking at the other person`,
          );
          // Also catch unweighted variants
          sceneForFlux = sceneForFlux.replace(
            /looking (directly )?(at|into) (the )?camera/gi,
            'looking at the other person',
          );
        }

        // Build Flux-native prompt: strip SDXL syntax, enhance gaze descriptions,
        // add atmosphere suffix, then flag if LLM rewriting is still needed.
        const { prompt: fluxPrompt, needsLlmRewrite } = buildFluxPrompt(
          identityPrefix, sceneForFlux, { mode, hasDualCharacter: hasSecondary },
        );
        let kontextPositivePrompt = fluxPrompt;

        console.log(`[Kontext][${imgPrompt.id}] Pre-rewrite prompt (${kontextPositivePrompt.length} chars, needsLlmRewrite=${needsLlmRewrite}):`);
        console.log(`  ${kontextPositivePrompt.substring(0, 300)}`);
        console.log(`[Kontext][${imgPrompt.id}] Ref images: ${kontextImages.length}, refImageName: ${refImageName || 'NONE'}, type: ${kontextType}`);

        // Only invoke the LLM rewriter when the prompt still has heavy SDXL tag formatting
        // that the deterministic stripper couldn't convert to natural language.
        if (needsLlmRewrite) {
          const rewrittenPrompt = await rewritePromptForFlux(kontextPositivePrompt, sfwMode);
          if (rewrittenPrompt !== kontextPositivePrompt) {
            kontextPositivePrompt = rewrittenPrompt;
            console.log(`[Kontext][${imgPrompt.id}] Prompt rewritten by LLM for Flux`);
          }
        } else {
          console.log(`[Kontext][${imgPrompt.id}] Prompt is already natural language — skipping LLM rewrite`);
        }

        // Persist the final prompt back to the DB row
        if (kontextPositivePrompt !== imgPrompt.prompt) {
          await supabase
            .from("story_image_prompts")
            .update({ prompt: kontextPositivePrompt })
            .eq("id", imgPrompt.id);
        }

        // Select Kontext LoRAs — scene-aware selection based on gender, SFW/NSFW, shot type
        const primaryGenderForKontext = (charData?.gender as 'male' | 'female') || 'female';
        const secondaryCharDataForKontext = imgPrompt.secondary_character_id
          ? characterDataMap.get(imgPrompt.secondary_character_id)
          : undefined;
        const secondaryGenderForKontext = secondaryCharDataForKontext?.gender as 'male' | 'female' | undefined;
        const { loras: kontextLoras } = selectKontextResources({
          gender: primaryGenderForKontext,
          secondaryGender: secondaryGenderForKontext,
          isSfw: sfwMode,
          imageType: imgPrompt.image_type,
          prompt: imgPrompt.prompt,
          hasDualCharacter: hasSecondary,
        });
        console.log(`[Kontext][${imgPrompt.id}] LoRAs (${primaryGenderForKontext}, sfw=${sfwMode}, dual=${hasSecondary}): ${kontextLoras.map(l => `${l.filename}@${l.strengthModel}`).join(', ')}`);

        // Inject Kontext LoRA trigger words that aren't already present in the prompt.
        // Some Flux LoRAs require their trigger word in the prompt to activate.
        const kontextTriggerRegistry: Record<string, string> = {
          'fc-flux-perfect-busts.safetensors': 'woman',
          'flux-two-people-kissing.safetensors': 'kissing',
          'boudoir-style-flux.safetensors': 'boud01rstyle',
          'flux-fashion-editorial.safetensors': 'flux-fash',
          'flux-beauty-skin.safetensors': 'mdlnbaytskn',
        };
        for (const lora of kontextLoras) {
          const trigger = kontextTriggerRegistry[lora.filename];
          if (trigger && !new RegExp(`\\b${trigger}\\b`, 'i').test(kontextPositivePrompt)) {
            kontextPositivePrompt = `${trigger}, ${kontextPositivePrompt}`;
            console.log(`[Kontext][${imgPrompt.id}] Injected trigger word "${trigger}" for ${lora.filename}`);
          }
        }

        // Build Kontext workflow — uses identity-prefixed scene prompt
        const kontextWorkflow = buildKontextWorkflow({
          type: kontextType,
          positivePrompt: kontextPositivePrompt,
          width: kontextWidth,
          height: kontextHeight,
          seed,
          filenamePrefix: `kontext_${imgPrompt.id.substring(0, 8)}`,
          sfwMode,
          primaryRefImageName: refImageName,
          loras: kontextLoras,
        });

        console.log(`[Kontext][${imgPrompt.id}] type=${kontextType}, sfw=${sfwMode}, dims=${kontextWidth}x${kontextHeight}, refs=${kontextImages.length}, loras=${kontextLoras.length}`);

        // Submit to RunPod
        const { jobId: kontextJobId } = await submitRunPodJob(
          kontextWorkflow,
          kontextImages.length > 0 ? kontextImages : undefined,
        );

        // Create image record
        const { data: kontextImageRow, error: kontextImgError } = await supabase
          .from("images")
          .insert({
            character_id: imgPrompt.character_id || null,
            prompt: kontextPositivePrompt,
            negative_prompt: "",
            settings: {
              width: kontextWidth,
              height: kontextHeight,
              steps: 20,
              cfg: kontextType === "portrait" ? 1.0 : 2.5,
              seed,
              engine: "runpod-kontext",
              workflowType: kontextType,
            },
            mode,
          })
          .select("id")
          .single();

        if (kontextImgError || !kontextImageRow) {
          throw new Error(`Failed to create image record: ${kontextImgError?.message}`);
        }

        await supabase.from("generation_jobs").insert({
          job_id: `runpod-${kontextJobId}`,
          image_id: kontextImageRow.id,
          status: "pending",
          cost: 0,
        });

        await supabase
          .from("story_image_prompts")
          .update({ image_id: kontextImageRow.id })
          .eq("id", imgPrompt.id);

        jobs.push({
          promptId: imgPrompt.id,
          jobId: `runpod-${kontextJobId}`,
        });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        // Mark as failed and continue with the rest
        await supabase
          .from("story_image_prompts")
          .update({ status: "failed" })
          .eq("id", imgPrompt.id);

        const message = err instanceof Error ? err.message : "Unknown error";

        console.error(
          `Failed to generate image for prompt ${imgPrompt.id}:`,
          message
        );
        failed.push({ promptId: imgPrompt.id, error: message });

        if (i < prompts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return NextResponse.json({
      queued: jobs.length,
      skipped,
      failed: failed.length,
      jobs,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error("Batch image generation failed:", err);
    return NextResponse.json(
      {
        error: "Batch generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
