import { supabase } from "@no-safe-word/story-engine";

/**
 * Resolve permanent Supabase Storage URLs for the approved portraits of the
 * given characters. Used to feed reference images into Siray.ai i2i scene
 * generation.
 *
 * Source of truth: `characters.approved_image_id` → `images.stored_url`.
 * Both `portrait_prompt_locked` (text) and this image URL are passed to
 * scene generation; identity is reinforced through both channels.
 *
 * Returns only URLs that are present (non-null `stored_url`). If no
 * character has an approved portrait yet, returns `[]` so the caller can
 * fall back to t2i.
 *
 * Order is preserved: input order matches output order, dropping any
 * character that has no approved portrait. Pass character IDs directly —
 * this avoids a name-based lookup and matches how `story_image_prompts`
 * already references characters (`character_id`, `secondary_character_id`).
 */
export async function getPortraitUrlsForScene(
  characterIds: (string | null | undefined)[]
): Promise<string[]> {
  const ids = characterIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    console.log("[portrait-lookup] found 0 reference URLs for scene");
    return [];
  }

  const { data, error } = await supabase
    .from("characters")
    .select("id, images!characters_approved_image_id_fkey ( stored_url )")
    .in("id", ids);

  if (error) {
    throw new Error(`[portrait-lookup] failed to query characters: ${error.message}`);
  }

  const urlByCharId = new Map<string, string>();
  for (const row of data ?? []) {
    const linked = row.images as
      | { stored_url: string | null }
      | { stored_url: string | null }[]
      | null;
    const image = Array.isArray(linked) ? linked[0] : linked;
    if (image?.stored_url) {
      urlByCharId.set(row.id, image.stored_url);
    }
  }

  const urls: string[] = [];
  for (const id of ids) {
    const url = urlByCharId.get(id);
    if (url) urls.push(url);
  }

  console.log(`[portrait-lookup] found ${urls.length} reference URLs for scene`);
  return urls;
}
