import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import {
  generateFlux2Image,
  imageUrlToBase64,
} from "@no-safe-word/image-gen";

// Node.js runtime. imageUrlToBase64 uses Buffer, and the Flux 2 Dev
// client imports native modules transitively. No behavioural change —
// this matches the implicit runtime the route was already running on.
export const runtime = "nodejs";

// ============================================================
// POST /api/stories/[seriesId]/generate-cover
// ============================================================
// Cover-image generation. Model-locked to Flux 2 Dev regardless of
// story_series.image_model — this bypasses the model-aware dispatcher
// in /api/stories/[seriesId]/generate-image on purpose (see
// CLAUDE.md's "Hard rule — cover generation is model-locked"). Do not
// route covers through the dispatcher.
//
// Default behavior: fires 4 parallel Flux 2 Dev jobs producing
// 4 variants at 1024×1536. Resets any previous cover state.
//
// Partial retry: if the body provides `retryVariants: [N, ...]`, only
// those indices are regenerated. Other slots in cover_variants are
// preserved. This is how the UI's per-slot "Retry missing variants"
// affordance works.
//
// Reference images: we match on role name (protagonist, love_interest)
// rather than positional/order-based selection, because covers are
// always compositions of those two roles specifically — a `supporting`
// character approved second should not silently become the cover
// reference. See docs/data-integrity-debt.md for the related structural
// hardening note.
// ============================================================

const COVER_WIDTH = 1024;
const COVER_HEIGHT = 1536;
const VARIANT_COUNT = 4;

type GenerateCoverBody = {
  prompt?: string;
  retryVariants?: number[];
};

