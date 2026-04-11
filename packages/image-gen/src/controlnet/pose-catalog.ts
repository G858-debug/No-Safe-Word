/**
 * OpenPose skeleton catalog for ControlNet two-character conditioning.
 *
 * ~25 poses covering the full SFW → intimate → explicit progression
 * typical of adult romance fiction.  Each pose defines two COCO-18
 * skeletons in normalized (0-1) coordinates that get scaled to the
 * target SDXL resolution at render time.
 *
 * Keypoint order per skeleton:
 *   0 Nose, 1 Neck, 2 RShoulder, 3 RElbow, 4 RWrist,
 *   5 LShoulder, 6 LElbow, 7 LWrist, 8 RHip, 9 RKnee,
 *   10 RAnkle, 11 LHip, 12 LKnee, 13 LAnkle,
 *   14 REye, 15 LEye, 16 REar, 17 LEar
 *
 * "Right/Left" are the PERSON's own right/left.
 * null = keypoint is occluded / not visible in this camera angle.
 *
 * The dynamic pose generator (pose-generator.ts) extends this catalog
 * at runtime when the evaluator detects a pose gap.
 */

import type { PoseDefinition, PoseKeypoint } from './types';

// ---------------------------------------------------------------------------
// Helper — keeps the array declarations readable
// ---------------------------------------------------------------------------
const kp = (x: number, y: number): PoseKeypoint => [x, y];

// ---------------------------------------------------------------------------
// The catalog is mutable — dynamic poses are appended at runtime
// ---------------------------------------------------------------------------
export const POSE_CATALOG: PoseDefinition[] = [];

// ===================================================================
//  SFW POSES — Facebook teasers, "moment before" shots
// ===================================================================

const standingEmbrace: PoseDefinition = {
  id: 'standing-embrace',
  name: 'Standing Embrace',
  descriptor: 'Two people standing face-to-face in a close hug, arms wrapped around each other',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'three-quarter',
  interactionTypes: ['romantic', 'intimate'],
  keywords: ['embrace', 'hug', 'hugging', 'holding each other', 'arms around', 'hold me', 'wrapped in arms'],
  skeletons: [
    { label: 'character_a', keypoints: [
      kp(0.38, 0.15), kp(0.36, 0.22), kp(0.30, 0.26), kp(0.28, 0.36), kp(0.54, 0.34),
      kp(0.42, 0.26), kp(0.48, 0.36), kp(0.64, 0.40), kp(0.33, 0.48), kp(0.32, 0.66),
      kp(0.31, 0.84), kp(0.39, 0.48), kp(0.40, 0.66), kp(0.41, 0.84),
      kp(0.36, 0.13), kp(0.40, 0.13), kp(0.34, 0.14), kp(0.42, 0.14),
    ]},
    { label: 'character_b', keypoints: [
      kp(0.62, 0.13), kp(0.64, 0.20), kp(0.70, 0.24), kp(0.72, 0.34), kp(0.46, 0.38),
      kp(0.58, 0.24), kp(0.52, 0.34), kp(0.36, 0.36), kp(0.67, 0.46), kp(0.68, 0.64),
      kp(0.69, 0.82), kp(0.61, 0.46), kp(0.60, 0.64), kp(0.59, 0.82),
      kp(0.64, 0.11), kp(0.60, 0.11), kp(0.66, 0.12), kp(0.58, 0.12),
    ]},
  ],
};

const seatedTogether: PoseDefinition = {
  id: 'seated-together',
  name: 'Seated Together',
  descriptor: 'Two people sitting side by side on a couch or bench, bodies angled toward each other',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'three-quarter',
  interactionTypes: ['conversational', 'romantic'],
  keywords: ['seated', 'sitting together', 'couch', 'sofa', 'bench', 'side by side', 'sitting close'],
  skeletons: [
    { label: 'character_a', keypoints: [
      kp(0.28, 0.18), kp(0.27, 0.25), kp(0.21, 0.29), kp(0.18, 0.39), kp(0.20, 0.48),
      kp(0.33, 0.29), kp(0.38, 0.39), kp(0.42, 0.48), kp(0.23, 0.52), kp(0.28, 0.70),
      kp(0.24, 0.86), kp(0.31, 0.52), kp(0.38, 0.68), kp(0.34, 0.84),
      kp(0.26, 0.16), kp(0.30, 0.16), kp(0.24, 0.17), kp(0.32, 0.17),
    ]},
    { label: 'character_b', keypoints: [
      kp(0.72, 0.16), kp(0.73, 0.23), kp(0.79, 0.27), kp(0.82, 0.37), kp(0.80, 0.46),
      kp(0.67, 0.27), kp(0.62, 0.37), kp(0.58, 0.46), kp(0.77, 0.50), kp(0.72, 0.68),
      kp(0.76, 0.84), kp(0.69, 0.50), kp(0.62, 0.66), kp(0.66, 0.82),
      kp(0.74, 0.14), kp(0.70, 0.14), kp(0.76, 0.15), kp(0.68, 0.15),
    ]},
  ],
};

const backEmbrace: PoseDefinition = {
  id: 'back-embrace',
  name: 'Back Embrace',
  descriptor: 'One person standing behind the other with arms wrapped around their waist, both facing forward',
  category: 'sfw',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'three-quarter',
  interactionTypes: ['romantic', 'intimate'],
  keywords: ['behind', 'back hug', 'arms around waist', 'from behind', 'wrapped around', 'hold from behind'],
  skeletons: [
    { label: 'character_a', keypoints: [ // behind
      kp(0.45, 0.14), kp(0.44, 0.19), kp(0.38, 0.22), kp(0.35, 0.30), kp(0.48, 0.36),
      kp(0.50, 0.22), kp(0.55, 0.30), kp(0.56, 0.36), kp(0.40, 0.42), kp(0.39, 0.58),
      kp(0.38, 0.74), kp(0.48, 0.42), kp(0.49, 0.58), kp(0.50, 0.74),
      kp(0.43, 0.12), kp(0.47, 0.12), kp(0.41, 0.13), kp(0.49, 0.13),
    ]},
    { label: 'character_b', keypoints: [ // in front
      kp(0.52, 0.12), kp(0.52, 0.17), kp(0.45, 0.20), kp(0.40, 0.28), kp(0.38, 0.36),
      kp(0.59, 0.20), kp(0.64, 0.28), kp(0.66, 0.36), kp(0.47, 0.40), kp(0.46, 0.56),
      kp(0.45, 0.72), kp(0.57, 0.40), kp(0.58, 0.56), kp(0.59, 0.72),
      kp(0.50, 0.10), kp(0.54, 0.10), kp(0.48, 0.11), kp(0.56, 0.11),
    ]},
  ],
};

