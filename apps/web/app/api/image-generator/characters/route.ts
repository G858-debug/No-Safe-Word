import { NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

export interface CharacterOption {
  id: string;
  name: string;
  /** Brief prose for Claude character detection context */
  description: string;
  hasLora: boolean;
  loraFilename?: string;
  loraStorageUrl?: string;
  loraTriggerWord?: string;
}

// GET /api/image-generator/characters
// Returns all characters with their deployed LoRA status
export async function GET() {
  try {
    const [charsResult, lorasResult] = await Promise.all([
      supabase.from("characters").select("id, name, description").order("name"),
      (supabase as any)
        .from("character_loras")
        .select("character_id, filename, storage_url, trigger_word")
        .eq("status", "deployed")
        .order("deployed_at", { ascending: false }),
    ]);

    if (charsResult.error) {
      return NextResponse.json({ error: charsResult.error.message }, { status: 500 });
    }

    const characters = charsResult.data || [];
    const loras: Array<{
      character_id: string;
      filename: string;
      storage_url: string;
      trigger_word: string;
    }> = lorasResult.data || [];

    // Build a map of character_id → most-recently-deployed LoRA
    // (results are already sorted by deployed_at DESC so first match wins)
    const loraMap = new Map<string, typeof loras[0]>();
    for (const lora of loras) {
      if (!loraMap.has(lora.character_id)) {
        loraMap.set(lora.character_id, lora);
      }
    }

    const result: CharacterOption[] = characters.map((c) => {
      const desc = (c.description as Record<string, string>) || {};
      const descParts = [
        desc.gender,
        desc.age,
        desc.ethnicity,
        desc.hairColor && desc.hairStyle ? `${desc.hairColor} ${desc.hairStyle} hair` : desc.hairColor,
        desc.skinTone,
      ].filter(Boolean);

      const lora = loraMap.get(c.id);
      return {
        id: c.id,
        name: c.name,
        description: descParts.join(", ") || c.name,
        hasLora: !!lora,
        loraFilename: lora ? `characters/${lora.filename}` : undefined,
        loraStorageUrl: lora?.storage_url,
        loraTriggerWord: lora?.trigger_word || undefined,
      };
    });

    return NextResponse.json({ characters: result });
  } catch (err) {
    console.error("[ImageGenerator] Characters fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch characters" },
      { status: 500 }
    );
  }
}
