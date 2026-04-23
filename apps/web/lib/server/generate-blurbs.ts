import { getClaudeClient, CLAUDE_CREATIVE_MODEL } from "./claude-client";

// ============================================================
// Blurb generation service
// ============================================================
// Calls claude-opus-4-7 to produce 3 short + 3 long blurb variants
// for a story. Used by POST /api/stories/[seriesId]/regenerate-blurbs.
//
// The model is instructed to return strict JSON; we strip ```json
// fences defensively and validate that both arrays are exactly 3
// non-empty strings. Malformed output throws with the full raw
// response in the error message so debugging doesn't require
// re-running the request.
// ============================================================

export interface BlurbCharacterInput {
  name: string;
  role: string;
  proseDescription: string | null;
}

export interface GenerateBlurbsInput {
  seriesId: string;
  title: string;
  hashtag: string | null;
  description: string | null;
  fullStoryText: string;
  characters: BlurbCharacterInput[];
}

export interface GenerateBlurbsOutput {
  blurbShortVariants: [string, string, string];
  blurbLongVariants: [string, string, string];
}

const SYSTEM_PROMPT = `You are writing book blurbs for No Safe Word, a serialised romance and erotic fiction brand by Nontsikelelo Mabaso, targeting South African women aged 25-45. The voice is Nontsikelelo's: playful, South African English, sensual, unapologetic. Present tense hits harder than past for hooks. First-person or close third-person voice works best.

Your task: write 3 distinct short blurbs (1-2 sentences each, used on story cards and OG previews) and 3 distinct long blurbs (150-250 words each, used on the website story detail page) for the story provided.

Each variant should enter the story from a different angle — protagonist's POV, love interest's POV, an outside observer or framing device. Each short blurb should open a loop that only reading the story can close. Long blurbs set up the premise, establish the central tension, and hint at the twist without spoiling it. End on a question or a dilemma.

Return valid JSON only, no prose around it:

\`\`\`json
{
  "blurb_short_variants": ["...", "...", "..."],
  "blurb_long_variants": ["...", "...", "..."]
}
\`\`\``;

function buildUserPrompt(input: GenerateBlurbsInput): string {
  const hashtagLine = input.hashtag ? input.hashtag : "(none)";
  const descriptionLine = input.description ? input.description : "(none)";

  const characterLines = input.characters
    .map((c) => {
      const prose = c.proseDescription ?? "(no prose description)";
      return `- ${c.name} (${c.role}): ${prose}`;
    })
    .join("\n");

  return `Title: ${input.title}
Hashtag: ${hashtagLine}
Existing description: ${descriptionLine}

Characters:
${characterLines || "(none)"}

Full story text:
${input.fullStoryText}

Generate 3 short and 3 long blurb variants.`;
}

/**
 * Strip ```json ... ``` or ``` ... ``` fences defensively. Claude
 * generally honours "JSON only" but occasionally wraps the response
 * for emphasis; we want both paths to parse.
 */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function validateVariants(
  value: unknown,
  fieldName: string
): [string, string, string] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      `Claude response ${fieldName} must be an array of exactly 3 strings (got ${
        Array.isArray(value) ? `${value.length} entries` : typeof value
      })`
    );
  }
  for (let i = 0; i < 3; i++) {
    const v = value[i];
    if (typeof v !== "string") {
      throw new Error(`Claude response ${fieldName}[${i}] is not a string`);
    }
  }
  const trimmed = (value as string[]).map((v) => v.trim());
  for (let i = 0; i < 3; i++) {
    if (trimmed[i].length === 0) {
      throw new Error(`Claude response ${fieldName}[${i}] is empty after trimming`);
    }
  }
  return [trimmed[0], trimmed[1], trimmed[2]];
}

export async function generateBlurbsForStory(
  input: GenerateBlurbsInput
): Promise<GenerateBlurbsOutput> {
  if (!input.fullStoryText || input.fullStoryText.trim().length === 0) {
    throw new Error(
      "Cannot generate blurbs: fullStoryText is empty. Caller must ensure the series has at least one post with website_content before invoking."
    );
  }

  const client = getClaudeClient();

  const message = await client.messages.create({
    model: CLAUDE_CREATIVE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  // The SDK returns content as an array of blocks. For text-only
  // responses we concatenate the text from each `text` block.
  const rawText = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();

  if (!rawText) {
    throw new Error(
      `Claude response had no text content. Raw message: ${JSON.stringify(message)}`
    );
  }

  const jsonText = stripJsonFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Claude response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }. Raw response: ${rawText}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  const blurbShortVariants = validateVariants(
    obj.blurb_short_variants,
    "blurb_short_variants"
  );
  const blurbLongVariants = validateVariants(
    obj.blurb_long_variants,
    "blurb_long_variants"
  );

  return { blurbShortVariants, blurbLongVariants };
}
