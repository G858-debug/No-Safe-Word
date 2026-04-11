// ControlNet pose library for two-character scene conditioning.
//
// Static catalog (27 poses) + dynamic generation via Claude.
//
// Quick usage:
//   import { selectPose, renderPose } from './controlnet';
//   const pose = selectPose(sceneClassification, promptText);
//   if (pose) {
//     const { buffer } = await renderPose(pose);
//     // → feed buffer into ControlNet LoadImage + ControlNetApply nodes
//   }
//
// With dynamic fallback (generates missing poses on demand):
//   import { selectOrGeneratePose, renderPose } from './controlnet';
//   const pose = await selectOrGeneratePose(classification, promptText);

export type {
  PoseKeypoint,
  PoseSkeleton,
  PoseDefinition,
  ContentLevel,
  PoseOrientation,
  PoseFraming,
} from './types';
export { COCO_LIMBS, LIMB_COLORS } from './types';
export { POSE_CATALOG, getPoseById, registerPose } from './pose-catalog';
export { renderPose, renderPoseToFile } from './pose-renderer';
export { selectPose, selectOrGeneratePose, getPosesByCategory } from './pose-selector';
export { generatePose, generateAndRenderPose } from './pose-generator';
export type { GeneratePoseOptions } from './pose-generator';
export { classifyPose } from './pose-classifier';
