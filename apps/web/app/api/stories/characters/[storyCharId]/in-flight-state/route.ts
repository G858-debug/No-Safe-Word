import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { cleanupOrphanedImage } from "@/lib/server/cleanup-orphaned-image";

/**
 * GET /api/stories/characters/[storyCharId]/in-flight-state
 *
 * On component mount, the CharacterCard reducer needs to know:
 *  - Is this character approved? (face + body urls)
 *  - Is there a candidate or in-flight pair (pre-approval OR post-approval)?
 *
 * Returns a compact summary. The client-side reducer maps this onto its
 * discriminated union; the server intentionally does not encode "kind" —
 * that's a UI concern.
 *
 * Face vs body discrimination: body images carry settings.imageType = "body"
 * (set by /generate-body). Face images set settings.imageType = "face" going
 * forward; legacy rows lacking the field are treated as face by default.
 *
 * Eager orphan cleanup: before identifying candidates we tear down any
 * non-approved image whose generation_jobs row is in 'failed' status or has
 * no associated job at all. Without this, a crashed regenerate session
 * would leave behind images that get mistaken for legitimate candidates
 * the next time the card mounts.
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
      .select("id, approved_image_id, approved_fullbody_image_id")
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

    // Survivors after cleanup — these are real in-flight or completed
    // candidates.
    const liveCandidates = candidateRows.filter(
      (r) => !orphanIds.includes(r.id)
    );

    const urlOf = (id: string | null) => {
      if (!id) return null;
      const row = imagesForChar?.find((r) => r.id === id);
      return row?.sfw_url || row?.stored_url || null;
    };

    const approvedFaceUrl = urlOf(character.approved_image_id);
    const approvedBodyUrl = urlOf(character.approved_fullbody_image_id);

    // Pick the freshest candidate body, then the face it was conditioned on
    // (settings.face_image_id). Pre-Pass-3 face images don't carry that
    // link; for the pre-approval case we fall back to the most-recent face
    // row by created_at.
    const candidateBody = liveCandidates.find((r) => {
      const s = r.settings as Record<string, unknown> | null;
      return s?.imageType === "body";
    });

    let candidateFace: (typeof liveCandidates)[number] | undefined;
    if (candidateBody) {
      const s = candidateBody.settings as Record<string, unknown> | null;
      const linkedFaceId =
        typeof s?.face_image_id === "string" ? s.face_image_id : null;
      if (linkedFaceId && linkedFaceId !== character.approved_image_id) {
        candidateFace = liveCandidates.find((r) => r.id === linkedFaceId);
      }
    } else {
      // Body not yet started/done — find the most recent face candidate.
      candidateFace = liveCandidates.find((r) => {
        const s = r.settings as Record<string, unknown> | null;
        return s?.imageType !== "body";
      });
    }

    const faceJob = candidateFace ? jobsByImage.get(candidateFace.id) : null;
    const bodyJob = candidateBody ? jobsByImage.get(candidateBody.id) : null;

    return NextResponse.json({
      character_id: character.id,
      approved: {
        face_image_id: character.approved_image_id,
        face_url: approvedFaceUrl,
        body_image_id: character.approved_fullbody_image_id,
        body_url: approvedBodyUrl,
      },
      pending:
        candidateFace || candidateBody
          ? {
              face_image_id: candidateFace?.id ?? null,
              face_url:
                candidateFace?.sfw_url || candidateFace?.stored_url || null,
              face_job_id: faceJob?.job_id ?? null,
              face_status: faceJob?.status ?? null,
              face_prompt: candidateFace?.prompt ?? null,
              body_image_id: candidateBody?.id ?? null,
              body_url:
                candidateBody?.sfw_url || candidateBody?.stored_url || null,
              body_job_id: bodyJob?.job_id ?? null,
              body_status: bodyJob?.status ?? null,
              body_created_at: candidateBody?.created_at ?? null,
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