const walkingTogether: PoseDefinition = {
  id: 'walking-together',
  name: 'Walking Together',
  descriptor: 'Two people walking side by side in close proximity, one arm linked or hand-holding',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'full-body',
  interactionTypes: ['side-by-side', 'romantic'],
  keywords: ['walking', 'strolling', 'side by side', 'hand in hand', 'arm in arm', 'walking together'],
  skeletons: [
    { label: 'character_a', keypoints: [
      kp(0.32, 0.08), kp(0.32, 0.14), kp(0.26, 0.18), kp(0.24, 0.28), kp(0.26, 0.36),
      kp(0.38, 0.18), kp(0.40, 0.26), kp(0.44, 0.32), kp(0.28, 0.38), kp(0.24, 0.56),
      kp(0.22, 0.74), kp(0.36, 0.38), kp(0.40, 0.54), kp(0.38, 0.72),
      kp(0.30, 0.06), kp(0.34, 0.06), kp(0.28, 0.07), kp(0.36, 0.07),
    ]},
    { label: 'character_b', keypoints: [
      kp(0.62, 0.06), kp(0.62, 0.12), kp(0.68, 0.16), kp(0.70, 0.24), kp(0.68, 0.32),
      kp(0.56, 0.16), kp(0.54, 0.24), kp(0.48, 0.30), kp(0.66, 0.36), kp(0.70, 0.52),
      kp(0.68, 0.70), kp(0.58, 0.36), kp(0.54, 0.54), kp(0.56, 0.72),
      kp(0.64, 0.04), kp(0.60, 0.04), kp(0.66, 0.05), kp(0.58, 0.05),
    ]},
  ],
};

const faceToFaceClose: PoseDefinition = {
  id: 'face-to-face-close',
  name: 'Face to Face Close',
  descriptor: 'Two people standing very close face-to-face, intense eye contact, hands lightly touching',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['romantic', 'conversational'],
  keywords: ['face to face', 'eye contact', 'close', 'staring', 'looking into eyes', 'inches apart', 'almost kissing'],
  skeletons: [
    { label: 'character_a', keypoints: [
      kp(0.40, 0.18), kp(0.38, 0.26), kp(0.32, 0.30), kp(0.30, 0.40), kp(0.48, 0.38),
      kp(0.44, 0.30), kp(0.46, 0.40), kp(0.50, 0.48), kp(0.34, 0.52), kp(0.33, 0.70),
      kp(0.32, 0.88), kp(0.42, 0.52), kp(0.43, 0.70), kp(0.44, 0.88),
      kp(0.38, 0.16), kp(0.42, 0.16), kp(0.36, 0.17), kp(0.44, 0.17),
    ]},
    { label: 'character_b', keypoints: [
      kp(0.60, 0.16), kp(0.62, 0.24), kp(0.68, 0.28), kp(0.70, 0.38), kp(0.52, 0.36),
      kp(0.56, 0.28), kp(0.54, 0.38), kp(0.50, 0.46), kp(0.66, 0.50), kp(0.67, 0.68),
      kp(0.68, 0.86), kp(0.58, 0.50), kp(0.57, 0.68), kp(0.56, 0.86),
      kp(0.62, 0.14), kp(0.58, 0.14), kp(0.64, 0.15), kp(0.56, 0.15),
    ]},
  ],
};

const dancingClose: PoseDefinition = {
  id: 'dancing-close',
  name: 'Dancing Close',
  descriptor: 'Two people in a close dance hold, one hand on waist, one hand held, bodies near',
  category: 'sfw',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'three-quarter',
  interactionTypes: ['romantic'],
  keywords: ['dancing', 'dance', 'slow dance', 'holding hands', 'dance floor', 'waltz', 'sway'],
  skeletons: [
    { label: 'character_a', keypoints: [ // leading
      kp(0.42, 0.12), kp(0.42, 0.18), kp(0.36, 0.22), kp(0.30, 0.30), kp(0.52, 0.34),
      kp(0.48, 0.22), kp(0.54, 0.28), kp(0.60, 0.20), kp(0.38, 0.42), kp(0.36, 0.58),
      kp(0.35, 0.74), kp(0.46, 0.42), kp(0.48, 0.58), kp(0.50, 0.74),
      kp(0.40, 0.10), kp(0.44, 0.10), kp(0.38, 0.11), kp(0.46, 0.11),
    ]},
    { label: 'character_b', keypoints: [ // following
      kp(0.58, 0.10), kp(0.58, 0.16), kp(0.64, 0.20), kp(0.68, 0.28), kp(0.48, 0.32),
      kp(0.52, 0.20), kp(0.48, 0.26), kp(0.40, 0.18), kp(0.62, 0.40), kp(0.64, 0.56),
      kp(0.66, 0.72), kp(0.54, 0.40), kp(0.52, 0.56), kp(0.50, 0.72),
      kp(0.60, 0.08), kp(0.56, 0.08), kp(0.62, 0.09), kp(0.54, 0.09),
    ]},
  ],
};

