import type { InteractionType } from '../scene-classifier';

/**
 * Normalized [x, y] coordinate (0-1 range), or null if the keypoint is occluded.
 * (0,0) = top-left, (1,1) = bottom-right of the image.
 */
export type PoseKeypoint = [x: number, y: number] | null;

/**
 * COCO 18-keypoint skeleton for one person.
 * Keypoint order:
 *   0: Nose, 1: Neck, 2: RShoulder, 3: RElbow, 4: RWrist,
 *   5: LShoulder, 6: LElbow, 7: LWrist, 8: RHip, 9: RKnee,
 *   10: RAnkle, 11: LHip, 12: LKnee, 13: LAnkle,
 *   14: REye, 15: LEye, 16: REar, 17: LEar
 */
export interface PoseSkeleton {
  label: string;
  keypoints: PoseKeypoint[];
}

export type ContentLevel = 'sfw' | 'intimate' | 'explicit';
export type PoseOrientation = 'landscape' | 'portrait' | 'square';
export type PoseFraming = 'full-body' | 'three-quarter' | 'medium';

export interface PoseDefinition {
  id: string;
  name: string;
  /** Short phrase for AI classification / prompt matching */
  descriptor: string;
  category: ContentLevel;
  characterCount: 2;
  orientation: PoseOrientation;
  framing: PoseFraming;
  /** Which scene-classifier InteractionTypes map to this pose */
  interactionTypes: InteractionType[];
  /** Prompt keywords that trigger auto-selection */
  keywords: string[];
  skeletons: [PoseSkeleton, PoseSkeleton];
}

/** Standard COCO limb connections: [keypointA, keypointB] */
export const COCO_LIMBS: [number, number][] = [
  [0, 1],   // Nose → Neck
  [1, 2],   // Neck → RShoulder
  [2, 3],   // RShoulder → RElbow
  [3, 4],   // RElbow → RWrist
  [1, 5],   // Neck → LShoulder
  [5, 6],   // LShoulder → LElbow
  [6, 7],   // LElbow → LWrist
  [1, 8],   // Neck → RHip
  [8, 9],   // RHip → RKnee
  [9, 10],  // RKnee → RAnkle
  [1, 11],  // Neck → LHip
  [11, 12], // LHip → LKnee
  [12, 13], // LKnee → LAnkle
  [0, 14],  // Nose → REye
  [14, 16], // REye → REar
  [0, 15],  // Nose → LEye
  [15, 17], // LEye → LEar
];

/** Standard OpenPose limb colors (RGB), one per limb connection */
export const LIMB_COLORS: [number, number, number][] = [
  [255, 0, 0],     // Nose–Neck
  [255, 85, 0],    // Neck–RShoulder
  [255, 170, 0],   // RShoulder–RElbow
  [255, 255, 0],   // RElbow–RWrist
  [170, 255, 0],   // Neck–LShoulder
  [85, 255, 0],    // LShoulder–LElbow
  [0, 255, 0],     // LElbow–LWrist
  [0, 255, 85],    // Neck–RHip
  [0, 255, 170],   // RHip–RKnee
  [0, 255, 255],   // RKnee–RAnkle
  [0, 170, 255],   // Neck–LHip
  [0, 85, 255],    // LHip–LKnee
  [0, 0, 255],     // LKnee–LAnkle
  [255, 0, 170],   // Nose–REye
  [170, 0, 255],   // REye–REar
  [255, 0, 255],   // Nose–LEye
  [85, 0, 255],    // LEye–LEar
];
