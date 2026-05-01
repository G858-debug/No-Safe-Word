import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  generateFlux2Image,
  submitSirayImage,
  imageUrlToBase64,
} from "@no-safe-word/image-gen";
import { getPortraitUrlsForScene } from "@/lib/server/get-portrait-urls";
import { logEvent } from "@/lib/server/events";

export const runtime = "nodejs";

// ============================================================
// POST /api/stories/[seriesId]/generate-cover
// ============================================================
// Generates 4 cover variants. Model selection mirrors the story's
// image_model setting:
//   flux2_dev  → 4 async RunPod jobs (ComfyUI + PuLID reference images)
//   hunyuan3   → 4 async Siray jobs (portrait_prompt_locked text +
//                approved portrait URLs as i2i reference images). Both
//                paths return jobIds + cover_status='generating'; the
//                client polls /api/status/{jobId} until cover_variants
//                fill in.
//
// Partial retry: body.retryVariants: number[] regenerates only those slots.
// ============================================================

const COVER_WIDTH = 1024;
const COVER_HEIGHT = 1536;
const VARIANT_COUNT = 4;

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
    | { approved_image_id: string | null }
    | { approved_image_id: string | null }[]
    | null;
};

function baseChar(c: CharWithBase) {
  return Array.isArray(c.characters) ? c.characters[0] : c.characters;
}
function approvedImageId(c: CharWithBase) {
  return baseChar(c)?.approved_image_id ?? null;
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
      "id, slug, cover_prompt, cover_status, cover_variants, cover_base_url, cover_selected_variant, cover_sizes, image_model, cover_secondary_character_id"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  // 2. Guard in-flight states
  if (series.cover_status === "compositing") {
    return NextResponse.json(
      { error: "Cover is currently compositing. Wait for compositing to finish before regenerating." },
      { status: 400 }
    );
  }

  if (series.cover_status === "generating") {
    // Identify variants currently being generated so we can decide whether
    // this request conflicts with in-flight work.
    const { data: activeJobs } = await supabase
      .from("generation_jobs")
      .select("variant_index")
      .eq("series_id", seriesId)
      .eq("job_type", "cover_variant")
      .in("status", ["pending", "processing"]);
    const activeIndices = new Set(
      (activeJobs ?? [])
        .map((j) => j.variant_index)
        .filter((i): i is number => typeof i === "number")
    );

    if (isPartialRetry) {
      // Partial retries can run concurrently with in-flight jobs as long as
      // the SPECIFIC slots being retried aren't already active. Lets the user
      // queue multiple per-slot retries from the dashboard without waiting
      // for the first one to finish.
      const conflicting = retryVariants!.filter((i) => activeIndices.has(i));
      if (conflicting.length > 0) {
        const plural = conflicting.length > 1;
        return NextResponse.json(
          {
            error: `Variant${plural ? "s" : ""} ${conflicting.join(", ")} ${plural ? "are" : "is"} already generating. Wait for ${plural ? "those slots" : "that slot"} to complete before retrying.`,
          },
          { status: 400 }
        );
      }
      // No conflict — fall through; the partial-retry path below will submit
      // jobs for the requested slots while leaving the active ones alone.
    } else if (activeIndices.size > 0) {
      // Full regenerate while jobs are in flight — refuse.
      return NextResponse.json(
        { error: "Cover is currently generating. Wait for variants to complete before regenerating." },
        { status: 400 }
      );
    } else {
      // No active jobs — cover_status='generating' is stale. Recover:
      // If any variants already exist and this is a full regeneration request,
      // restore to variants_ready so the user can retry only the missing slots
      // instead of discarding existing results.
      const existingVariants = (series.cover_variants as (string | null)[] | null) ?? [];
      const hasAnyVariant = existingVariants.some(Boolean);

      if (hasAnyVariant) {
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

      // No variants at all — full regenerate falls through.
      console.log(`[generate-cover] auto-recovering stuck 'generating' state for series ${seriesId}`);
    }
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

  // 4. Persist prompt override whenever the client supplies one — partial
  // retries (per-slot Retry, "Generate N Variants" with some slots filled)
  // need the textarea content to apply just like full regenerates do.
  // Without this, edits in the textarea are silently dropped on partial
  // retries: the server falls back to the previously-saved cover_prompt
  // and the user gets art that doesn't match what they typed.
  if (body.prompt) {
    await supabase
      .from("story_series")
      .update({ cover_prompt: effectivePrompt })
      .eq("id", seriesId);
  }

  // 5. Resolve protagonist + love_interest with portraits
  const { data: seriesChars, error: charsErr } = await supabase
    .from("story_characters")
    .select(
      "id, character_id, role, characters:character_id ( approved_image_id )"
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

  // Secondary character resolution:
  //   - If story_series.cover_secondary_character_id is set, use that
  //     character (must be linked to this series and have an approved
  //     portrait). Lets a series feature a non-love_interest character
  //     on the cover (e.g. a workshop scene with a supporting character)
  //     without mutating the global role assignments that drive scene
  //     generation.
  //   - Otherwise, fall back to the love_interest role.
  const secondaryOverrideId = series.cover_secondary_character_id ?? null;
  let loveInterest: CharWithBase | undefined;
  if (secondaryOverrideId) {
    loveInterest = approvedChars.find(
      (c) => c.character_id === secondaryOverrideId
    );
    if (!loveInterest) {
      return NextResponse.json(
        {
          error:
            "Selected cover character has no approved portrait or is not linked to this series. Re-approve their portrait or clear the cover-character override and try again.",
        },
        { status: 400 }
      );
    }
    if (loveInterest.character_id === protagonist.character_id) {
      return NextResponse.json(
        { error: "Secondary cover character must be different from the protagonist." },
        { status: 400 }
      );
    }
  } else {
    loveInterest = loveInterests[0];
  }

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
}): Promise<NextResponse> {
  const { seriesId, slug, effectivePrompt, protagonist, loveInterest, variantIndices } = args;

  // Model-aware injection rule (Hunyuan / cover) on Siray:
  //   - Identity flows ONLY through i2i reference images (Siray's
  //     instruct-i2i variant has strong pixel-level identity
  //     conditioning — once the protagonist's approved portrait is
  //     passed as a reference image, the model produces that face
  //     reliably without needing text identity prompts).
  //   - The cover prompt textarea is sent VERBATIM to Siray. No
  //     character blocks injected, no visual signature appended. What
  //     the user sees in the dashboard is exactly what Siray gets,
  //     which is critical for editing wardrobe/pose/composition for a
  //     specific cover scene without competing against the original
  //     portrait's clothing description.
  void protagonist;
  void loveInterest;

  const referenceImageUrls = await getPortraitUrlsForScene([
    protagonist.character_id,
    loveInterest?.character_id,
  ]);

  console.log("[generate-cover:hunyuan] submitting", {
    seriesId,
    variants: variantIndices,
    promptLength: effectivePrompt.length,
    referenceImageCount: referenceImageUrls.length,
  });

  // Async submit-and-register, all 4 variants in PARALLEL. Siray's async-
  // submit endpoint validates and ingests reference image URLs server-side
  // before returning the task_id, which can take 10–30s per call when i2i
  // references are present. Doing this sequentially with `await` in a
  // for-loop blew past the proxy's ~120s budget on cold paths and left
  // story_series.cover_status='generating' with zero generation_jobs rows
  // because the route was killed before the failure-handler ran. Running
  // them concurrently keeps tail latency at ~30s, well inside the budget.
  //
  // Each task's status route + siray-cover-variant-handler upload the image,
  // write the URL into story_series.cover_variants[N], and advance
  // cover_status when the last variant settles.
  const settled = await Promise.allSettled(
    variantIndices.map(async (variantIndex) => {
      const submitted = await submitSirayImage({
        prompt: effectivePrompt,
        aspectRatio: "4:5",
        referenceImageUrls,
      });

      const { data: imageRow, error: imgErr } = await supabase
        .from("images")
        .insert({
          prompt: effectivePrompt,
          settings: {
            model: "hunyuan3",
            provider: "siray",
            siray_model: submitted.model,
            siray_task_id: submitted.taskId,
            purpose: "cover_variant",
            series_id: seriesId,
            variant_index: variantIndex,
            aspect_ratio: "4:5",
            size: submitted.size,
            reference_image_count: submitted.referenceImageCount,
          },
          mode: "sfw",
        })
        .select("id")
        .single();

      if (imgErr || !imageRow) {
        throw new Error(`Failed to create image record: ${imgErr?.message ?? "unknown"}`);
      }

      const jobId = `siray-${submitted.taskId}`;
      const { error: jobErr } = await supabase.from("generation_jobs").insert({
        job_id: jobId,
        image_id: imageRow.id,
        status: "pending",
        cost: 0,
        job_type: "cover_variant",
        variant_index: variantIndex,
        series_id: seriesId,
      });

      if (jobErr) {
        throw new Error(`Failed to register Siray cover job: ${jobErr.message}`);
      }

      return { variantIndex, jobId };
    })
  );

  const jobIds: string[] = [];
  const submissionFailures: Array<{ variantIndex: number; message: string }> = [];

  for (let i = 0; i < settled.length; i++) {
    const variantIndex = variantIndices[i];
    const result = settled[i];
    if (result.status === "fulfilled") {
      jobIds.push(result.value.jobId);
    } else {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(
        `[generate-cover:hunyuan] variant ${variantIndex} submission failed:`,
        message
      );
      submissionFailures.push({ variantIndex, message });
      await logEvent({
        eventType: "cover.variant_failed",
        metadata: {
          series_id: seriesId,
          slug,
          variant_index: variantIndex,
          model: "hunyuan3",
          error: message,
        },
      });
    }
  }

  if (submissionFailures.length === variantIndices.length) {
    await supabase
      .from("story_series")
      .update({
        cover_status: "failed",
        cover_error: submissionFailures
          .map((f) => `variant ${f.variantIndex}: ${f.message}`)
          .join("; "),
      })
      .eq("id", seriesId);

    return NextResponse.json(
      { error: "All cover variant submissions failed", details: submissionFailures },
      { status: 500 }
    );
  }

  return NextResponse.json({
    jobIds,
    coverStatus: "generating",
    variantIndices,
    model: "hunyuan3",
    ...(submissionFailures.length > 0 ? { submissionFailures } : {}),
  });
}
