import { NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export interface CharacterOption {
  id: string;
  name: string;
  /** Brief prose for Claude character detection context */
  description: string;
  /** URL of the approved portrait (reference image for Flux 2 / reference prose for Hunyuan). */
  approvedImageUrl: string | null;
  /** Locked portrait prompt, injected verbatim under hunyuan3. */
  portraitPromptLocked: string | null;
}

// GET /api/image-generator/characters
// Returns all characters with their approved portrait state.
export async function GET() {
  try {
    const { data: characters, error } = await supabase
      .from("characters")
      .select(
        "id, name, description, approved_image_id, portrait_prompt_locked"
      )
      .order("name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const chars = characters ?? [];
    const approvedImageIds = chars
      .map((c) => c.approved_image_id)
      .filter((id): id is string => Boolean(id));

    const imageUrlById = new Map<string, string>();
    if (approvedImageIds.length > 0) {
      const { data: images } = await supabase
        .from("images")
        .select("id, stored_url, sfw_url")
        .in("id", approvedImageIds);
      for (const img of images ?? []) {
        const url = img.stored_url ?? img.sfw_url ?? null;
        if (url) imageUrlById.set(img.id, url);
      }
    }

    const result: CharacterOption[] = chars.map((c) => {
      const desc = (c.description as Record<string, string>) || {};
      const descParts = [
        desc.gender,
        desc.age,
        desc.ethnicity,
        desc.hairColor && desc.hairStyle
          ? `${desc.hairColor} ${desc.hairStyle} hair`
          : desc.hairColor,
        desc.skinTone,
      ].filter(Boolean);

      return {
        id: c.id,
        name: c.name,
        description: descParts.join(", ") || c.name,
        approvedImageUrl: c.approved_image_id
          ? imageUrlById.get(c.approved_image_id) ?? null
          : null,
        portraitPromptLocked: c.portrait_prompt_locked,
      };
    });

    return NextResponse.json({ characters: result });
  } catch (err) {
    console.error("[ImageGenerator] Characters fetch failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to fetch characters",
      },
      { status: 500 }
    );
  }
}
