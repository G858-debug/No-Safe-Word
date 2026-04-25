import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { fireAndForgetInternalPost } from "@/lib/server/fire-and-forget";

// ============================================================
// POST /api/stories/[seriesId]/approve-cover
// ============================================================
// Records the user's variant selection and promotes it to base.png.
// Uses Supabase Storage's server-side copy (no re-download + re-upload)
// so variants remain in place and the user can change their mind
// without re-triggering generation.
//
// Valid from cover_status IN ('variants_ready', 'approved'). Re-
// approving while status='approved' is how variant re-selection works.
// ============================================================

const BUCKET = "story-covers";
const VARIANT_COUNT = 4;

type ApproveCoverBody = {
  selectedVariant: number;
};

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  let body: ApproveCoverBody;
  try {
    body = (await request.json()) as ApproveCoverBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idx = body.selectedVariant;
  if (!Number.isInteger(idx) || idx < 0 || idx >= VARIANT_COUNT) {
    return NextResponse.json(
      { error: `selectedVariant must be an integer 0–${VARIANT_COUNT - 1}` },
      { status: 400 }
    );
  }

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, slug, cover_status, cover_variants")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.cover_status !== "variants_ready" && series.cover_status !== "approved") {
    return NextResponse.json(
      {
        error: `Cannot approve a cover while status is '${series.cover_status}'. Wait for variants to finish generating.`,
      },
      { status: 400 }
    );
  }

  const variants = (series.cover_variants as (string | null)[] | null) ?? [];
  const variantUrl = variants[idx];
  if (!variantUrl) {
    return NextResponse.json(
      { error: `Variant ${idx} has no image — pick a populated slot.` },
      { status: 400 }
    );
  }

  // Server-side copy inside the story-covers bucket. Source path is
  // derived from the variant URL so the extension matches what was
  // actually uploaded (.png for Flux 2 Dev, .jpeg for HunyuanImage).
  const variantExt = /\.(jpeg|jpg|png|webp)(\?.*)?$/i.exec(variantUrl)?.[1] ?? "png";
  const sourcePath = `${series.slug}/variants/variant-${idx}.${variantExt}`;
  const destPath = `${series.slug}/base.png`;

  const { error: copyErr } = await supabase.storage
    .from(BUCKET)
    .copy(sourcePath, destPath);

  if (copyErr) {
    // The Supabase copy API errors if the destination exists. Fall back
    // to explicit remove + copy.
    const isExists = /exists|duplicate|conflict/i.test(copyErr.message);
    if (isExists) {
      const { error: removeErr } = await supabase.storage.from(BUCKET).remove([destPath]);
      if (removeErr) {
        return NextResponse.json(
          { error: `Failed to overwrite base.png: ${removeErr.message}` },
          { status: 500 }
        );
      }
      const { error: retryErr } = await supabase.storage
        .from(BUCKET)
        .copy(sourcePath, destPath);
      if (retryErr) {
        return NextResponse.json(
          { error: `Failed to copy variant to base.png: ${retryErr.message}` },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: `Failed to copy variant to base.png: ${copyErr.message}` },
        { status: 500 }
      );
    }
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(destPath);
  const coverBaseUrl = publicUrlData.publicUrl;

  const { error: updErr } = await supabase
    .from("story_series")
    .update({
      cover_selected_variant: idx,
      cover_base_url: coverBaseUrl,
      cover_status: "approved",
      cover_error: null,
      // cover_sizes stays untouched until composite-cover fills it
    })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to record cover approval: ${updErr.message}` },
      { status: 500 }
    );
  }

  // Fire-and-forget: trigger typography compositing. The composite-cover
  // endpoint runs satori/resvg/sharp sequentially across 4 sizes
  // (~15-30s). We don't await it — the UI's cover polling loop picks up
  // the approved → compositing → complete transition from
  // story_series.cover_status. See docs/security-debt.md for the note
  // on internal-call auth.
  fireAndForgetInternalPost(
    request,
    `/api/stories/${seriesId}/composite-cover`,
    undefined,
    { label: `approve-cover → composite-cover (series=${seriesId})` }
  );

  return NextResponse.json({
    coverStatus: "approved",
    coverBaseUrl,
    coverSelectedVariant: idx,
  });
}
