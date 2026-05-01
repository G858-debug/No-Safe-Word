import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  generateFlux2Image,
  generateSceneImage,
  assembleHunyuanPrompt,
  imageUrlToBase64,
  resolvePortraitText,
  type PortraitCharacterDescription,
} from "@no-safe-word/image-gen";
import { uploadRemoteImageToStorage } from "@/lib/server/upload-generated-image";
import { getPortraitUrlsForScene } from "@/lib/server/get-portrait-urls";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";

// ============================================================
// POST /api/stories/[seriesId]/generate-cover
// ============================================================
// Generates 4 cover variants. Model selection mirrors the story's
// image_model setting:
//   flux2_dev  → 4 async RunPod jobs (ComfyUI + PuLID reference images)
//   hunyuan3   → 4 synchronous Siray calls (portrait_prompt_locked text +
//                approved portrait URLs as i2i reference images)
//
// Partial retry: body.retryVariants: number[] regenerates only those slots.
// ============================================================

const COVER_WIDTH = 1024;
const COVER_HEIGHT = 1536;
const VARIANT_COUNT = 4;
const COVER_BUCKET = "story-covers";

type GenerateCoverBody = {
  prompt?: string;
  retryVariants?: number[];
};

// ── Shared character type (both pipelines use the same DB query) ──
type CharWithBase = {
  id: string;
  character_id: string;
  role: string | null;
  characters:
    | {
        approved_image_id: string | null;
        portrait_prompt_locked: string | null;
        description: unknown;
      }
    | {
        approved_image_id: string | null;
        portrait_prompt_locked: string | null;
        description: unknown;
      }[]
    | null;
};

function baseChar(c: CharWithBase) {
  return Array.isArray(c.characters) ? c.characters[0] : c.characters;
}
function approvedImageId(c: CharWithBase) {
  return baseChar(c)?.approved_image_id ?? null;
}
function portraitPromptLocked(c: CharWithBase): string | null {
  return baseChar(c)?.portrait_prompt_locked ?? null;
}
function charDescription(c: CharWithBase): PortraitCharacterDescription {
  const d = baseChar(c)?.description;
  return (d && typeof d === "object" ? d : {}) as PortraitCharacterDescription;
}

