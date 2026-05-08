import { supabase } from "@no-safe-word/story-engine";

export type PortraitRefType = "face" | "body";

export type PortraitRefRequest = {
  characterId: string | null | undefined;
  refType: PortraitRefType;
};

/**
 * Resolve permanent Supabase Storage URLs for the requested portraits of the
 * given characters. Used to feed reference images into Siray.ai i2i scene
 * generation and Flux 2 Dev PuLID injection.
 *
 * `refType` selects which approved portrait FK to read:
 *   - "face" → characters.approved_image_id
 *   - "body" → characters.approved_fullbody_image_id
 *
 * Order is preserved: input order matches output order, dropping any request
 * whose character has no characterId or no approved portrait of the requested
 * type. Throws nothing for missing portraits — the caller validates and emits
 * the user-facing "approve the body portrait first" error.
 */
export async function getPortraitUrlsForScene(
  requests: PortraitRefRequest[]
): Promise<string[]> {
  const filtered = requests.filter(
    (r): r is PortraitRefRequest & { characterId: string } => Boolean(r.characterId)
  );
  if (filtered.length === 0) {
    console.log("[portrait-lookup] found 0 reference URLs for scene");
    return [];
  }

  const ids = Array.from(new Set(filtered.map((r) => r.characterId)));

  const { data, error } = await supabase
    .from("characters")
    .select(
      `
        id,
        face:images!characters_approved_image_id_fkey ( stored_url ),
        body:images!characters_approved_fullbody_image_id_fkey ( stored_url )
      `
    )
    .in("id", ids);

  if (error) {
    throw new Error(`[portrait-lookup] failed to query characters: ${error.message}`);
  }

  const faceByCharId = new Map<string, string>();
  const bodyByCharId = new Map<string, string>();
  for (const row of data ?? []) {
    const face = pickOne(row.face);
    const body = pickOne(row.body);
    if (face?.stored_url) faceByCharId.set(row.id, face.stored_url);
    if (body?.stored_url) bodyByCharId.set(row.id, body.stored_url);
  }

  const urls: string[] = [];
  for (const req of filtered) {
    const url =
      req.refType === "body"
        ? bodyByCharId.get(req.characterId)
        : faceByCharId.get(req.characterId);
    if (url) urls.push(url);
  }

  console.log(
    `[portrait-lookup] found ${urls.length}/${filtered.length} reference URLs for scene (refTypes: ${filtered
      .map((r) => r.refType)
      .join(",")})`
  );
  return urls;
}

function pickOne<T>(linked: T | T[] | null | undefined): T | null {
  if (!linked) return null;
  return Array.isArray(linked) ? linked[0] ?? null : linked;
}
