import { supabase } from "@no-safe-word/story-engine";

/**
 * Download an image from a remote URL (e.g. a Replicate CDN link) and
 * upload it to the `story-images` bucket, returning the permanent public
 * URL. Mirrors the pattern used by the character-approve route.
 *
 * @param sourceUrl  Remote https URL of the generated image
 * @param storagePath Destination path inside the `story-images` bucket
 *                   (e.g. `stories/<image_id>.jpeg`)
 */
export async function uploadRemoteImageToStorage(
  sourceUrl: string,
  storagePath: string
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to download generated image from ${sourceUrl}: ${res.status} ${res.statusText}`
    );
  }

  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "image/jpeg";

  const { error: uploadError } = await supabase.storage
    .from("story-images")
    .upload(storagePath, buffer, { contentType, upsert: true });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data } = supabase.storage
    .from("story-images")
    .getPublicUrl(storagePath);

  return data.publicUrl;
}

/**
 * Pick an output file extension from a Content-Type / URL pair.
 * Defaults to `jpeg` since Replicate outputs JPEGs by default.
 */
export function pickImageExtension(contentType?: string | null, url?: string): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (url && /\.(png|webp)$/i.test(url)) {
    return url.match(/\.(png|webp)$/i)![1].toLowerCase();
  }
  return "jpeg";
}