// Resolve the character's text prompt for Hunyuan injection. Delegates to
// the shared resolver in @no-safe-word/image-gen so cover and scene routes
// derive their character text from the same source of truth.
function resolveCharacterBlock(c: CharWithBase): string {
  return resolvePortraitText(portraitPromptLocked(c), charDescription(c));
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: GenerateCoverBody = {};
  try {
    body = (await request.json()) as GenerateCoverBody;
  } catch {
    // Empty body → full regenerate, use persisted prompt
  }

  const retryVariants = Array.isArray(body.retryVariants)
    ? Array.from(new Set(body.retryVariants)).filter(
        (i) => Number.isInteger(i) && i >= 0 && i < VARIANT_COUNT
      )
    : undefined;
  const isPartialRetry = retryVariants !== undefined && retryVariants.length > 0;

  // 1. Load series (include image_model for pipeline branching)
  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(
      "id, slug, cover_prompt, cover_status, cover_variants, cover_base_url, cover_selected_variant, cover_sizes, image_model"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  // 2. Guard in-flight states
  if (series.cover_status === "generating" || series.cover_status === "compositing") {
    if (series.cover_status === "compositing") {
      return NextResponse.json(
        { error: "Cover is currently compositing. Wait for compositing to finish before regenerating." },
        { status: 400 }
      );
    }

    // For 'generating': allow retrying if there are no pending RunPod jobs
    // for this series. Hunyuan never creates generation_jobs rows, so a
    // stuck Hunyuan request leaves cover_status='generating' forever.
    // Flux jobs that time out have the same problem once their jobs expire.
    const { count: pendingJobCount } = await supabase
      .from("generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("series_id", seriesId)
      .eq("job_type", "cover_variant")
      .in("status", ["pending"]);

    if ((pendingJobCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cover is currently generating. Wait for variants to complete before regenerating." },
        { status: 400 }
      );
    }

    // No pending jobs — state is stale. Recover:
    // If any variants already exist and this is a full regeneration request,
    // restore to variants_ready so the user can retry only the missing slots
    // instead of discarding existing results.
    const existingVariants = (series.cover_variants as (string | null)[] | null) ?? [];
    const hasAnyVariant = existingVariants.some(Boolean);

    if (hasAnyVariant && !isPartialRetry) {
      await supabase
        .from("story_series")
        .update({ cover_status: "variants_ready", cover_error: null })
        .eq("id", seriesId);
      return NextResponse.json(
        {
          error:
            "Previous generation was interrupted. Existing variants have been restored — hover over a variant to regenerate individual slots, or click Generate 4 Variants to start fresh.",
          coverStatus: "variants_ready",
        },
        { status: 409 }
      );
    }

    // No variants at all (or explicit partial retry) — fall through.
    console.log(`[generate-cover] auto-recovering stuck 'generating' state for series ${seriesId}`);
  }

  // 3. Resolve effective prompt
  if (body.prompt !== undefined && body.prompt.trim().length === 0) {
    return NextResponse.json(
      { error: "Prompt override is empty. Omit it to use the persisted cover_prompt." },
      { status: 400 }
    );
  }

  const effectivePrompt = body.prompt?.trim() || series.cover_prompt || "";
  if (!effectivePrompt) {
    return NextResponse.json(
      {
        error:
          "No cover prompt available. Add one in the cover approval screen or re-import the story with marketing.cover_prompt set.",
      },
      { status: 400 }
    );
  }

  // 4. Persist prompt override on full regenerate
  if (body.prompt && !isPartialRetry) {
    await supabase
      .from("story_series")
      .update({ cover_prompt: effectivePrompt })
      .eq("id", seriesId);
  }

  // 5. Resolve protagonist + love_interest with portraits
  const { data: seriesChars, error: charsErr } = await supabase
    .from("story_characters")
    .select(
      "id, character_id, role, characters:character_id ( approved_image_id, portrait_prompt_locked, description )"
    )
    .eq("series_id", seriesId);

  if (charsErr) {
    return NextResponse.json(
      { error: `Failed to load characters: ${charsErr.message}` },
      { status: 500 }
    );
  }

  const approvedChars = ((seriesChars ?? []) as unknown as CharWithBase[]).filter(
    (c) => approvedImageId(c) !== null
  );
  const protagonists = approvedChars.filter((c) => c.role === "protagonist");
  const loveInterests = approvedChars.filter((c) => c.role === "love_interest");

  if (protagonists.length === 0) {
    return NextResponse.json(
      { error: "Cover generation requires an approved protagonist portrait. Complete character approval first." },
      { status: 400 }
    );
  }
  if (protagonists.length >= 2) {
    return NextResponse.json(
      { error: `Series has ${protagonists.length} approved protagonists. Cover generation requires exactly one.` },
      { status: 400 }
    );
  }
  if (loveInterests.length >= 2) {
    return NextResponse.json(
      { error: `Series has ${loveInterests.length} approved love interests. Cover generation supports at most one.` },
      { status: 400 }
    );
  }

  const protagonist = protagonists[0];
  const loveInterest = loveInterests[0];

  // 6. Determine variant indices
  const variantIndices: number[] = isPartialRetry
    ? retryVariants!.slice().sort((a, b) => a - b)
    : Array.from({ length: VARIANT_COUNT }, (_, i) => i);

  // 7. Reset cover state
  let newCoverVariants: (string | null)[];
  if (isPartialRetry) {
    const existing = (series.cover_variants as (string | null)[] | null) ?? Array(VARIANT_COUNT).fill(null);
    newCoverVariants = Array.from({ length: VARIANT_COUNT }, (_, i) =>
      variantIndices.includes(i) ? null : existing[i] ?? null
    );
  } else {
    newCoverVariants = Array(VARIANT_COUNT).fill(null);
  }

  const resetPayload: Record<string, unknown> = {
    cover_variants: newCoverVariants,
    cover_status: "generating",
    cover_error: null,
  };
  if (!isPartialRetry) {
    resetPayload.cover_base_url = null;
    resetPayload.cover_selected_variant = null;
    resetPayload.cover_sizes = null;
  }

  const { error: updErr } = await supabase
    .from("story_series")
    .update(resetPayload)
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to reset cover state: ${updErr.message}` },
      { status: 500 }
    );
  }

  // 8. Branch on image model
  const imageModel = (series.image_model as string | null) ?? "flux2_dev";

  await logEvent({
    eventType: "cover.variant_generation_started",
    metadata: {
      series_id: seriesId,
      slug: series.slug,
      model: imageModel,
      variant_count: variantIndices.length,
      partial_retry: isPartialRetry,
    },
  });

  if (imageModel === "hunyuan3") {
    return generateHunyuanCover({
      seriesId,
      slug: series.slug as string,
      effectivePrompt,
      protagonist,
      loveInterest,
      variantIndices,
      existingVariants: newCoverVariants,
    });
  }

  // ── Flux 2 Dev path (async RunPod) ──────────────────────────────

  // Resolve portrait URLs for reference images
  const portraitIds = [approvedImageId(protagonist), loveInterest ? approvedImageId(loveInterest) : null].filter(
    (id): id is string => Boolean(id)
  );

  const { data: portraitImages, error: imagesErr } = await supabase
    .from("images")
    .select("id, stored_url, sfw_url")
    .in("id", portraitIds);

  if (imagesErr) {
    return NextResponse.json(
      { error: `Failed to load portraits: ${imagesErr.message}` },
      { status: 500 }
    );
  }

  const urlById = new Map<string, string>();
  for (const img of portraitImages ?? []) {
    const url = img.stored_url ?? img.sfw_url ?? null;
    if (url) urlById.set(img.id, url);
  }

  const protagonistUrl = urlById.get(approvedImageId(protagonist)!);
  if (!protagonistUrl) {
    return NextResponse.json(
      { error: "Protagonist portrait image URL is missing. Re-approve the portrait and retry." },
      { status: 400 }
    );
  }

  const loveInterestUrl = loveInterest && approvedImageId(loveInterest)
    ? urlById.get(approvedImageId(loveInterest)!)
    : undefined;

  if (!loveInterestUrl) {
    console.log("[generate-cover] protagonist_only mode", { seriesId });
  }

  const references: Array<{ name: string; base64: string }> = [
    {
      name: `ref_protagonist_${protagonist.character_id}.jpeg`,
      base64: await imageUrlToBase64(protagonistUrl),
    },
  ];
  if (loveInterestUrl && loveInterest?.character_id) {
    references.push({
      name: `ref_love_interest_${loveInterest.character_id}.jpeg`,
      base64: await imageUrlToBase64(loveInterestUrl),
    });
  }

  const jobIds: string[] = [];
  const failures: Array<{ variantIndex: number; message: string }> = [];

  // Model-aware injection rule (Flux 2 Dev / cover): NO character text.
  // Identity is carried by the PuLID reference images above. The same rule
  // applies to the Flux scene path; the Hunyuan covers branch (above, when
  // image_model === 'hunyuan3') is the opposite — text-only identity.
  for (const variantIndex of variantIndices) {
    try {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const result = await generateFlux2Image({
        scenePrompt: effectivePrompt,
        references,
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
        seed,
        filenamePrefix: `cover_${series.slug}_v${variantIndex}`,
      });

      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          prompt: result.prompt,
          settings: {
            model: "flux2_dev",
            provider: "runpod",
            purpose: "cover_variant",
            series_id: seriesId,
            variant_index: variantIndex,
            seed: result.seed,
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
          },
          mode: "sfw",
        })
        .select("id")
        .single();

      if (imgErr || !imageRow) {
        throw new Error(`Failed to create image record: ${imgErr?.message ?? "unknown"}`);
      }

      const { error: jobErr } = await supabase.from("generation_jobs").insert({
        job_id: result.jobId,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
        job_type: "cover_variant",
        variant_index: variantIndex,
        series_id: seriesId,
      });

      if (jobErr) {
        throw new Error(`Failed to register job: ${jobErr.message}`);
      }

      jobIds.push(result.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error submitting job";
      console.error(`[generate-cover] variant ${variantIndex} submission failed:`, message);
      failures.push({ variantIndex, message });
    }
  }

  if (failures.length === variantIndices.length) {
    await supabase
      .from("story_series")
      .update({
        cover_status: "failed",
        cover_error: failures.map((f) => `variant ${f.variantIndex}: ${f.message}`).join("; "),
      })
      .eq("id", seriesId);

    return NextResponse.json(
      { error: "All cover variant submissions failed", details: failures },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      jobIds,
      coverStatus: "generating",
      variantIndices,
      model: "flux2_dev",
      ...(failures.length > 0 ? { submissionFailures: failures } : {}),
    },
    { status: 202 }
  );
}

// ── Hunyuan cover generation (synchronous Siray) ────────────────

async function generateHunyuanCover(args: {
  seriesId: string;
  slug: string;
  effectivePrompt: string;
  protagonist: CharWithBase;
  loveInterest: CharWithBase | undefined;
  variantIndices: number[];
  existingVariants: (string | null)[];
}): Promise<NextResponse> {
  const { seriesId, slug, effectivePrompt, protagonist, loveInterest, variantIndices, existingVariants } = args;

  // Model-aware injection rule (Hunyuan / cover) on Siray: BOTH channels.
  //   - Character text from `portrait_prompt_locked` is injected verbatim
  //     (unlike scenes, covers keep the portrait composition language —
  //     a cover IS a posed portrait, so framing/lighting from the locked
  //     prompt aligns with the artifact we're producing).
  //   - The approved portrait URLs are also passed as i2i reference images
  //     to reinforce identity through pixels.
  const protagonistBlock = resolveCharacterBlock(protagonist);
  const loveInterestBlock = loveInterest ? resolveCharacterBlock(loveInterest) : undefined;

  const referenceImageUrls = await getPortraitUrlsForScene([
    protagonist.character_id,
    loveInterest?.character_id,
  ]);

  // Pre-assemble the prompt once — it's identical across all variants.
  const assembledPrompt = assembleHunyuanPrompt({
    scenePrompt: effectivePrompt,
    characterBlock: protagonistBlock,
    secondaryCharacterBlock: loveInterestBlock,
    aspectRatio: "2:3",
  });

  console.log("[generate-cover:hunyuan] starting", {
    seriesId,
    variants: variantIndices,
    protagonistBlock: protagonistBlock.slice(0, 80),
    hasLoveInterest: Boolean(loveInterestBlock),
    referenceImageCount: referenceImageUrls.length,
  });

  const results = await Promise.allSettled(
    variantIndices.map(async (variantIndex) => {
      const generatedUrl = await generateSceneImage(
        assembledPrompt,
        referenceImageUrls,
        "2:3"
      );

      const storagePath = `${slug}/variants/variant-${variantIndex}.jpeg`;
      const variantUrl = await uploadRemoteImageToStorage(
        generatedUrl,
        storagePath,
        COVER_BUCKET,
        { cacheControl: "public, max-age=60" }
      );

      // Provenance row
      const { data: imageRow } = await supabase
        .from("images")
        .insert({
          prompt: assembledPrompt,
          settings: {
            model: "hunyuan3",
            provider: "siray",
            siray_model: "hunyuan3-instruct",
            purpose: "cover_variant",
            series_id: seriesId,
            variant_index: variantIndex,
            aspect_ratio: "2:3",
            reference_image_count: referenceImageUrls.length,
          },
          mode: "sfw",
        })
        .select("id")
        .single();

      if (imageRow) {
        await supabase
          .from("images")
          .update({ stored_url: variantUrl, sfw_url: variantUrl })
          .eq("id", imageRow.id);
      }

      console.log(`[generate-cover:hunyuan] variant ${variantIndex} done: ${variantUrl}`);
      return { variantIndex, url: variantUrl };
    })
  );

  // Merge results into the variants array
  const finalVariants: (string | null)[] = [...existingVariants];
  const errorSummaries: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      finalVariants[r.value.variantIndex] = r.value.url;
      await logEvent({
        eventType: "cover.variant_generated",
        metadata: {
          series_id: seriesId,
          slug,
          variant_index: r.value.variantIndex,
          model: "hunyuan3",
        },
      });
    } else {
      const err = r.reason as { variantIndex?: number; message?: string } | Error;
      const idx = (err as { variantIndex?: number }).variantIndex ?? null;
      const msg = err instanceof Error ? err.message : String(err);
      errorSummaries.push(`variant ${idx ?? "?"}: ${msg}`);
      console.error(`[generate-cover:hunyuan] variant ${idx ?? "?"} failed:`, msg);
      await logEvent({
        eventType: "cover.variant_failed",
        metadata: {
          series_id: seriesId,
          slug,
          variant_index: idx,
          model: "hunyuan3",
          error: msg,
        },
      });
    }
  }

  const succeeded = finalVariants.filter(Boolean).length;

  if (succeeded === 0) {
    await supabase
      .from("story_series")
      .update({
        cover_status: "failed",
        cover_variants: finalVariants,
        cover_error: errorSummaries.join("; ") || "All cover variants failed",
      })
      .eq("id", seriesId);

    return NextResponse.json(
      { error: "All cover variants failed", details: errorSummaries },
      { status: 500 }
    );
  }

  await supabase
    .from("story_series")
    .update({
      cover_status: "variants_ready",
      cover_variants: finalVariants,
      cover_error: errorSummaries.length > 0 ? errorSummaries.join("; ") : null,
    })
    .eq("id", seriesId);

  return NextResponse.json({
    coverStatus: "variants_ready",
    jobIds: [],
    variantIndices,
    model: "hunyuan3",
    ...(errorSummaries.length > 0 ? { partialFailures: errorSummaries } : {}),
  });
}