const foreheadTouch: PoseDefinition = {
  id: 'forehead-touch',
  name: 'Forehead Touch',
  descriptor: 'Two people with foreheads resting together, eyes closed, hands on each other, intimate stillness',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['romantic', 'intimate'],
  keywords: ['forehead', 'foreheads together', 'foreheads touching', 'eyes closed', 'tender', 'gentle moment'],
  skeletons: [
    { label: 'character_a', keypoints: [
      kp(0.46, 0.16), kp(0.40, 0.24), kp(0.34, 0.28), kp(0.30, 0.38), kp(0.54, 0.30),
      kp(0.46, 0.28), kp(0.50, 0.36), kp(0.58, 0.42), kp(0.36, 0.50), kp(0.35, 0.68),
      kp(0.34, 0.86), kp(0.44, 0.50), kp(0.45, 0.68), kp(0.46, 0.86),
      kp(0.44, 0.14), kp(0.48, 0.14), kp(0.42, 0.15), null,
    ]},
    { label: 'character_b', keypoints: [
      kp(0.54, 0.14), kp(0.60, 0.22), kp(0.66, 0.26), kp(0.70, 0.36), kp(0.46, 0.28),
      kp(0.54, 0.26), kp(0.50, 0.34), kp(0.42, 0.40), kp(0.64, 0.48), kp(0.65, 0.66),
      kp(0.66, 0.84), kp(0.56, 0.48), kp(0.55, 0.66), kp(0.54, 0.84),
      kp(0.56, 0.12), kp(0.52, 0.12), null, kp(0.50, 0.13),
    ]},
  ],
};

const handOnFace: PoseDefinition = {
  id: 'hand-on-face',
  name: 'Hand on Face',
  descriptor: 'One person cupping the others face with one hand, close proximity, tender gaze',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['romantic'],
  keywords: ['cupping face', 'hand on cheek', 'touching face', 'caress', 'tender touch', 'hand on face'],
  skeletons: [
    { label: 'character_a', keypoints: [ // cupping B's face
      kp(0.38, 0.18), kp(0.36, 0.26), kp(0.30, 0.30), kp(0.28, 0.40), kp(0.30, 0.48),
      kp(0.42, 0.30), kp(0.48, 0.34), kp(0.58, 0.18), kp(0.33, 0.52), kp(0.32, 0.70),
      kp(0.31, 0.88), kp(0.39, 0.52), kp(0.40, 0.70), kp(0.41, 0.88),
      kp(0.36, 0.16), kp(0.40, 0.16), kp(0.34, 0.17), kp(0.42, 0.17),
    ]},
    { label: 'character_b', keypoints: [ // face being cupped
      kp(0.62, 0.16), kp(0.64, 0.24), kp(0.70, 0.28), kp(0.72, 0.38), kp(0.70, 0.46),
      kp(0.58, 0.28), kp(0.54, 0.38), kp(0.52, 0.46), kp(0.68, 0.50), kp(0.69, 0.68),
      kp(0.70, 0.86), kp(0.60, 0.50), kp(0.59, 0.68), kp(0.58, 0.86),
      kp(0.64, 0.14), kp(0.60, 0.14), kp(0.66, 0.15), kp(0.58, 0.15),
    ]},
  ],
};

const leaningOnShoulder: PoseDefinition = {
  id: 'leaning-on-shoulder',
  name: 'Leaning on Shoulder',
  descriptor: 'One person resting their head on the others shoulder, sitting or standing close, quiet intimacy',
  category: 'sfw',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['romantic', 'side-by-side'],
  keywords: ['head on shoulder', 'leaning on', 'resting head', 'shoulder', 'leaning against', 'nuzzle'],
  skeletons: [
    { label: 'character_a', keypoints: [ // person being leaned on
      kp(0.38, 0.16), kp(0.38, 0.24), kp(0.32, 0.28), kp(0.28, 0.38), kp(0.30, 0.46),
      kp(0.44, 0.28), kp(0.50, 0.36), kp(0.56, 0.42), kp(0.34, 0.50), kp(0.33, 0.68),
      kp(0.32, 0.86), kp(0.42, 0.50), kp(0.43, 0.68), kp(0.44, 0.86),
      kp(0.36, 0.14), kp(0.40, 0.14), kp(0.34, 0.15), kp(0.42, 0.15),
    ]},
    { label: 'character_b', keypoints: [ // leaning, head on A's shoulder
      kp(0.48, 0.22), kp(0.58, 0.26), kp(0.64, 0.30), kp(0.68, 0.40), kp(0.66, 0.48),
      kp(0.52, 0.30), kp(0.48, 0.40), kp(0.44, 0.46), kp(0.62, 0.52), kp(0.63, 0.70),
      kp(0.64, 0.88), kp(0.54, 0.52), kp(0.53, 0.70), kp(0.52, 0.88),
      kp(0.46, 0.20), kp(0.50, 0.20), null, kp(0.52, 0.21),
    ]},
  ],
};

// ===================================================================
//  INTIMATE / ROMANTIC POSES — transition moments, building tension
// ===================================================================

const kissingStanding: PoseDefinition = {
  id: 'kissing-standing',
  name: 'Kissing (Standing)',
  descriptor: 'Two people in a deep standing kiss, bodies pressed together, heads tilted',
  category: 'intimate',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'three-quarter',
  interactionTypes: ['intimate', 'romantic'],
  keywords: ['kiss', 'kissing', 'lips', 'mouths together', 'lips touching', 'deep kiss', 'passionate kiss', 'making out'],
  skeletons: [
    { label: 'character_a', keypoints: [
      kp(0.43, 0.16), kp(0.38, 0.22), kp(0.32, 0.26), kp(0.28, 0.36), kp(0.56, 0.30),
      kp(0.44, 0.26), kp(0.50, 0.36), kp(0.62, 0.40), kp(0.34, 0.48), kp(0.33, 0.66),
      kp(0.32, 0.84), kp(0.42, 0.48), kp(0.43, 0.66), kp(0.44, 0.84),
      kp(0.41, 0.14), kp(0.45, 0.14), kp(0.38, 0.15), null,
    ]},
    { label: 'character_b', keypoints: [
      kp(0.57, 0.14), kp(0.62, 0.20), kp(0.68, 0.24), kp(0.72, 0.34), kp(0.44, 0.36),
      kp(0.56, 0.24), kp(0.50, 0.34), kp(0.38, 0.28), kp(0.66, 0.46), kp(0.67, 0.64),
      kp(0.68, 0.82), kp(0.58, 0.46), kp(0.57, 0.64), kp(0.56, 0.82),
      kp(0.59, 0.12), kp(0.55, 0.12), null, kp(0.53, 0.13),
    ]},
  ],
};

