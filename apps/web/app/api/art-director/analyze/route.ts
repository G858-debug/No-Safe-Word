import { NextRequest, NextResponse } from "next/server";
import { analyzeAndSearch } from "@/lib/art-director/orchestrator";
import { ensurePodRunning } from "@/lib/art-director/qwen-vl-client";
import { supabase } from "@no-safe-word/story-engine";

/**
 * POST /api/art-director/analyze
 *
 * Steps 1-3: Analyze prompt intent, search CivitAI, rank references.
 * Runs synchronously (~30-60s) because the user needs to see references.
 *
 * Also fetches character data (structured descriptions + approved portrait URLs)
 * from the database to pass through for evaluation accuracy.
 */
export async function POST(request: NextRequest) {
  try {
    const { promptId, promptText, imageType, characterNames, seriesId } =
      await request.json();

    if (!promptId || !promptText || !seriesId) {
      return NextResponse.json(
        { error: "promptId, promptText, and seriesId are required" },
        { status: 400 }
      );
    }

    // Ensure Qwen VL pod is running
    await ensurePodRunning();

    // Fetch character data for the characters in this scene
    const characterData = await fetchCharacterData(seriesId, characterNames || []);

    const result = await analyzeAndSearch(
      promptText,
      imageType || "website_nsfw_paired",
      characterNames || [],
      seriesId,
      promptId,
      characterData
    );

    return NextResponse.json({
      jobId: result.jobId,
      intentAnalysis: result.intentAnalysis,
      references: result.rankedReferences,
    });
  } catch (err) {
    console.error("[Art Director Analyze] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

// ── Character data fetching ──

interface CharacterDataForArtDirector {
  name: string;
  structured: Record<string, string> | null;
  portraitUrl: string | null;
}

async function fetchCharacterData(
  seriesId: string,
  characterNames: string[]
): Promise<CharacterDataForArtDirector[]> {
  if (characterNames.length === 0) return [];

  try {
    // Find story_characters for this series whose joined character name matches
    const { data: storyChars, error } = await supabase
      .from("story_characters")
      .select(`
        approved_image_id,
        character:characters!inner(name, description)
      `)
      .eq("series_id", seriesId);

    if (error || !storyChars) {
      console.warn("[Art Director] Failed to fetch character data:", error?.message);
      return [];
    }

    const wanted = new Set(characterNames.map((n) => n.toLowerCase()));
    const results: CharacterDataForArtDirector[] = [];

    for (const sc of storyChars) {
      const charRel = sc.character as any;
      const charName: string | undefined = charRel?.name;
      if (!charName || !wanted.has(charName.toLowerCase())) continue;

      const charData: CharacterDataForArtDirector = {
        name: charName,
        structured: null,
        portraitUrl: null,
      };

      // Extract structured data from the character description JSON
      if (charRel?.description) {
        try {
          const desc = typeof charRel.description === "string"
            ? JSON.parse(charRel.description)
            : charRel.description;
          charData.structured = {
            skinTone: desc.skinTone || null,
            bodyType: desc.bodyType || null,
            hairColor: desc.hairColor || null,
            hairStyle: desc.hairStyle || null,
            eyeColor: desc.eyeColor || null,
            ethnicity: desc.ethnicity || null,
            age: desc.age || null,
            distinguishingFeatures: desc.distinguishingFeatures || null,
          };
        } catch {
          // Not parseable — skip
        }
      }

      // Get approved portrait URL
      if (sc.approved_image_id) {
        const { data: imgData } = await supabase
          .from("images")
          .select("stored_url")
          .eq("id", sc.approved_image_id)
          .single();

        if (imgData?.stored_url) {
          charData.portraitUrl = imgData.stored_url;
        }
      }

      results.push(charData);
    }

    console.log(`[Art Director] Fetched data for ${results.length} characters:`,
      results.map((c) => `${c.name} (portrait: ${c.portraitUrl ? "yes" : "no"})`).join(", "));

    return results;
  } catch (err) {
    console.warn("[Art Director] Character data fetch failed:", err);
    return [];
  }
}
