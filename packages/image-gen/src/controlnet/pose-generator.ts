/**
 * Dynamic pose generation via Claude.
 *
 * When the static catalog doesn't contain a matching pose, this module
 * asks Claude to generate COCO-18 keypoint coordinates for a described
 * two-character arrangement.  Generated poses are cached in-memory
 * (keyed by normalized descriptor), rendered to PNG, and registered
 * into the live POSE_CATALOG for immediate reuse.
 *
 * Pattern mirrors resource-lora-discovery.ts: demand-driven, cached,
 * auto-registered.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PoseDefinition, PoseKeypoint, PoseOrientation, PoseFraming, ContentLevel } from './types';
import { registerPose } from './pose-catalog';
import { renderPose } from './pose-renderer';

// ---------------------------------------------------------------------------
// In-memory cache — prevents re-generating the same pose description
// ---------------------------------------------------------------------------

const generationCache = new Map<string, PoseDefinition | null>();

function cacheKey(descriptor: string): string {
  return descriptor.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Keypoint validation
// ---------------------------------------------------------------------------

function isValidKeypoint(kp: unknown): kp is PoseKeypoint {
  if (kp === null) return true;
  return (
    Array.isArray(kp) &&
    kp.length === 2 &&
    typeof kp[0] === 'number' &&
    typeof kp[1] === 'number' &&
    kp[0] >= 0 && kp[0] <= 1 &&
    kp[1] >= 0 && kp[1] <= 1
  );
}

function validateSkeletonKeypoints(keypoints: unknown[]): keypoints is PoseKeypoint[] {
  return keypoints.length === 18 && keypoints.every(isValidKeypoint);
}

// ---------------------------------------------------------------------------
// Claude prompt for keypoint generation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an OpenPose skeleton designer for SDXL ControlNet conditioning.
You generate COCO-18 keypoint coordinates for two-person poses.

Output ONLY valid JSON — no markdown, no explanation.

Keypoint order (per skeleton):
  0: Nose, 1: Neck, 2: RShoulder, 3: RElbow, 4: RWrist,
  5: LShoulder, 6: LElbow, 7: LWrist, 8: RHip, 9: RKnee,
  10: RAnkle, 11: LHip, 12: LKnee, 13: LAnkle,
  14: REye, 15: LEye, 16: REar, 17: LEar

Rules:
- All coordinates normalized 0–1. (0,0) = top-left, (1,1) = bottom-right.
- Right/Left are the PERSON's own right/left.
- Use null for occluded keypoints (behind partner, facing away, etc.).
- Maintain anatomical proportions: head ~6-8% of frame height, torso ~28-32%, legs ~45-50%.
- Shoulder width ~12-16% of frame width per person.
- For landscape (wider): spread characters left/right.
- For portrait (taller): allow vertical overlap, use more vertical space.
- For square: balanced, can use diagonal arrangements.
- Ensure the two skeletons' spatial arrangement clearly conveys the described pose.
- For intimate/touching poses, hands/arms should reach into the other person's space.`;

function buildUserPrompt(
  descriptor: string,
  category: ContentLevel,
  orientation: PoseOrientation,
  framing: PoseFraming,
): string {
  return `Generate a two-person OpenPose skeleton for this pose:

POSE: ${descriptor}
CONTENT: ${category}
ORIENTATION: ${orientation}
FRAMING: ${framing}

Respond with this exact JSON structure:
{
  "skeletons": [
    { "label": "character_a", "keypoints": [[x,y], [x,y], ...or null..., 18 total] },
    { "label": "character_b", "keypoints": [[x,y], [x,y], ...or null..., 18 total] }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Parse Claude's JSON response
// ---------------------------------------------------------------------------

interface GeneratedSkeletons {
  skeletons: Array<{
    label: string;
    keypoints: (PoseKeypoint | [number, number])[];
  }>;
}

function parseResponse(text: string): GeneratedSkeletons | null {
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.skeletons || !Array.isArray(parsed.skeletons) || parsed.skeletons.length !== 2) {
      return null;
    }
    for (const skel of parsed.skeletons) {
      if (!skel.keypoints || !validateSkeletonKeypoints(skel.keypoints)) {
        return null;
      }
    }
    return parsed as GeneratedSkeletons;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GeneratePoseOptions {
  descriptor: string;
  category: ContentLevel;
  orientation: PoseOrientation;
  framing: PoseFraming;
  /** Keywords for future auto-matching */
  keywords?: string[];
  /** InteractionTypes this pose maps to */
  interactionTypes?: Array<'intimate' | 'romantic' | 'conversational' | 'confrontational' | 'side-by-side' | 'observing' | 'unknown'>;
}

/**
 * Generate a new pose via Claude, register it, and return the definition.
 * Returns null if generation or validation fails.
 * Results are cached — repeated calls with the same descriptor are free.
 */
export async function generatePose(opts: GeneratePoseOptions): Promise<PoseDefinition | null> {
  const key = cacheKey(opts.descriptor);

  // Check cache
  if (generationCache.has(key)) {
    const cached = generationCache.get(key)!;
    if (cached) console.log(`[PoseGen] Cache hit: ${opts.descriptor}`);
    return cached;
  }

  console.log(`[PoseGen] Generating pose: ${opts.descriptor}`);

  const anthropic = new Anthropic();

  let parsed: GeneratedSkeletons | null = null;

  // Two attempts: if first parse fails, retry once
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildUserPrompt(opts.descriptor, opts.category, opts.orientation, opts.framing) },
        ],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      parsed = parseResponse(text);
      if (parsed) break;

      console.log(`[PoseGen] Parse failed (attempt ${attempt + 1}), retrying...`);
    } catch (err) {
      console.error(`[PoseGen] API error:`, err);
      break;
    }
  }

  if (!parsed) {
    console.error(`[PoseGen] Failed to generate pose: ${opts.descriptor}`);
    generationCache.set(key, null);
    return null;
  }

  // Build the PoseDefinition
  const id = `generated-${key.replace(/\s+/g, '-').slice(0, 60)}`;

  const pose: PoseDefinition = {
    id,
    name: opts.descriptor.slice(0, 80),
    descriptor: opts.descriptor,
    category: opts.category,
    characterCount: 2,
    orientation: opts.orientation,
    framing: opts.framing,
    interactionTypes: opts.interactionTypes ?? ['intimate'],
    keywords: opts.keywords ?? opts.descriptor.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    skeletons: [
      { label: parsed.skeletons[0].label, keypoints: parsed.skeletons[0].keypoints },
      { label: parsed.skeletons[1].label, keypoints: parsed.skeletons[1].keypoints },
    ],
  };

  // Register into live catalog
  registerPose(pose);
  generationCache.set(key, pose);

  console.log(`[PoseGen] Registered: ${id} (${opts.orientation}, ${opts.category})`);
  return pose;
}

/**
 * Generate a pose AND render it to a PNG buffer in one call.
 * Convenience wrapper for the workflow builder.
 */
export async function generateAndRenderPose(
  opts: GeneratePoseOptions,
): Promise<{ pose: PoseDefinition; buffer: Buffer; width: number; height: number } | null> {
  const pose = await generatePose(opts);
  if (!pose) return null;

  const { buffer, width, height } = await renderPose(pose);
  return { pose, buffer, width, height };
}
