/**
 * AI Prompt Optimizer for SDXL Image Generation
 *
 * Uses Claude Sonnet to restructure story image prompts for optimal SDXL
 * generation. Operates in two phases:
 *
 * Phase 1 (Pre-Decomposition): Optimizes the full assembled prompt before
 *   it gets split into per-pass components. Fixes gender ambiguity, spatial
 *   clarity, and prose-to-tag conversion.
 *
 * Phase 2 (Post-Decomposition): Fine-tunes each decomposed prompt component
 *   (scene, identity, full) for its specific pass requirements.
 *
 * Falls back to unmodified prompts on any API failure.
 *
 * Location: packages/image-gen/src/prompt-optimizer.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DecomposedPrompt } from "./prompt-decomposer";

// ── Types ───────────────────────────────────────────────────────

export interface CharacterContext {
  name: string;
  gender: "male" | "female";
  role: "primary" | "secondary";
  /** Condensed character tags (from approved_prompt) */
  identityTags?: string;
}

export interface OptimizationInput {
  /** The full assembled prompt (from buildStoryImagePrompt) */
  fullPrompt: string;
  /** The raw scene prompt (before assembly, from story JSON) */
  rawScenePrompt: string;
  /** Character metadata for gender/spatial anchoring */
  characters: CharacterContext[];
  /** SFW or NSFW mode */
  mode: "sfw" | "nsfw";
  /** Image type for context */
  imageType: "facebook_sfw" | "website_nsfw_paired" | "website_only" | "portrait";
}

export interface OptimizedPrompts {
  /** Phase 1: Optimized full prompt (replaces the buildStoryImagePrompt output) */
  optimizedFullPrompt: string;
  /** Phase 2: Optimized decomposed prompts for multi-pass workflow */
  optimizedDecomposed: DecomposedPrompt;
  /** Whether AI optimization was applied (false = fallback to original) */
  wasOptimized: boolean;
  /** Optimization notes for logging/debugging */
  notes: string[];
  /** Time taken in ms */
  durationMs: number;
}

// ── Constants ───────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2000;
const TIMEOUT_MS = 15_000; // 15s timeout — don't block the pipeline

// ── Phase 1 System Prompt ───────────────────────────────────────

const PHASE1_SYSTEM = `You are an expert at optimizing text prompts for SDXL (Stable Diffusion XL) image generation via ComfyUI. Your job is to restructure a narrative-style image prompt into an SDXL-optimized format that maximizes prompt adherence.

SDXL PROMPT RULES:
1. CLIP processes ~77 tokens with decreasing attention. Front-load the most important elements.
2. Use comma-separated tags, not prose sentences. Convert "A man leaning over a car engine" to "man leaning over car engine, forearm flexed on engine block"
3. For dual-character scenes, ALWAYS start with explicit gender count: "(1man, 1woman:1.3)" or "(2women:1.3)"
4. Each character's actions must be CLEARLY associated with their gender tag. Don't let actions float ambiguously.
5. Use emphasis weights sparingly: (important element:1.2-1.4) for critical features
6. Spatial positioning should be explicit: "man foreground left", "woman right side"
7. Keep the SAME visual content and narrative moment — don't change WHAT the image depicts, only HOW it's described for SDXL
8. Preserve all specific South African cultural details, setting names, and atmosphere
9. Keep lighting, composition, and camera angle instructions intact but convert to tag format
10. Do NOT add quality tags (photorealistic, masterpiece, 8k) — those are handled separately

OUTPUT FORMAT:
Return ONLY the optimized prompt text. No explanations, no markdown, no quotes. Just the prompt.`;

// ── Phase 2 System Prompt ───────────────────────────────────────

