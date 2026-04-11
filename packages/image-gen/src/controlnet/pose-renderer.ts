/**
 * Renders OpenPose skeletons to PNG using sharp's SVG compositing.
 *
 * Each pose's normalized (0-1) keypoints are scaled to the target
 * resolution, drawn as colored limb lines + white keypoint circles
 * on a black background — the standard OpenPose visualization that
 * ControlNet expects.
 */

import sharp from 'sharp';
import type { PoseDefinition, PoseSkeleton, PoseOrientation } from './types';
import { COCO_LIMBS, LIMB_COLORS } from './types';

// ---------------------------------------------------------------------------
// Resolution map — matches dimension-presets.ts for two-character scenes
// ---------------------------------------------------------------------------

const RESOLUTION_MAP: Record<PoseOrientation, { width: number; height: number }> = {
  landscape: { width: 1280, height: 960 },
  portrait:  { width: 960,  height: 1280 },
  square:    { width: 1280, height: 1280 },
};

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

const LINE_WIDTH = 6;
const KEYPOINT_RADIUS = 6;

function rgbHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function skeletonToSVGElements(
  skeleton: PoseSkeleton,
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  const kps = skeleton.keypoints;

  // Draw limb lines
  for (let i = 0; i < COCO_LIMBS.length; i++) {
    const [a, b] = COCO_LIMBS[i];
    const ka = kps[a];
    const kb = kps[b];
    if (!ka || !kb) continue;
    const [r, g, bl] = LIMB_COLORS[i];
    const x1 = Math.round(ka[0] * width);
    const y1 = Math.round(ka[1] * height);
    const x2 = Math.round(kb[0] * width);
    const y2 = Math.round(kb[1] * height);
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
      `stroke="${rgbHex(r, g, bl)}" stroke-width="${LINE_WIDTH}" stroke-linecap="round"/>`,
    );
  }

  // Draw keypoint circles
  for (const kp of kps) {
    if (!kp) continue;
    const cx = Math.round(kp[0] * width);
    const cy = Math.round(kp[1] * height);
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${KEYPOINT_RADIUS}" fill="white"/>`,
    );
  }

  return parts.join('\n');
}

function buildSVG(
  pose: PoseDefinition,
  width: number,
  height: number,
): string {
  const elements = pose.skeletons
    .map((s) => skeletonToSVGElements(s, width, height))
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    elements,
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a pose to a PNG buffer at the resolution matching its orientation.
 * Returns { buffer, width, height }.
 */
export async function renderPose(
  pose: PoseDefinition,
  overrideWidth?: number,
  overrideHeight?: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { width, height } = overrideWidth && overrideHeight
    ? { width: overrideWidth, height: overrideHeight }
    : RESOLUTION_MAP[pose.orientation];

  const svg = buildSVG(pose, width, height);

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { buffer, width, height };
}

/**
 * Render a pose and write directly to a file path.
 */
export async function renderPoseToFile(
  pose: PoseDefinition,
  filePath: string,
): Promise<void> {
  const { buffer } = await renderPose(pose);
  await sharp(buffer).toFile(filePath);
}