// Default cover prompt template — documentation / reference only. The UI
// has its own placeholder string. Next.js route files cannot export
// non-route symbols, so this stays local.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const COVER_PROMPT_TEMPLATE =
  "Two-character intimate composition. " +
  "[Protagonist: reference image conditions appearance; describe her clothing, pose, and emotional register]. " +
  "[Love interest: full physical description from his prose_description, plus his clothing, pose, and expression]. " +
  "[Intimate physical contact: how their bodies relate in space — who is closer to the camera, where hands are, where eyes are directed]. " +
  "[Lighting source: named specifically — candlelight, single amber lamp, window light, etc.]. " +
  "[Setting: specific South African location detail]. " +
  "[Brand colour motif woven naturally into wardrobe, lighting, or set dressing — crimson, burgundy, amber, or gold]. " +
  "Subjects composed in the upper two-thirds of the frame with compositional breathing room in the lower third. " +
  "Cinematic shallow depth of field. Rich shadows with luminous highlights. Soft skin glow. Intimate framing. " +
  "Editorial photography quality. Photorealistic.";

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: GenerateCoverBody = {};
  try {
    body = (await request.json()) as GenerateCoverBody;
  } catch {
    // Empty body is allowed (means: full regenerate, use persisted prompt)
  }

  const retryVariants = Array.isArray(body.retryVariants)
    ? Array.from(new Set(body.retryVariants)).filter(
        (i) => Number.isInteger(i) && i >= 0 && i < VARIANT_COUNT
      )
    : undefined;
  const isPartialRetry = retryVariants !== undefined && retryVariants.length > 0;

  // 1. Load series
  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select(
      "id, slug, cover_prompt, cover_status, cover_variants, cover_base_url, cover_selected_variant, cover_sizes"
    )
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  // 2. Precondition: cover_status must not be in an in-flight state
  if (series.cover_status === "generating" || series.cover_status === "compositing") {
    return NextResponse.json(
      {
        error:
          series.cover_status === "generating"
            ? "Cover is currently generating. Wait for variants to complete or cancel the job before regenerating."
            : "Cover is currently compositing. Wait for compositing to finish before regenerating.",
      },
      { status: 400 }
    );
  }

  // 3. Resolve effective prompt
  if (body.prompt !== undefined && body.prompt.trim().length === 0) {
    return NextResponse.json(
      { error: "Prompt override is empty. Omit it to use the persisted cover_prompt, or provide a non-empty string." },
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

  // 4. Persist the prompt override (full regenerate only — partial retries
  //    reuse the already-persisted prompt as-is)
  if (body.prompt && !isPartialRetry) {
    await supabase
      .from("story_series")
      .update({ cover_prompt: effectivePrompt })
      .eq("id", seriesId);
  }

  // 5. Resolve references by canonical role name
  //
  //    Role matching rationale: approved characters in a series can include
  //    supporting and antagonist roles; order-based selection ("first two
  //    approved") would silently pick a supporting character as the cover
  //    reference. Covers are always compositions of the protagonist +
  //    (optionally) the love interest, so we match those exact role strings.
  const { data: approvedChars, error: charsErr } = await supabase
    .from("story_characters")
    .select("id, character_id, role, approved_image_id")
    .eq("series_id", seriesId)
    .eq("approved", true);

  if (charsErr) {
    return NextResponse.json(
      { error: `Failed to load characters: ${charsErr.message}` },
      { status: 500 }
    );
  }

  const protagonists = (approvedChars ?? []).filter((c) => c.role === "protagonist");
  const loveInterests = (approvedChars ?? []).filter((c) => c.role === "love_interest");

  if (protagonists.length === 0) {
    return NextResponse.json(
      {
        error:
          "Cover generation requires an approved protagonist portrait. Complete character approval first.",
      },
      { status: 400 }
    );
  }
  if (protagonists.length >= 2) {
    return NextResponse.json(
      {
        error: `Series has ${protagonists.length} approved protagonists. Cover generation requires exactly one. Check the import data or the characters tab.`,
      },
      { status: 400 }
    );
  }
  if (loveInterests.length >= 2) {
    return NextResponse.json(
      {
        error: `Series has ${loveInterests.length} approved love interests. Cover generation supports at most one. Check the import data.`,
      },
      { status: 400 }
    );
  }

  const protagonist = protagonists[0];
  const loveInterest = loveInterests[0];

  // 6. Resolve portrait URLs
  const portraitIds = [protagonist.approved_image_id, loveInterest?.approved_image_id].filter(
    (id): id is string => Boolean(id)
  );
  if (portraitIds.length === 0 || !protagonist.approved_image_id) {
    return NextResponse.json(
      {
        error:
          "Cover generation requires an approved protagonist portrait. Complete character approval first.",
      },
      { status: 400 }
    );
  }

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

  const protagonistUrl = urlById.get(protagonist.approved_image_id);
  if (!protagonistUrl) {
    return NextResponse.json(
      { error: "Protagonist portrait image URL is missing. Re-approve the portrait and retry." },
      { status: 400 }
    );
  }

  const loveInterestUrl = loveInterest?.approved_image_id
    ? urlById.get(loveInterest.approved_image_id)
    : undefined;

  // Observability: when love_interest is absent, log so we can spot
  // covers that silently went single-reference.
  if (!loveInterestUrl) {
    console.log(
      "[generate-cover] protagonist_only mode",
      JSON.stringify({
        seriesId,
        coverGenerationMode: "protagonist_only",
        approvedCharacterCount: approvedChars?.length ?? 0,
      })
    );
  }

  // 7. Base64-encode references (matches scene generator pattern)
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

  // 8. Determine which variant indices to generate
  const variantIndices: number[] = isPartialRetry
    ? retryVariants!.slice().sort((a, b) => a - b)
    : Array.from({ length: VARIANT_COUNT }, (_, i) => i);

  // 9. Reset / update cover state
  //    - Full regenerate: null out everything downstream of generation
  //    - Partial retry: null out only the retry slots; keep the rest
  let newCoverVariants: (string | null)[];
  if (isPartialRetry) {
    const existing = (series.cover_variants as (string | null)[] | null) ?? Array(VARIANT_COUNT).fill(null);
    newCoverVariants = Array.from({ length: VARIANT_COUNT }, (_, i) =>
      variantIndices.includes(i) ? null : existing[i] ?? null
    );
  } else {
    newCoverVariants = Array(VARIANT_COUNT).fill(null);
  }

  const updatePayload: Record<string, unknown> = {
    cover_variants: newCoverVariants,
    cover_status: "generating",
    cover_error: null,
  };
  if (!isPartialRetry) {
    updatePayload.cover_base_url = null;
    updatePayload.cover_selected_variant = null;
    updatePayload.cover_sizes = null;
  }

  const { error: updErr } = await supabase
    .from("story_series")
    .update(updatePayload)
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to reset cover state: ${updErr.message}` },
      { status: 500 }
    );
  }

  // 10. Fire N parallel Flux 2 Dev jobs (ComfyUI batch_size is hardcoded
  //     to 1 in the workflow builder, so 4 variants = 4 jobs).
  const jobIds: string[] = [];
  const failures: Array<{ variantIndex: number; message: string }> = [];

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

      // Create the images row with cover-variant provenance settings.
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

  // 11. If every requested variant failed to submit, set cover_status=failed.
  //     Partial submission failures are tolerated — the status endpoint will
  //     resolve the final state when the remaining jobs complete.
  if (failures.length === variantIndices.length) {
    await supabase
      .from("story_series")
      .update({
        cover_status: "failed",
        cover_error: failures.map((f) => `variant ${f.variantIndex}: ${f.message}`).join("; "),
      })
      .eq("id", seriesId);

    return NextResponse.json(
      {
        error: "All cover variant submissions failed",
        details: failures,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      jobIds,
      coverStatus: "generating",
      variantIndices,
      ...(failures.length > 0 ? { submissionFailures: failures } : {}),
    },
    { status: 202 }
  );
}