const pinnedAgainstWall: PoseDefinition = {
  id: 'pinned-against-wall',
  name: 'Pinned Against Wall',
  descriptor: 'One person pressing the other against a wall, face to face, one arm braced on the wall',
  category: 'intimate',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'three-quarter',
  interactionTypes: ['intimate', 'romantic'],
  keywords: ['against wall', 'pinned', 'pressed against', 'wall', 'pushed against', 'cornered', 'trapped against'],
  skeletons: [
    { label: 'character_a', keypoints: [ // pressing
      kp(0.42, 0.16), kp(0.40, 0.22), kp(0.34, 0.26), kp(0.36, 0.34), kp(0.58, 0.20),
      kp(0.46, 0.26), kp(0.50, 0.34), kp(0.60, 0.38), kp(0.36, 0.48), kp(0.35, 0.64),
      kp(0.34, 0.80), kp(0.44, 0.48), kp(0.46, 0.64), kp(0.48, 0.80),
      kp(0.40, 0.14), kp(0.44, 0.14), kp(0.38, 0.15), null,
    ]},
    { label: 'character_b', keypoints: [ // against wall
      kp(0.58, 0.14), kp(0.60, 0.20), kp(0.66, 0.24), kp(0.70, 0.32), kp(0.68, 0.18),
      kp(0.54, 0.24), kp(0.48, 0.32), kp(0.42, 0.28), kp(0.64, 0.46), kp(0.66, 0.62),
      kp(0.68, 0.78), kp(0.56, 0.46), kp(0.54, 0.62), kp(0.52, 0.78),
      kp(0.60, 0.12), kp(0.56, 0.12), kp(0.62, 0.13), null,
    ]},
  ],
};

const lapStraddling: PoseDefinition = {
  id: 'lap-straddling',
  name: 'Lap Straddling',
  descriptor: 'One person seated, the other straddling their lap face-to-face, hands on shoulders or chest',
  category: 'intimate',
  characterCount: 2,
  orientation: 'square',
  framing: 'medium',
  interactionTypes: ['intimate', 'romantic'],
  keywords: ['lap', 'straddling', 'straddle', 'on top', 'sitting on', 'face to face seated'],
  skeletons: [
    { label: 'character_a', keypoints: [ // seated underneath
      kp(0.50, 0.28), kp(0.50, 0.34), kp(0.42, 0.38), kp(0.36, 0.48), kp(0.40, 0.56),
      kp(0.58, 0.38), kp(0.64, 0.48), kp(0.60, 0.56), kp(0.44, 0.60), kp(0.38, 0.76),
      kp(0.34, 0.90), kp(0.56, 0.60), kp(0.62, 0.76), kp(0.66, 0.90),
      kp(0.48, 0.26), kp(0.52, 0.26), kp(0.46, 0.27), kp(0.54, 0.27),
    ]},
    { label: 'character_b', keypoints: [ // straddling on top
      kp(0.50, 0.18), kp(0.50, 0.24), kp(0.43, 0.28), kp(0.38, 0.36), kp(0.44, 0.42),
      kp(0.57, 0.28), kp(0.62, 0.36), kp(0.56, 0.42), kp(0.44, 0.50), kp(0.34, 0.64),
      kp(0.30, 0.78), kp(0.56, 0.50), kp(0.66, 0.64), kp(0.70, 0.78),
      kp(0.48, 0.16), kp(0.52, 0.16), kp(0.46, 0.17), kp(0.54, 0.17),
    ]},
  ],
};

const neckKissing: PoseDefinition = {
  id: 'neck-kissing',
  name: 'Neck Kissing',
  descriptor: 'One person tilting head back, the other kissing their neck or collarbone, standing close',
  category: 'intimate',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'medium',
  interactionTypes: ['intimate'],
  keywords: ['neck kiss', 'kissing neck', 'collarbone', 'tilted head', 'throat', 'neck nuzzle', 'nibbling neck'],
  skeletons: [
    { label: 'character_a', keypoints: [ // kissing B's neck
      kp(0.52, 0.20), kp(0.46, 0.24), kp(0.40, 0.28), kp(0.36, 0.36), kp(0.54, 0.32),
      kp(0.52, 0.28), kp(0.56, 0.36), kp(0.62, 0.42), kp(0.42, 0.48), kp(0.40, 0.64),
      kp(0.39, 0.80), kp(0.50, 0.48), kp(0.52, 0.64), kp(0.54, 0.80),
      kp(0.50, 0.18), kp(0.54, 0.18), kp(0.48, 0.19), null,
    ]},
    { label: 'character_b', keypoints: [ // head tilted back, neck exposed
      kp(0.56, 0.14), kp(0.56, 0.22), kp(0.62, 0.26), kp(0.66, 0.34), kp(0.64, 0.42),
      kp(0.50, 0.26), kp(0.46, 0.34), kp(0.42, 0.40), kp(0.60, 0.48), kp(0.62, 0.64),
      kp(0.64, 0.80), kp(0.52, 0.48), kp(0.50, 0.64), kp(0.48, 0.80),
      kp(0.58, 0.12), kp(0.54, 0.12), kp(0.60, 0.12), null,
    ]},
  ],
};

const kissingSeated: PoseDefinition = {
  id: 'kissing-seated',
  name: 'Kissing (Seated)',
  descriptor: 'Two people kissing while seated together on a couch, one leaning into the other',
  category: 'intimate',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['intimate', 'romantic'],
  keywords: ['kissing on couch', 'kiss seated', 'making out couch', 'kiss sofa', 'seated kiss'],
  skeletons: [
    { label: 'character_a', keypoints: [ // leaning in
      kp(0.42, 0.20), kp(0.36, 0.28), kp(0.30, 0.32), kp(0.26, 0.42), kp(0.28, 0.50),
      kp(0.42, 0.32), kp(0.48, 0.38), kp(0.56, 0.32), kp(0.32, 0.54), kp(0.30, 0.72),
      kp(0.26, 0.88), kp(0.40, 0.54), kp(0.44, 0.70), kp(0.42, 0.86),
      kp(0.40, 0.18), kp(0.44, 0.18), kp(0.38, 0.19), null,
    ]},
    { label: 'character_b', keypoints: [ // receiving
      kp(0.58, 0.18), kp(0.64, 0.26), kp(0.70, 0.30), kp(0.74, 0.40), kp(0.72, 0.48),
      kp(0.58, 0.30), kp(0.52, 0.36), kp(0.44, 0.30), kp(0.68, 0.52), kp(0.70, 0.70),
      kp(0.74, 0.86), kp(0.60, 0.52), kp(0.56, 0.68), kp(0.58, 0.84),
      kp(0.60, 0.16), kp(0.56, 0.16), null, kp(0.54, 0.17),
    ]},
  ],
};

