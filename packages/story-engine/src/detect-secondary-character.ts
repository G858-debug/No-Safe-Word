import type { CharacterImport } from "@no-safe-word/shared";

export interface DetectionResult {
  promptId: string;
  detectedCharacterName: string;
  detectedCharacterId: string;
  confidence: "exact_name" | "first_name" | "gender_inference";
  reason: string;
}

// Patterns that indicate two characters are present (from scene-classifier)
const DUAL_PATTERNS = [
  /two people/i,
  /two figures/i,
  /\bcouple\b/i,
  /\bboth\b/i,
  /him and her/i,
  /her and him/i,
  /man and woman/i,
  /woman and man/i,
  /a man and a woman/i,
  /a woman and a man/i,
  /two-shot/i,
  /two shot/i,
  /his .* her/i,
  /her .* his/i,
  /foreground.*background/i,
];

const FEMALE_INDICATORS = [
  /\bwoman\b/i,
  /\bfemale\b/i,
  /\bgirl\b/i,
  /\blady\b/i,
  /\bher\b/i,
  /\bshe\b/i,
  /\bdress\b/i,
  /\bskirt\b/i,
  /\bheels\b/i,
  /\blingerie\b/i,
  /\bblouse\b/i,
  /\bcleavage\b/i,
  /\bcurvaceous\b/i,
  /\bbraids\b/i,
];

const MALE_INDICATORS = [
  /\bman\b/i,
  /\bmale\b/i,
  /\bguy\b/i,
  /\b(?:he|him)\b/i,
  /\bhis\b/i,
  /\bmuscular\b/i,
  /\bbroad shoulders\b/i,
];

function hasDualCharacterLanguage(prompt: string): boolean {
  return DUAL_PATTERNS.some((p) => p.test(prompt));
}

function hasFemaleIndicators(prompt: string): boolean {
  return FEMALE_INDICATORS.some((p) => p.test(prompt));
}

function hasMaleIndicators(prompt: string): boolean {
  return MALE_INDICATORS.some((p) => p.test(prompt));
}

/**
 * Analyze image prompts to detect unlinked secondary characters.
 * Returns a list of prompts that should be updated with secondary character data.
 *
 * Detection priority:
 * 1. Exact full name match in prompt text → highest confidence
 * 2. First name match (4+ chars) → high confidence, only if unambiguous
 * 3. Gender-based inference (dual-character language + opposite gender) → medium confidence
 */
export function detectSecondaryCharacters(
  prompts: Array<{
    id: string;
    prompt: string;
    character_id: string | null;
    secondary_character_id: string | null;
  }>,
  characters: CharacterImport[],
  characterMap: Map<string, string> // name → character UUID
): DetectionResult[] {
  const results: DetectionResult[] = [];

  // Build a reverse map: character UUID → CharacterImport
  const idToChar = new Map<string, CharacterImport>();
  for (const char of characters) {
    const id = characterMap.get(char.name);
    if (id) idToChar.set(id, char);
  }

  for (const prompt of prompts) {
    // Only process prompts that already have a primary character but no secondary
    if (!prompt.character_id || prompt.secondary_character_id) continue;

    const promptLower = prompt.prompt.toLowerCase();
    const primaryChar = idToChar.get(prompt.character_id);

    // Candidates: all characters except the primary
    const candidates = characters.filter((c) => {
      const cId = characterMap.get(c.name);
      return cId && cId !== prompt.character_id;
    });

    if (candidates.length === 0) continue;

    // Priority 1: Exact full name match
    const exactMatches = candidates.filter((c) =>
      promptLower.includes(c.name.toLowerCase())
    );

    if (exactMatches.length === 1) {
      const match = exactMatches[0];
      results.push({
        promptId: prompt.id,
        detectedCharacterName: match.name,
        detectedCharacterId: characterMap.get(match.name)!,
        confidence: "exact_name",
        reason: `Full name "${match.name}" found in prompt text`,
      });
      continue;
    }

    if (exactMatches.length > 1) {
      // Multiple exact matches — ambiguous, skip
      continue;
    }

    // Priority 2: First name match (4+ characters to avoid false positives)
    const firstNameMatches = candidates.filter((c) => {
      const firstName = c.name.split(" ")[0];
      if (firstName.length < 4) return false;
      // Use word boundary to avoid partial matches
      const pattern = new RegExp(`\\b${escapeRegex(firstName)}\\b`, "i");
      return pattern.test(prompt.prompt);
    });

    if (firstNameMatches.length === 1) {
      const match = firstNameMatches[0];
      const firstName = match.name.split(" ")[0];
      results.push({
        promptId: prompt.id,
        detectedCharacterName: match.name,
        detectedCharacterId: characterMap.get(match.name)!,
        confidence: "first_name",
        reason: `First name "${firstName}" found in prompt text`,
      });
      continue;
    }

    if (firstNameMatches.length > 1) {
      // Multiple first-name matches — ambiguous, skip
      continue;
    }

    // Priority 3: Gender-based inference
    // Requirements:
    // - Prompt has dual-character language
    // - Prompt has gender indicators matching a candidate's gender
    // - Exactly one candidate matches
    if (!hasDualCharacterLanguage(promptLower)) continue;

    const primaryGender = primaryChar?.structured.gender?.toLowerCase();
    if (!primaryGender) continue;

    // Determine what gender the secondary character likely is
    let inferredSecondaryGender: string | null = null;

    if (primaryGender === "male" && hasFemaleIndicators(promptLower)) {
      inferredSecondaryGender = "female";
    } else if (primaryGender === "female" && hasMaleIndicators(promptLower)) {
      inferredSecondaryGender = "male";
    }

    if (!inferredSecondaryGender) continue;

    const genderMatches = candidates.filter(
      (c) => c.structured.gender?.toLowerCase() === inferredSecondaryGender
    );

    if (genderMatches.length === 1) {
      const match = genderMatches[0];
      results.push({
        promptId: prompt.id,
        detectedCharacterName: match.name,
        detectedCharacterId: characterMap.get(match.name)!,
        confidence: "gender_inference",
        reason: `Dual-character language + ${inferredSecondaryGender} indicators, only one ${inferredSecondaryGender} candidate: "${match.name}"`,
      });
    }
    // If multiple gender matches, ambiguous — skip
  }

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
