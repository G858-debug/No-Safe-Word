import { revalidatePath } from "next/cache";
import { supabase } from "@no-safe-word/story-engine";

export function revalidateSeriesPublicPaths(slug: string | null | undefined) {
  if (slug) revalidatePath(`/stories/${slug}`);
  revalidatePath("/stories");
  revalidatePath("/");
}

export async function revalidateSeriesById(seriesId: string) {
  const { data } = await supabase
    .from("story_series")
    .select("slug")
    .eq("id", seriesId)
    .maybeSingle();
  revalidateSeriesPublicPaths(data?.slug ?? null);
}