const pushedOntoBed: PoseDefinition = {
  id: 'pushed-onto-bed',
  name: 'Pushed Onto Bed',
  descriptor: 'One person pushing or lowering the other onto a bed, the bottom person leaning back on elbows',
  category: 'intimate',
  characterCount: 2,
  orientation: 'square',
  framing: 'three-quarter',
  interactionTypes: ['intimate'],
  keywords: ['push onto bed', 'pushed down', 'lowering onto', 'falling back', 'onto the bed', 'pull down', 'pushed back'],
  skeletons: [
    { label: 'character_a', keypoints: [ // standing/leaning over
      kp(0.45, 0.18), kp(0.44, 0.26), kp(0.38, 0.30), kp(0.34, 0.38), kp(0.50, 0.34),
      kp(0.50, 0.30), kp(0.54, 0.38), kp(0.58, 0.34), kp(0.40, 0.50), kp(0.38, 0.66),
      kp(0.36, 0.82), kp(0.48, 0.50), kp(0.50, 0.66), kp(0.52, 0.82),
      kp(0.43, 0.16), kp(0.47, 0.16), kp(0.41, 0.17), kp(0.49, 0.17),
    ]},
    { label: 'character_b', keypoints: [ // falling back onto bed
      kp(0.56, 0.30), kp(0.56, 0.38), kp(0.62, 0.42), kp(0.68, 0.48), kp(0.72, 0.54),
      kp(0.50, 0.42), kp(0.46, 0.48), kp(0.42, 0.44), kp(0.60, 0.58), kp(0.64, 0.72),
      kp(0.66, 0.86), kp(0.52, 0.58), kp(0.48, 0.72), kp(0.46, 0.86),
      kp(0.58, 0.28), kp(0.54, 0.28), kp(0.60, 0.29), kp(0.52, 0.29),
    ]},
  ],
};

const lyingFaceToFace: PoseDefinition = {
  id: 'lying-face-to-face',
  name: 'Lying Face to Face',
  descriptor: 'Both people lying on their sides in bed facing each other, heads on pillows, intimate closeness',
  category: 'intimate',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['romantic', 'intimate'],
  keywords: ['lying facing', 'in bed together', 'pillow talk', 'face to face bed', 'lying on sides', 'beside each other'],
  skeletons: [
    { label: 'character_a', keypoints: [ // left, on right side, facing right
      kp(0.24, 0.32), kp(0.28, 0.38), kp(0.32, 0.42), kp(0.30, 0.50), kp(0.26, 0.54),
      kp(0.32, 0.36), kp(0.36, 0.42), kp(0.44, 0.40), kp(0.38, 0.52), kp(0.42, 0.64),
      kp(0.44, 0.76), kp(0.38, 0.48), kp(0.42, 0.58), kp(0.44, 0.68),
      kp(0.22, 0.30), kp(0.26, 0.30), kp(0.20, 0.32), null,
    ]},
    { label: 'character_b', keypoints: [ // right, on left side, facing left
      kp(0.66, 0.30), kp(0.62, 0.36), kp(0.58, 0.40), kp(0.60, 0.48), kp(0.64, 0.52),
      kp(0.58, 0.34), kp(0.54, 0.40), kp(0.46, 0.38), kp(0.56, 0.50), kp(0.52, 0.62),
      kp(0.50, 0.74), kp(0.56, 0.46), kp(0.52, 0.56), kp(0.50, 0.66),
      kp(0.68, 0.28), kp(0.64, 0.28), null, kp(0.62, 0.30),
    ]},
  ],
};

const undressing: PoseDefinition = {
  id: 'undressing',
  name: 'Undressing',
  descriptor: 'One person removing or lifting the others clothing, standing close, hands on garment',
  category: 'intimate',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'three-quarter',
  interactionTypes: ['intimate'],
  keywords: ['undressing', 'removing clothes', 'taking off', 'unbutton', 'pull off', 'lift shirt', 'strip', 'disrobe'],
  skeletons: [
    { label: 'character_a', keypoints: [ // undressing B
      kp(0.42, 0.14), kp(0.42, 0.20), kp(0.36, 0.24), kp(0.34, 0.32), kp(0.52, 0.28),
      kp(0.48, 0.24), kp(0.52, 0.30), kp(0.58, 0.26), kp(0.38, 0.44), kp(0.37, 0.60),
      kp(0.36, 0.76), kp(0.46, 0.44), kp(0.47, 0.60), kp(0.48, 0.76),
      kp(0.40, 0.12), kp(0.44, 0.12), kp(0.38, 0.13), kp(0.46, 0.13),
    ]},
    { label: 'character_b', keypoints: [ // being undressed, arms up
      kp(0.58, 0.12), kp(0.58, 0.18), kp(0.64, 0.22), kp(0.68, 0.16), kp(0.70, 0.10),
      kp(0.52, 0.22), kp(0.48, 0.16), kp(0.46, 0.10), kp(0.62, 0.42), kp(0.64, 0.58),
      kp(0.66, 0.74), kp(0.54, 0.42), kp(0.52, 0.58), kp(0.50, 0.74),
      kp(0.60, 0.10), kp(0.56, 0.10), kp(0.62, 0.11), kp(0.54, 0.11),
    ]},
  ],
};

// ===================================================================
//  EXPLICIT POSES — NSFW scenes
// ===================================================================

