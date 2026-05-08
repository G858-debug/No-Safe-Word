import { supabase } from "@no-safe-word/story-engine";

/**
 * Simple-image job_types — image generations whose completion writes to a
 * single FK + URL pair on a parent table (characters or story_series),
 * with no story_image_prompts row, no cover variant slot, no extra state
 * machine.
 *
 * - `character_card`  → characters.card_image_id, card_image_url
 * - `author_note`     → story_series.author_note_image_id, author_note_image_url
 *
 * Called from BOTH the Flux 2 Dev inline path in status/[jobId]/route.ts AND
 * siray-job-handler.ts. The handlers do the upload + images.stored_url
 * write; this helper handles the parent-table back-reference.
 */
export type SimpleImageJobType = "character_card" | "author_note";

export async function applySimpleImageCompletion(args: {
  jobType: SimpleImageJobType;
  imageId: string;
  storedUrl: string;
  /** generation_jobs.series_id — required for author_note. */
  seriesId: string | null;
}): Promise<void> {
  const { jobType, imageId, storedUrl, seriesId } = args;

  if (jobType === "character_card") {
    // The card belongs to a base character. images.character_id is set at
    // submit time, so we resolve it here rather than threading it through
    // the status route.
    const { data: img } = await supabase
      .from("images")
      .select("character_id")
      .eq("id", imageId)
      .single();

    const characterId = img?.character_id ?? null;
    if (!characterId) {
      throw new Error(
        `[simple-completion] character_card job ${imageId} has no images.character_id`
      );
    }

    const { error } = await supabase
      .from("characters")
      .update({ card_image_id: imageId, card_image_url: storedUrl })
      .eq("id", characterId);
    if (error) {
      throw new Error(
        `[simple-completion] failed to update characters.card_image_*: ${error.message}`
      );
    }
    return;
  }

  if (jobType === "author_note") {
    if (!seriesId) {
      throw new Error(
        `[simple-completion] author_note job ${imageId} has no generation_jobs.series_id`
      );
    }

    const { error } = await supabase
      .from("story_series")
      .update({ author_note_image_id: imageId, author_note_image_url: storedUrl })
      .eq("id", seriesId);
    if (error) {
      throw new Error(
        `[simple-completion] failed to update story_series.author_note_image_*: ${error.message}`
      );
    }
    return;
  }

  // exhaustiveness check
  const _exhaustive: never = jobType;
  void _exhaustive;
}