const PHASE2_SYSTEM = `You are an expert at optimizing decomposed prompts for a multi-pass SDXL ComfyUI workflow. Each pass has specific requirements:

PASS 1 — SCENE COMPOSITION (scenePrompt):
- Purpose: Establish spatial layout, poses, and setting at LOW resolution
- MUST start with gender count tags: "(1man, 1woman:1.3)" for mixed-gender scenes
- NO character identity details (skin tone, hair style, eye color) — those come later
- Focus on: actions, poses, spatial positions, setting, lighting, camera angle, atmosphere
- Use clear subject-action association: "man foreground leaning over engine" not just "leaning over engine"
- Keep under ~60 tokens for optimal CLIP processing

PASS 2 — CHARACTER IDENTITY (primaryIdentityPrompt / secondaryIdentityPrompt):
- Purpose: Inject character appearance into the composition
- Keep to essential identity markers: gender, ethnicity, skin tone, hair, build
- Under ~20 tokens each
- Include "tok" trigger word at the start (for LoRA activation)
- Do NOT include actions or scene elements

PASS 3 — FULL PROMPT (fullPrompt):
- Purpose: Quality refinement with all details
- This is the complete assembled prompt with everything
- Should be well-structured with clear section separation
- Quality tags and enhancement tags are handled by the pipeline — focus on content

REGIONAL PROMPTS (Dual-Character Scenes Only):
When the scene has two characters, you MUST also produce three regional prompt components that split the scene spatially for the Attention Couple node:

- sharedScenePrompt: ONLY the background, setting, lighting, atmosphere, camera angle, composition. NO character descriptions, NO actions, NO clothing, NO body parts. This is what the entire canvas shares.

- primaryRegionPrompt: The PRIMARY character's gender tag, pose, action, clothing, and spatial position. Start with "(1[gender]:1.3)". Include ONLY what this specific character is doing and wearing. Example: "(1man:1.3), leaning over car engine, forearm flexed, looking up at camera, overalls unzipped to waist over white t-shirt, foreground centre"

- secondaryRegionPrompt: The SECONDARY character's gender tag, pose, action, clothing, and spatial position. Start with "(1[gender]:1.3)". Include ONLY what this specific character is doing and wearing. Example: "(1woman:1.3), standing beside car, braids loose, off-shoulder top revealing collarbone, biting lower lip, body angled toward man, right side"

CRITICAL RULES for regional prompts:
- Each region prompt must be self-contained — no references to the other character
- Gender tags are MANDATORY at the start of each region prompt
- Shared scene prompt must have ZERO character-specific content
- Actions must be clearly assigned to their character's region
- Keep each region prompt under ~40 tokens for optimal CLIP processing

You will receive JSON with the current decomposed prompts and character metadata. Return JSON with the optimized versions.

OUTPUT FORMAT:
Return ONLY valid JSON with this structure (no markdown, no code fences):
{"scenePrompt": "...", "primaryIdentityPrompt": "...", "secondaryIdentityPrompt": "..." or null, "fullPrompt": "...", "sharedScenePrompt": "..." or null, "primaryRegionPrompt": "..." or null, "secondaryRegionPrompt": "..." or null}

For single-character scenes, set all three regional fields to null.
For dual-character scenes, ALL THREE regional fields are REQUIRED (non-null).`;

// ── Core Functions ──────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Phase 1: Optimize the full assembled prompt before decomposition.
 * Restructures prose into SDXL-optimized tags with proper gender anchoring.
 */