const missionary: PoseDefinition = {
  id: 'missionary',
  name: 'Missionary',
  descriptor: 'One person lying on their back, legs apart; the other on top propped on arms, face to face',
  category: 'explicit',
  characterCount: 2,
  orientation: 'square',
  framing: 'full-body',
  interactionTypes: ['intimate'],
  keywords: ['missionary', 'lying down', 'on top', 'face to face', 'between legs', 'lying back', 'on the bed'],
  skeletons: [
    { label: 'character_a', keypoints: [ // bottom
      kp(0.45, 0.30), kp(0.44, 0.36), kp(0.36, 0.40), kp(0.26, 0.38), kp(0.20, 0.32),
      kp(0.52, 0.40), kp(0.60, 0.42), kp(0.58, 0.34), kp(0.38, 0.58), kp(0.30, 0.70),
      kp(0.26, 0.82), kp(0.50, 0.58), kp(0.58, 0.72), kp(0.62, 0.84),
      kp(0.43, 0.28), kp(0.47, 0.28), kp(0.41, 0.30), kp(0.49, 0.30),
    ]},
    { label: 'character_b', keypoints: [ // top
      kp(0.47, 0.22), kp(0.46, 0.28), kp(0.40, 0.32), kp(0.34, 0.42), kp(0.30, 0.50),
      kp(0.52, 0.32), kp(0.58, 0.42), kp(0.62, 0.50), kp(0.42, 0.52), kp(0.40, 0.68),
      kp(0.38, 0.82), kp(0.50, 0.52), kp(0.52, 0.68), kp(0.54, 0.82),
      kp(0.45, 0.20), kp(0.49, 0.20), kp(0.43, 0.22), kp(0.51, 0.22),
    ]},
  ],
};

const cowgirl: PoseDefinition = {
  id: 'cowgirl',
  name: 'Cowgirl',
  descriptor: 'One person lying on their back, the other sitting upright on top straddling them',
  category: 'explicit',
  characterCount: 2,
  orientation: 'square',
  framing: 'full-body',
  interactionTypes: ['intimate'],
  keywords: ['cowgirl', 'on top', 'riding', 'woman on top', 'straddling', 'sitting on top', 'astride'],
  skeletons: [
    { label: 'character_a', keypoints: [ // bottom
      kp(0.50, 0.45), kp(0.50, 0.50), kp(0.42, 0.54), kp(0.34, 0.52), kp(0.30, 0.46),
      kp(0.58, 0.54), kp(0.66, 0.52), kp(0.70, 0.46), kp(0.44, 0.68), kp(0.40, 0.80),
      kp(0.38, 0.92), kp(0.56, 0.68), kp(0.60, 0.80), kp(0.62, 0.92),
      kp(0.48, 0.43), kp(0.52, 0.43), kp(0.46, 0.45), kp(0.54, 0.45),
    ]},
    { label: 'character_b', keypoints: [ // top, sitting upright
      kp(0.50, 0.15), kp(0.50, 0.22), kp(0.43, 0.26), kp(0.38, 0.34), kp(0.42, 0.42),
      kp(0.57, 0.26), kp(0.62, 0.34), kp(0.58, 0.42), kp(0.44, 0.48), kp(0.34, 0.60),
      kp(0.30, 0.72), kp(0.56, 0.48), kp(0.66, 0.60), kp(0.70, 0.72),
      kp(0.48, 0.13), kp(0.52, 0.13), kp(0.46, 0.14), kp(0.54, 0.14),
    ]},
  ],
};

const fromBehind: PoseDefinition = {
  id: 'from-behind',
  name: 'From Behind',
  descriptor: 'One person on all fours or leaning forward, the other kneeling upright behind them with hands on hips',
  category: 'explicit',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'three-quarter',
  interactionTypes: ['intimate'],
  keywords: ['doggy', 'from behind', 'behind', 'all fours', 'bent over', 'on knees', 'rear', 'back position'],
  skeletons: [
    { label: 'character_a', keypoints: [ // in front, on all fours
      kp(0.25, 0.28), kp(0.28, 0.34), kp(0.24, 0.38), kp(0.20, 0.48), kp(0.18, 0.58),
      kp(0.32, 0.38), kp(0.36, 0.48), kp(0.38, 0.58), kp(0.36, 0.50), kp(0.34, 0.66),
      kp(0.32, 0.80), kp(0.44, 0.50), kp(0.46, 0.66), kp(0.48, 0.80),
      kp(0.23, 0.26), kp(0.27, 0.26), kp(0.21, 0.28), kp(0.29, 0.28),
    ]},
    { label: 'character_b', keypoints: [ // behind, kneeling upright
      kp(0.60, 0.16), kp(0.60, 0.22), kp(0.54, 0.26), kp(0.50, 0.36), kp(0.46, 0.44),
      kp(0.66, 0.26), kp(0.70, 0.36), kp(0.56, 0.44), kp(0.56, 0.46), kp(0.54, 0.64),
      kp(0.52, 0.80), kp(0.64, 0.46), kp(0.66, 0.64), kp(0.68, 0.80),
      kp(0.58, 0.14), kp(0.62, 0.14), kp(0.56, 0.15), kp(0.64, 0.15),
    ]},
  ],
};

const reverseCowgirl: PoseDefinition = {
  id: 'reverse-cowgirl',
  name: 'Reverse Cowgirl',
  descriptor: 'One person lying on their back, the other sitting on top facing away toward their feet',
  category: 'explicit',
  characterCount: 2,
  orientation: 'square',
  framing: 'full-body',
  interactionTypes: ['intimate'],
  keywords: ['reverse cowgirl', 'facing away', 'reverse', 'back turned on top', 'riding facing away'],
  skeletons: [
    { label: 'character_a', keypoints: [ // bottom, lying flat
      kp(0.50, 0.48), kp(0.50, 0.54), kp(0.42, 0.58), kp(0.34, 0.56), kp(0.28, 0.50),
      kp(0.58, 0.58), kp(0.66, 0.56), kp(0.72, 0.50), kp(0.44, 0.70), kp(0.40, 0.82),
      kp(0.38, 0.94), kp(0.56, 0.70), kp(0.60, 0.82), kp(0.62, 0.94),
      kp(0.48, 0.46), kp(0.52, 0.46), kp(0.46, 0.48), kp(0.54, 0.48),
    ]},
    { label: 'character_b', keypoints: [ // top, facing AWAY (toward feet)
      kp(0.50, 0.20), kp(0.50, 0.26), kp(0.56, 0.30), kp(0.60, 0.38), kp(0.58, 0.46),
      kp(0.44, 0.30), kp(0.40, 0.38), kp(0.42, 0.46), kp(0.54, 0.48), kp(0.62, 0.60),
      kp(0.68, 0.72), kp(0.46, 0.48), kp(0.38, 0.60), kp(0.32, 0.72),
      kp(0.52, 0.18), kp(0.48, 0.18), kp(0.54, 0.19), kp(0.46, 0.19),
    ]},
  ],
};

