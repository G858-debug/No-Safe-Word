import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { assembleFullStoryText } from "@/lib/server/assemble-story-text";
import {
  generateCoverPromptForStory,
  type GenerateCoverPromptInput,
} from "@/lib/server/generate-cover-prompt";
import type { BlurbCharacterInput } from "@/lib/server/generate-blurbs";

export const runtime = "nodejs";
export const maxDuration = 120;

// ============================================================
// POST /api/stories/[seriesId]/regenerate-cover-prompt
// ============================================================
// Calls claude-opus-4-7 to generate a new cover-image prompt for a
// story, overwriting story_series.cover_prompt.
//
// Does NOT auto-trigger cover variant generation — user reviews the
// new prompt in the Cover tab and clicks "Generate 4 Variants"
// themselves to actually spend RunPod GPU time.
//
// Preconditions:
//   - Series exists (any status)
//   - At least one story_posts row (need text to work with)
//   - At least one approved character with role='protagonist' — mirrors
//     the precondition on generate-cover. No point writing a two-
//     character cover prompt if we don't have an approved protagonist
//     to reference in it.
// ============================================================

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await props.params;

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, title, image_model")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const imageModel: "flux2_dev" | "hunyuan3" =
    (series.image_model as string | null) === "hunyuan3" ? "hunyuan3" : "flux2_dev";

  const { count: postCount } = await supabase
    .from("story_posts")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);

  if ((postCount ?? 0) === 0) {
    return NextResponse.json(
      {
        error:
          "Cannot regenerate cover prompt: no story posts found. Import or write posts before calling this endpoint.",
      },
      { status: 400 }
    );
  }

  // Protagonist precondition — approval now lives on the base `characters` row
  const { data: storyChars, error: charsErr } = await supabase
    .from("story_characters")
    .select(
      "role, prose_description, character_id, characters:character_id ( approved_image_id )"
    )
    .eq("series_id", seriesId);

  if (charsErr) {
    return NextResponse.json(
      { error: `Failed to load characters: ${charsErr.message}` },
      { status: 500 }
    );
  }

  type Row = {
    role: string | null;
    prose_description: string | null;
    character_id: string;
    characters:
      | { approved_image_id: string | null }
      | { approved_image_id: string | null }[]
      | null;
  };
  const isApproved = (c: Row) => {
    const b = Array.isArray(c.characters) ? c.characters[0] : c.characters;
    return Boolean(b?.approved_image_id);
  };
  const chars = (storyChars ?? []) as unknown as Row[];
  const approvedProtagonists = chars.filter(
    (c) => c.role === "protagonist" && isApproved(c)
  );
  if (approvedProtagonists.length === 0) {
    return NextResponse.json(
      {
        error:
          "Cover prompt generation requires an approved protagonist portrait. Complete character approval first.",
      },
      { status: 400 }
    );
  }
  if (approvedProtagonists.length >= 2) {
    return NextResponse.json(
      {
        error: `Series has ${approvedProtagonists.length} approved protagonists. Cover prompt generation requires exactly one. Check the import data or the Characters tab.`,
      },
      { status: 400 }
    );
  }

  // Assemble story text + character names
  const fullStoryText = await assembleFullStoryText(seriesId);
  if (!fullStoryText) {
    return NextResponse.json(
      {
        error:
          "Assembled story text is empty — posts exist but website_content is blank across all of them.",
      },
      { status: 400 }
    );
  }

  const charIds = chars
    .map((c) => c.character_id)
    .filter((id): id is string => Boolean(id));

  const nameMap = new Map<string, string>();
  if (charIds.length > 0) {
    const { data: charRows } = await supabase
      .from("characters")
      .select("id, name")
      .in("id", charIds);
    for (const row of charRows ?? []) {
      nameMap.set(row.id, row.name);
    }
  }

  const characters: BlurbCharacterInput[] = chars.map((c) => ({
    name: nameMap.get(c.character_id) ?? "Unknown",
    role: c.role ?? "",
    proseDescription: c.prose_description,
  }));

  // Call Mistral (model-aware: Hunyuan vs Flux system prompt)
  const callInput: GenerateCoverPromptInput = {
    seriesId,
    title: series.title,
    fullStoryText,
    characters,
    imageModel,
  };

  let coverPrompt: string;
  try {
    coverPrompt = await generateCoverPromptForStory(callInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Mistral error";
    console.error(
      `[regenerate-cover-prompt][${seriesId}] Mistral call failed:`,
      message
    );
    return NextResponse.json(
      { error: `Cover prompt generation failed: ${message}` },
      { status: 502 }
    );
  }

  const { error: updErr } = await supabase
    .from("story_series")
    .update({ cover_prompt: coverPrompt })
    .eq("id", seriesId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to save cover prompt: ${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ seriesId, coverPrompt });
}