async function optimizeFullPrompt(
  input: OptimizationInput,
): Promise<{ optimized: string; notes: string[] }> {
  const notes: string[] = [];
  const client = getClient();

  const characterDesc = input.characters
    .map(
      (c) =>
        `- ${c.name} (${c.role}, ${c.gender})${c.identityTags ? `: ${c.identityTags}` : ""}`,
    )
    .join("\n");

  const isDualCharacter = input.characters.length >= 2;
  const hasMixedGender =
    isDualCharacter &&
    new Set(input.characters.map((c) => c.gender)).size > 1;

  const userMessage = `Optimize this SDXL image prompt.

CHARACTERS IN SCENE:
${characterDesc}

${hasMixedGender ? "CRITICAL: This is a MIXED-GENDER dual-character scene. You MUST start with (1man, 1woman:1.3) and clearly associate each character's actions with their gender." : ""}
${isDualCharacter && !hasMixedGender ? `CRITICAL: This is a dual-character scene with ${input.characters[0].gender === "female" ? "two women" : "two men"}. Start with (2${input.characters[0].gender === "female" ? "women" : "men"}:1.3).` : ""}

MODE: ${input.mode.toUpperCase()}
IMAGE TYPE: ${input.imageType}

RAW SCENE PROMPT (original from story):
${input.rawScenePrompt}

ASSEMBLED PROMPT (current, to be optimized):
${input.fullPrompt}

Restructure this for optimal SDXL generation. Keep the exact same visual scene — only change how it's described.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: PHASE1_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";

    if (!text || text.length < 20) {
      notes.push("Phase 1: Response too short, using original");
      return { optimized: input.fullPrompt, notes };
    }

    notes.push("Phase 1: AI optimization applied");
    if (hasMixedGender && !text.includes("1man") && !text.includes("1woman")) {
      notes.push(
        "Phase 1 WARNING: AI response missing gender count tags, prepending",
      );
      return { optimized: `(1man, 1woman:1.3), ${text}`, notes };
    }

    return { optimized: text, notes };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unknown error";
    notes.push(`Phase 1: API error (${msg}), using original`);
    return { optimized: input.fullPrompt, notes };
  }
}

/**
 * Phase 2: Optimize each decomposed prompt component for its specific pass.
 */
async function optimizeDecomposed(
  decomposed: DecomposedPrompt,
  input: OptimizationInput,
): Promise<{ optimized: DecomposedPrompt; notes: string[] }> {
  const notes: string[] = [];
  const client = getClient();

  const characterDesc = input.characters
    .map(
      (c) =>
        `{"name": "${c.name}", "role": "${c.role}", "gender": "${c.gender}"}`,
    )
    .join(", ");

  const userMessage = `Optimize these decomposed prompts for the multi-pass SDXL workflow.

CHARACTERS: [${characterDesc}]
MODE: ${input.mode}

CURRENT DECOMPOSED PROMPTS:
${JSON.stringify(
    {
      scenePrompt: decomposed.scenePrompt,
      primaryIdentityPrompt: decomposed.primaryIdentityPrompt,
      secondaryIdentityPrompt: decomposed.secondaryIdentityPrompt || null,
      fullPrompt: decomposed.fullPrompt,
    },
    null,
    2,
  )}

Optimize each component for its specific pass requirements.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: PHASE2_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";

    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as {
      scenePrompt: string;
      primaryIdentityPrompt: string;
      secondaryIdentityPrompt: string | null;
      fullPrompt: string;
      sharedScenePrompt: string | null;
      primaryRegionPrompt: string | null;
      secondaryRegionPrompt: string | null;
    };

    // Validate the parsed response has required fields
    if (!parsed.scenePrompt || !parsed.primaryIdentityPrompt || !parsed.fullPrompt) {
      notes.push("Phase 2: Response missing required fields, using original decomposition");
      return { optimized: decomposed, notes };
    }

    // Ensure identity prompts start with trigger word
    if (!parsed.primaryIdentityPrompt.startsWith("tok")) {
      parsed.primaryIdentityPrompt = `tok, ${parsed.primaryIdentityPrompt}`;
    }
    if (
      parsed.secondaryIdentityPrompt &&
      !parsed.secondaryIdentityPrompt.startsWith("tok")
    ) {
      parsed.secondaryIdentityPrompt = `tok, ${parsed.secondaryIdentityPrompt}`;
    }

    notes.push("Phase 2: AI optimization applied to decomposed prompts");

    // Regional prompts for Attention Couple (dual-character only)
    const hasDualCharacter = input.characters.length >= 2;
    if (hasDualCharacter && parsed.sharedScenePrompt && parsed.primaryRegionPrompt && parsed.secondaryRegionPrompt) {
      notes.push('Phase 2: Regional prompts generated for Attention Couple');
    } else if (hasDualCharacter) {
      notes.push('Phase 2 WARNING: Dual-character scene but regional prompts missing from AI response');
    }

    return {
      optimized: {
        scenePrompt: parsed.scenePrompt,
        primaryIdentityPrompt: parsed.primaryIdentityPrompt,
        secondaryIdentityPrompt: parsed.secondaryIdentityPrompt || undefined,
        fullPrompt: parsed.fullPrompt,
        // Regional prompts (Attention Couple)
        sharedScenePrompt: parsed.sharedScenePrompt || undefined,
        primaryRegionPrompt: parsed.primaryRegionPrompt || undefined,
        secondaryRegionPrompt: parsed.secondaryRegionPrompt || undefined,
      },
      notes,
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unknown error";
    notes.push(`Phase 2: API error or parse failure (${msg}), using original decomposition`);
    return { optimized: decomposed, notes };
  }
}