const standingLift: PoseDefinition = {
  id: 'standing-lift',
  name: 'Standing Lift',
  descriptor: 'One person standing and lifting the other, who has legs wrapped around their waist, face to face',
  category: 'explicit',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'full-body',
  interactionTypes: ['intimate'],
  keywords: ['lift', 'lifted', 'legs wrapped', 'carry', 'picked up', 'legs around waist', 'held up', 'standing sex'],
  skeletons: [
    { label: 'character_a', keypoints: [ // standing, supporting
      kp(0.48, 0.10), kp(0.48, 0.16), kp(0.42, 0.20), kp(0.36, 0.28), kp(0.42, 0.36),
      kp(0.54, 0.20), kp(0.60, 0.28), kp(0.58, 0.36), kp(0.44, 0.42), kp(0.42, 0.58),
      kp(0.40, 0.74), kp(0.52, 0.42), kp(0.54, 0.58), kp(0.56, 0.74),
      kp(0.46, 0.08), kp(0.50, 0.08), kp(0.44, 0.09), kp(0.52, 0.09),
    ]},
    { label: 'character_b', keypoints: [ // lifted, legs wrapped
      kp(0.52, 0.08), kp(0.52, 0.14), kp(0.58, 0.18), kp(0.64, 0.24), kp(0.56, 0.20),
      kp(0.46, 0.18), kp(0.40, 0.24), kp(0.44, 0.20), kp(0.56, 0.34), kp(0.64, 0.40),
      kp(0.58, 0.48), kp(0.44, 0.34), kp(0.36, 0.40), kp(0.42, 0.48),
      kp(0.54, 0.06), kp(0.50, 0.06), kp(0.56, 0.07), kp(0.48, 0.07),
    ]},
  ],
};

const bentOverSurface: PoseDefinition = {
  id: 'bent-over-surface',
  name: 'Bent Over Surface',
  descriptor: 'One person bent forward over a table or counter, the other standing behind them',
  category: 'explicit',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'three-quarter',
  interactionTypes: ['intimate'],
  keywords: ['bent over', 'over table', 'over counter', 'leaning over', 'table', 'counter', 'desk', 'bent forward'],
  skeletons: [
    { label: 'character_a', keypoints: [ // bent forward over surface
      kp(0.22, 0.26), kp(0.26, 0.32), kp(0.22, 0.36), kp(0.16, 0.40), kp(0.12, 0.44),
      kp(0.30, 0.36), kp(0.34, 0.40), kp(0.38, 0.44), kp(0.36, 0.48), kp(0.34, 0.64),
      kp(0.32, 0.80), kp(0.44, 0.48), kp(0.46, 0.64), kp(0.48, 0.80),
      kp(0.20, 0.24), kp(0.24, 0.24), kp(0.18, 0.26), kp(0.26, 0.26),
    ]},
    { label: 'character_b', keypoints: [ // standing behind
      kp(0.62, 0.14), kp(0.62, 0.20), kp(0.56, 0.24), kp(0.52, 0.34), kp(0.48, 0.42),
      kp(0.68, 0.24), kp(0.72, 0.34), kp(0.58, 0.42), kp(0.58, 0.44), kp(0.56, 0.62),
      kp(0.54, 0.80), kp(0.66, 0.44), kp(0.68, 0.62), kp(0.70, 0.80),
      kp(0.60, 0.12), kp(0.64, 0.12), kp(0.58, 0.13), kp(0.66, 0.13),
    ]},
  ],
};

const legsOverShoulders: PoseDefinition = {
  id: 'legs-over-shoulders',
  name: 'Legs Over Shoulders',
  descriptor: 'Missionary variant: bottom persons legs raised over the top persons shoulders, deep angle',
  category: 'explicit',
  characterCount: 2,
  orientation: 'square',
  framing: 'full-body',
  interactionTypes: ['intimate'],
  keywords: ['legs over shoulders', 'legs up', 'deep angle', 'legs raised', 'ankles on shoulders', 'folded'],
  skeletons: [
    { label: 'character_a', keypoints: [ // bottom, legs raised
      kp(0.46, 0.38), kp(0.46, 0.44), kp(0.38, 0.48), kp(0.28, 0.46), kp(0.22, 0.40),
      kp(0.54, 0.48), kp(0.62, 0.46), kp(0.68, 0.40), kp(0.40, 0.60), kp(0.34, 0.50),
      kp(0.38, 0.32), kp(0.52, 0.60), kp(0.58, 0.50), kp(0.56, 0.32),
      kp(0.44, 0.36), kp(0.48, 0.36), kp(0.42, 0.38), kp(0.50, 0.38),
    ]},
    { label: 'character_b', keypoints: [ // top, leaning forward
      kp(0.48, 0.22), kp(0.48, 0.28), kp(0.42, 0.32), kp(0.36, 0.40), kp(0.32, 0.48),
      kp(0.54, 0.32), kp(0.60, 0.40), kp(0.64, 0.48), kp(0.44, 0.52), kp(0.42, 0.68),
      kp(0.40, 0.82), kp(0.52, 0.52), kp(0.54, 0.68), kp(0.56, 0.82),
      kp(0.46, 0.20), kp(0.50, 0.20), kp(0.44, 0.22), kp(0.52, 0.22),
    ]},
  ],
};

