import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "story-images";

/**
 * Tear down an orphaned image: Storage file → generation_jobs row → images
 * row, in that order, each step tolerating prior failure so a partial
 * cleanup doesn't wedge the caller. Used by the strict-mode rollback path
 * in PR-3b: when face succeeds but body fails (or approval itself fails),
 * the just-created face image must be torn down to leave the user in a
 * clean idle state.
 *
 * Returns `{ ok: true, errors: [] }` iff every step succeeded. On any
 * failure, returns `{ ok: false, errors: [...] }` with each step's error
 * tagged. The caller decides whether a partial failure is acceptable.
 *
 * Storage path is derived from `images.stored_url`. If the row is missing
 * or its `stored_url` is null (job didn't complete, nothing in Storage),
 * the Storage delete is skipped and the DB cleanup proceeds.
 */
export async function cleanupOrphanedImage(
  supabase: SupabaseClient,
  imageId: string
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  // a. Read the images row to derive the storage path.
  let storagePath: string | null = null;
  try {
    const { data, error } = await supabase
      .from("images")
      .select("id, stored_url")
      .eq("id", imageId)
      .maybeSingle();
    if (error) {
      console.warn(
        `[cleanupOrphanedImage] read images failed for ${imageId}: ${error.message}`
      );
      errors.push(`read: ${error.message}`);
    } else if (data?.stored_url) {
      storagePath = derivePathFromStoredUrl(data.stored_url);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[cleanupOrphanedImage] read images threw for ${imageId}: ${msg}`);
    errors.push(`read: ${msg}`);
  }

  // b. Storage delete (skipped when no path could be derived).
  if (storagePath) {
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (error) {
        console.warn(
          `[cleanupOrphanedImage] storage remove failed for ${storagePath}: ${error.message}`
        );
        errors.push(`storage: ${error.message}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[cleanupOrphanedImage] storage remove threw for ${storagePath}: ${msg}`
      );
      errors.push(`storage: ${msg}`);
    }
  }

  // c. Delete generation_jobs row(s) by image_id.
  try {
    const { error } = await supabase
      .from("generation_jobs")
      .delete()
      .eq("image_id", imageId);
    if (error) {
      console.warn(
        `[cleanupOrphanedImage] generation_jobs delete failed for ${imageId}: ${error.message}`
      );
      errors.push(`jobs: ${error.message}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[cleanupOrphanedImage] generation_jobs delete threw for ${imageId}: ${msg}`
    );
    errors.push(`jobs: ${msg}`);
  }

  // d. Delete the images row.
  try {
    const { error } = await supabase.from("images").delete().eq("id", imageId);
    if (error) {
      console.warn(
        `[cleanupOrphanedImage] images delete failed for ${imageId}: ${error.message}`
      );
      errors.push(`images: ${error.message}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[cleanupOrphanedImage] images delete threw for ${imageId}: ${msg}`);
    errors.push(`images: ${msg}`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Extract the path-within-bucket from a Supabase Storage URL.
 *
 * Assumes the standard public-bucket URL format:
 *   https://{project}.supabase.co/storage/v1/object/public/story-images/{path}
 *
 * If a future code path produces a URL we don't recognise — signed URLs
 * served from a different domain, a CDN edge URL, or any non-standard
 * format — the regex returns null and the caller skips the Storage delete.
 * That's the correct graceful degradation for a rollback helper: better to
 * leave a dangling Storage file (visible in the bucket, easy to sweep
 * later) than to delete the wrong file or refuse to clean up the DB rows.
 * The DB cleanup steps (jobs + images row) still run.
 */
function derivePathFromStoredUrl(storedUrl: string): string | null {
  const m = storedUrl.match(/\/story-images\/(.+?)(?:\?|$)/);
  return m ? m[1] : null;
}