/**
 * Main entry point: Run both optimization phases with timeout and fallback.
 *
 * Pipeline integration point:
 *   buildStoryImagePrompt() → optimizePrompts() → decomposePrompt() → buildMultiPassWorkflow()
 *
 * The optimized fullPrompt replaces the buildStoryImagePrompt output.
 * The optimized decomposed prompts replace the decomposePrompt output.
 */
export async function optimizePrompts(
  input: OptimizationInput,
  decomposed: DecomposedPrompt,
): Promise<OptimizedPrompts> {
  const startTime = Date.now();
  const allNotes: string[] = [];

  // Check if API key is available
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      optimizedFullPrompt: input.fullPrompt,
      optimizedDecomposed: decomposed,
      wasOptimized: false,
      notes: ["Skipped: ANTHROPIC_API_KEY not set"],
      durationMs: Date.now() - startTime,
    };
  }

  // Skip optimization for single-character non-scene images (portraits, etc.)
  // where gender confusion is not an issue
  if (input.characters.length <= 1 && input.imageType === "portrait") {
    return {
      optimizedFullPrompt: input.fullPrompt,
      optimizedDecomposed: decomposed,
      wasOptimized: false,
      notes: ["Skipped: single-character portrait, no optimization needed"],
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Phase 1: Optimize the full prompt
    const phase1Promise = optimizeFullPrompt(input);
    const phase1Result = await Promise.race([
      phase1Promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Phase 1 timeout")), TIMEOUT_MS),
      ),
    ]);
    allNotes.push(...phase1Result.notes);

    // Phase 2: Optimize the decomposed prompts
    // Use the Phase 1 optimized prompt as the fullPrompt for decomposition
    const updatedDecomposed: DecomposedPrompt = {
      ...decomposed,
      fullPrompt: phase1Result.optimized,
    };

    const phase2Promise = optimizeDecomposed(updatedDecomposed, input);
    const phase2Result = await Promise.race([
      phase2Promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Phase 2 timeout")), TIMEOUT_MS),
      ),
    ]);
    allNotes.push(...phase2Result.notes);

    return {
      optimizedFullPrompt: phase1Result.optimized,
      optimizedDecomposed: phase2Result.optimized,
      wasOptimized: true,
      notes: allNotes,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    allNotes.push(`Optimization failed (${msg}), using originals`);

    return {
      optimizedFullPrompt: input.fullPrompt,
      optimizedDecomposed: decomposed,
      wasOptimized: false,
      notes: allNotes,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Quick check: should we bother optimizing this prompt?
 * Skips atmospheric/environmental shots and single-character portraits.
 */
export function shouldOptimize(
  characters: CharacterContext[],
  imageType: string,
): boolean {
  // Always optimize dual-character scenes (the primary use case)
  if (characters.length >= 2) return true;

  // Optimize single-character scene images (not portraits)
  if (characters.length === 1 && imageType !== "portrait") return true;

  // Skip atmospheric shots with no characters
  if (characters.length === 0) return false;

  // Skip portraits
  return false;
}