const seatedChair: PoseDefinition = {
  id: 'seated-chair',
  name: 'Seated in Chair',
  descriptor: 'One person seated in a chair, the other sitting on their lap facing same direction or straddling',
  category: 'explicit',
  characterCount: 2,
  orientation: 'portrait',
  framing: 'three-quarter',
  interactionTypes: ['intimate'],
  keywords: ['chair', 'seated', 'on lap', 'chair sex', 'sitting together', 'throne'],
  skeletons: [
    { label: 'character_a', keypoints: [ // seated in chair
      kp(0.50, 0.16), kp(0.50, 0.22), kp(0.44, 0.26), kp(0.38, 0.34), kp(0.36, 0.42),
      kp(0.56, 0.26), kp(0.62, 0.34), kp(0.64, 0.42), kp(0.46, 0.46), kp(0.42, 0.62),
      kp(0.40, 0.76), kp(0.54, 0.46), kp(0.58, 0.62), kp(0.60, 0.76),
      kp(0.48, 0.14), kp(0.52, 0.14), kp(0.46, 0.15), kp(0.54, 0.15),
    ]},
    { label: 'character_b', keypoints: [ // on lap, facing away
      kp(0.50, 0.10), kp(0.50, 0.16), kp(0.56, 0.20), kp(0.60, 0.28), kp(0.58, 0.36),
      kp(0.44, 0.20), kp(0.40, 0.28), kp(0.42, 0.36), kp(0.54, 0.38), kp(0.60, 0.52),
      kp(0.64, 0.66), kp(0.46, 0.38), kp(0.40, 0.52), kp(0.36, 0.66),
      kp(0.52, 0.08), kp(0.48, 0.08), kp(0.54, 0.09), kp(0.46, 0.09),
    ]},
  ],
};

// ===================================================================
//  CROSSOVER POSES — SFW or NSFW depending on clothing/context
// ===================================================================

const spooning: PoseDefinition = {
  id: 'spooning',
  name: 'Spooning',
  descriptor: 'Both people lying on their sides, one curled behind the other with arm draped over',
  category: 'intimate',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'full-body',
  interactionTypes: ['intimate', 'romantic'],
  keywords: ['spooning', 'spoon', 'lying together', 'curled up', 'cuddling in bed', 'holding in bed', 'big spoon', 'little spoon'],
  skeletons: [
    { label: 'character_a', keypoints: [ // little spoon
      kp(0.22, 0.34), kp(0.26, 0.38), kp(0.30, 0.42), kp(0.28, 0.48), kp(0.24, 0.52),
      kp(0.30, 0.36), kp(0.34, 0.32), kp(0.38, 0.30), kp(0.42, 0.46), kp(0.56, 0.50),
      kp(0.68, 0.48), kp(0.42, 0.40), kp(0.54, 0.38), kp(0.66, 0.36),
      kp(0.20, 0.32), kp(0.22, 0.30), kp(0.18, 0.34), null,
    ]},
    { label: 'character_b', keypoints: [ // big spoon
      kp(0.20, 0.48), kp(0.24, 0.52), kp(0.28, 0.56), kp(0.32, 0.50), kp(0.38, 0.42),
      kp(0.28, 0.50), kp(0.26, 0.46), kp(0.24, 0.42), kp(0.40, 0.60), kp(0.54, 0.64),
      kp(0.66, 0.62), kp(0.40, 0.54), kp(0.52, 0.52), kp(0.64, 0.50),
      kp(0.18, 0.46), kp(0.20, 0.44), kp(0.16, 0.48), null,
    ]},
  ],
};

const lyingOnChest: PoseDefinition = {
  id: 'lying-on-chest',
  name: 'Lying on Chest',
  descriptor: 'One person lying on their back, the other resting head on their chest, post-intimacy calm',
  category: 'intimate',
  characterCount: 2,
  orientation: 'landscape',
  framing: 'medium',
  interactionTypes: ['romantic', 'intimate'],
  keywords: ['lying on chest', 'head on chest', 'resting on', 'post-sex', 'afterglow', 'cuddling after', 'on his chest', 'on her chest'],
  skeletons: [
    { label: 'character_a', keypoints: [ // lying on back
      kp(0.40, 0.34), kp(0.42, 0.40), kp(0.36, 0.44), kp(0.26, 0.42), kp(0.20, 0.38),
      kp(0.48, 0.44), kp(0.56, 0.46), kp(0.62, 0.42), kp(0.38, 0.58), kp(0.34, 0.72),
      kp(0.30, 0.86), kp(0.46, 0.58), kp(0.50, 0.72), kp(0.54, 0.86),
      kp(0.38, 0.32), kp(0.42, 0.32), kp(0.36, 0.34), kp(0.44, 0.34),
    ]},
    { label: 'character_b', keypoints: [ // head on A's chest
      kp(0.48, 0.36), kp(0.52, 0.42), kp(0.56, 0.46), kp(0.62, 0.50), kp(0.66, 0.54),
      kp(0.50, 0.46), kp(0.46, 0.52), kp(0.42, 0.54), kp(0.58, 0.58), kp(0.62, 0.70),
      kp(0.64, 0.84), kp(0.52, 0.58), kp(0.50, 0.70), kp(0.48, 0.84),
      kp(0.46, 0.34), kp(0.50, 0.34), null, kp(0.52, 0.36),
    ]},
  ],
};

// ---------------------------------------------------------------------------
// REGISTER ALL STATIC POSES
// ---------------------------------------------------------------------------

POSE_CATALOG.push(
  // SFW
  standingEmbrace, seatedTogether, backEmbrace, walkingTogether,
  faceToFaceClose, dancingClose, foreheadTouch, handOnFace, leaningOnShoulder,
  // Intimate
  kissingStanding, pinnedAgainstWall, lapStraddling, neckKissing,
  kissingSeated, pushedOntoBed, lyingFaceToFace, undressing,
  // Explicit
  missionary, cowgirl, fromBehind, reverseCowgirl, standingLift,
  bentOverSurface, legsOverShoulders, seatedChair,
  // Crossover
  spooning, lyingOnChest,
);

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

export function getPoseById(id: string): PoseDefinition | undefined {
  return POSE_CATALOG.find((p) => p.id === id);
}

/**
 * Register a dynamically generated pose into the catalog.
 * Skips duplicates by id.
 */
export function registerPose(pose: PoseDefinition): void {
  if (POSE_CATALOG.some((p) => p.id === pose.id)) return;
  POSE_CATALOG.push(pose);
}
