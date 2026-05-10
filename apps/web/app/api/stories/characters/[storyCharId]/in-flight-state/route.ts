import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { cleanupOrphanedImage } from "@/lib/server/cleanup-orphaned-image";

/**
 * GET /api/stories/characters/[storyCharId]/in-flight-state
 *
 * On component mount, the CharacterCard reducer needs to know:
 *  - Is this character approved? (face + body urls)
 *  - What is the most recent face/body image (whether approved, in-flight, or
 *    Generated-unapproved)?
 *  - Has the body been invalidated by a face cascade?
 *
 * Returns a compact summary. The client-side reducer maps this onto its
 * discriminated union; the server intentionally does not encode "kind" —
 * that's a UI concern.
 *
 * Face vs body discrimination: body images carry settings.imageType = "body"
 * (set by /generate-body). Face images set settings.imageType = "face" going
 * forward; legacy rows lacking the field are treated as face by default.
 *
 * Eager orphan cleanup: before exposing the latest face/body images we tear
 * down any non-approved image whose generation_jobs row is in 'failed'
 * status or has no associated job at all. Without this, a crashed
 * regenerate session would surface a stale image the next time the card
 * mounts.
 */
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const { storyCharId } = await props.params;

  try {
    const { data: storyChar } = await supabase
      .from("story_characters")
      .select("id, character_id")
      .eq("id", storyCharId)
      .single();
    if (!storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    const { data: character } = await supabase
      .from("characters")
      .select(
        "id, approved_image_id, approved_fullbody_image_id, body_invalidated_at"
      )
      .eq("id", storyChar.character_id)
      .single();
    if (!character) {
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 }
      );
    }

    const approvedIds = [
      character.approved_image_id,
      character.approved_fullbody_image_id,
    ].filter((x): x is string => Boolean(x));

    // Pull every image owned by this character. We'll partition into
    // approved / candidate / orphan below.
    let { data: imagesForChar } = await supabase
      .from("images")
      .select("id, stored_url, sfw_url, prompt, settings, created_at")
      .eq("character_id", character.id)
      .order("created_at", { ascending: false });

    if (!imagesForChar) imagesForChar = [];

    const candidateRows = imagesForChar.filter(
      (r) => !approvedIds.includes(r.id)
    );

    // For each candidate, look up its job (or absence thereof). Anything
    // failed or job-less is an orphan.
    const candidateImageIds = candidateRows.map((r) => r.id);
    let jobsByImage = new Map<string, { job_id: string; status: string }>();
    if (candidateImageIds.length > 0) {
      const { data: jobs } = await supabase
        .from("generation_jobs")
        .select("job_id, image_id, status")
        .in("image_id", candidateImageIds);
      if (jobs) {
        for (const j of jobs) {
          if (j.image_id)
            jobsByImage.set(j.image_id, {
              job_id: j.job_id,
              status: j.status,
            });
        }
      }
    }

    const orphanIds: string[] = [];
    for (const row of candidateRows) {
      const job = jobsByImage.get(row.id);
      if (!job || job.status === "failed") {
        orphanIds.push(row.id);
      }
    }

    if (orphanIds.length > 0) {
      console.log(
        `[in-flight-state] eager cleanup of ${orphanIds.length} orphan(s) for character ${character.id}`
      );
      for (const id of orphanIds) {
        const r = await cleanupOrphanedImage(supabase, id);
        if (!r.ok) {
          console.warn(
            `[in-flight-state] cleanup partial failure for ${id}:`,
            r.errors
          );
        }
      }
    }

    const urlOf = (id: string | null) => {
      if (!id) return null;
      const row = imagesForChar?.find((r) => r.id === id);
      return row?.sfw_url || row?.stored_url || null;
    };

    const approvedFaceUrl = urlOf(character.approved_image_id);
    const approvedBodyUrl = urlOf(character.approved_fullbody_image_id);

    // The two-panel UI consumes `latest_face` and `latest_body` regardless
    // of approval state — each panel renders the most recent image whether
    // it's approved, unapproved, or (for body) stale.
    //
    // Source from `liveImages` (imagesForChar minus orphans we just
    // cleaned up), NOT raw imagesForChar — orphan rows have been DELETED
    // from the DB and surfacing them would point the client at a missing
    // image. imagesForChar was loaded before cleanup and still contains
    // those rows in memory.
    const liveImages = (imagesForChar ?? []).filter(
      (r) => !orphanIds.includes(r.id)
    );
    const allFaceRows = liveImages.filter((r) => {
      const s = r.settings as Record<string, unknown> | null;
      return s?.imageType !== "body"; // legacy face rows lack the field
    });
    const allBodyRows = liveImages.filter((r) => {
      const s = r.settings as Record<string, unknown> | null;
      return s?.imageType === "body";
    });
    // imagesForChar is already DESC by created_at, so the first match
    // per kind is the most recent.
    const latestFaceRow = allFaceRows[0] ?? null;
    const latestBodyRow = allBodyRows[0] ?? null;

    // jobsByImage is keyed only on non-approved candidate ids. For an
    // approved face/body image whose row also happens to be the latest, we
    // do a small extra read to pick up its (possibly null) job row.
    const approvedFaceId = character.approved_image_id;
    const approvedBodyId = character.approved_fullbody_image_id;
    const jobFor = async (imageId: string) => {
      const cached = jobsByImage.get(imageId);
      if (cached) return cached;
      const isApproved =
        imageId === approvedFaceId || imageId === approvedBodyId;
      if (!isApproved) return null;
      const { data: jobRow } = await supabase
        .from("generation_jobs")
        .select("job_id, status")
        .eq("image_id", imageId)
        .maybeSingle();
      return jobRow ?? null;
    };
    const latestFaceJob = latestFaceRow ? await jobFor(latestFaceRow.id) : null;
    const latestBodyJob = latestBodyRow ? await jobFor(latestBodyRow.id) : null;

    return NextResponse.json({
      character_id: character.id,
      body_invalidated_at: character.body_invalidated_at ?? null,
      approved: {
        face_image_id: character.approved_image_id,
        face_url: approvedFaceUrl,
        body_image_id: character.approved_fullbody_image_id,
        body_url: approvedBodyUrl,
      },
      latest_face: latestFaceRow
        ? {
            image_id: latestFaceRow.id,
            url: latestFaceRow.sfw_url || latestFaceRow.stored_url || null,
            created_at: latestFaceRow.created_at,
            prompt: latestFaceRow.prompt ?? null,
            job_id: latestFaceJob?.job_id ?? null,
            status: latestFaceJob?.status ?? null,
          }
        : null,
      latest_body: latestBodyRow
        ? {
            image_id: latestBodyRow.id,
            url: latestBodyRow.sfw_url || latestBodyRow.stored_url || null,
            created_at: latestBodyRow.created_at,
            prompt: latestBodyRow.prompt ?? null,
            job_id: latestBodyJob?.job_id ?? null,
            status: latestBodyJob?.status ?? null,
          }
        : null,
    });
  } catch (err) {
    console.error("[in-flight-state] error:", err);
    return NextResponse.json(
      {
        error: "Lookup failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
