/**
 * Debug Mode Additions for Multi-Pass Workflow Builder
 *
 * This file contains the modifications needed for workflow-builder.ts
 * to add intermediate SaveImage nodes when debug mode is enabled.
 *
 * When debugMode is true, each pass saves its intermediate output image
 * with a unique filename prefix, allowing the debug page to display
 * the image progression through all 7 passes.
 *
 * Location: packages/image-gen/src/debug-workflow.ts
 */

/**
 * Debug metadata attached to each intermediate save point.
 * Returned alongside RunPod results for the debug page to display.
 */
export interface DebugPassInfo {
  pass: number;
  name: string;
  description: string;
  /** The prompt text used in this pass */
  prompt: string;
  /** LoRAs active during this pass */
  loras: string[];
  /** Key parameters for this pass's KSampler */
  params: {
    seed: number;
    steps: number;
    cfg: number;
    denoise: number;
    width?: number;
    height?: number;
  };
  /** The SaveImage filename prefix for this pass */
  filenamePrefix: string;
}

/**
 * Generates the debug pass metadata for a multi-pass workflow.
 * This is called alongside the workflow build to produce the metadata
 * that the debug page will display.
 */
export function buildDebugPassInfo(config: {
  scenePrompt: string;
  primaryIdentityPrompt: string;
  secondaryIdentityPrompt?: string;
  fullPrompt: string;
  primaryFacePrompt: string;
  secondaryFacePrompt?: string;
  seed: number;
  width: number;
  height: number;
  filenamePrefix: string;
  loras?: Array<{ filename: string }>;
  characterLoras?: Array<{ filename: string }>;
  primaryGenderLoras?: Array<{ filename: string }>;
  secondaryGenderLoras?: Array<{ filename: string }>;
  hasDualCharacter: boolean;
}): DebugPassInfo[] {
  const passes: DebugPassInfo[] = [];
  const prefix = config.filenamePrefix || "debug";
  const compWidth = Math.round(config.width / 1.6);
  const compHeight = Math.round(config.height / 1.6);

  // Pass 1 — Composition
  passes.push({
    pass: 1,
    name: "Composition",
    description:
      "Scene layout at reduced resolution. Only detail-tweaker LoRA. No character identity — just spatial layout, poses, and setting.",
    prompt: config.scenePrompt,
    loras: ["detail-tweaker-xl.safetensors"],
    params: {
      seed: config.seed,
      steps: 20,
      cfg: 11,
      denoise: 1.0,
      width: compWidth,
      height: compHeight,
    },
    filenamePrefix: `${prefix}_pass1_composition`,
  });

  // Pass 2 — Character Identity
  passes.push({
    pass: 2,
    name: "Character Identity",
    description:
      "Upscale to target resolution + primary character LoRA applied. Injects character appearance into the composition. Secondary character described generically.",
    prompt: `${config.primaryIdentityPrompt}, ${config.scenePrompt}`,
    loras: config.characterLoras?.map((l) => l.filename) || [],
    params: {
      seed: config.seed + 1,
      steps: 25,
      cfg: 7.5,
      denoise: 0.55,
      width: config.width,
      height: config.height,
    },
    filenamePrefix: `${prefix}_pass2_identity`,
  });

  // Pass 3 — Quality Refinement
  passes.push({
    pass: 3,
    name: "Quality Refinement",
    description:
      "Full prompt with all details. Gender-neutral quality LoRAs only (detail-tweaker, melanin-enhancer, etc.). No character LoRAs to avoid cross-contamination.",
    prompt: config.fullPrompt,
    loras: config.loras?.map((l) => l.filename) || [],
    params: {
      seed: config.seed + 2,
      steps: 20,
      cfg: 7.0,
      denoise: 0.35,
    },
    filenamePrefix: `${prefix}_pass3_quality`,
  });

  // Pass 4a — Primary Person Inpaint
  passes.push({
    pass: 4,
    name: "Primary Person Inpaint",
    description:
      "Person detection → inpaint with primary character LoRA + gender-specific LoRAs. Refines the primary character's body without affecting the rest of the image.",
    prompt: `${config.primaryIdentityPrompt}, ${config.scenePrompt}`,
    loras: [
      ...(config.characterLoras?.slice(0, 1).map((l) => l.filename) || []),
      ...(config.primaryGenderLoras?.map((l) => l.filename) || []),
    ],
    params: {
      seed: config.seed + 3,
      steps: 25,
      cfg: 7.5,
      denoise: 0.3,
    },
    filenamePrefix: `${prefix}_pass4a_primary_person`,
  });

  // Pass 4b — Secondary Person Inpaint (dual-character only)
  if (config.hasDualCharacter && config.secondaryIdentityPrompt) {
    passes.push({
      pass: 4.5,
      name: "Secondary Person Inpaint",
      description:
        "Same as Pass 4a but for the secondary character. Uses secondary character LoRA + secondary gender LoRAs.",
      prompt: `${config.secondaryIdentityPrompt}, ${config.scenePrompt}`,
      loras: [
        ...(config.characterLoras?.slice(1, 2).map((l) => l.filename) || []),
        ...(config.secondaryGenderLoras?.map((l) => l.filename) || []),
      ],
      params: {
        seed: config.seed + 100,
        steps: 25,
        cfg: 7.5,
        denoise: 0.3,
      },
      filenamePrefix: `${prefix}_pass4b_secondary_person`,
    });
  }

  // Pass 5a — Primary Face (FaceDetailer)
  passes.push({
    pass: 5,
    name: "Primary Face Refinement",
    description:
      "FaceDetailer with face detection (YOLO + SAM). Inpaints the primary character's face using their character LoRA for identity consistency.",
    prompt: config.primaryFacePrompt,
    loras: config.characterLoras?.slice(0, 1).map((l) => l.filename) || [],
    params: {
      seed: config.seed + 4,
      steps: 25,
      cfg: 8.5,
      denoise: 0.3,
    },
    filenamePrefix: `${prefix}_pass5a_primary_face`,
  });

  // Pass 5b — Secondary Face (dual-character only)
  if (config.hasDualCharacter && config.secondaryFacePrompt) {
    passes.push({
      pass: 5.5,
      name: "Secondary Face Refinement",
      description:
        "FaceDetailer for the secondary character's face. Uses their character LoRA for identity consistency.",
      prompt: config.secondaryFacePrompt,
      loras: config.characterLoras?.slice(1, 2).map((l) => l.filename) || [],
      params: {
        seed: config.seed + 100,
        steps: 25,
        cfg: 8.5,
        denoise: 0.3,
      },
      filenamePrefix: `${prefix}_pass5b_secondary_face`,
    });
  }

  // Pass 7 — Cleanup/Denoise
  passes.push({
    pass: 7,
    name: "Cleanup / Denoise",
    description:
      "Ultra-low denoise pass with base checkpoint only (zero LoRAs). Smooths grain and noise from earlier passes without altering composition or identity.",
    prompt: "photorealistic, sharp focus, clean skin, professional photography, 8k uhd",
    loras: [],
    params: {
      seed: config.seed + 10,
      steps: 15,
      cfg: 5.0,
      denoise: 0.06,
    },
    filenamePrefix: `${prefix}_pass7_cleanup`,
  });

  return passes;
}

/**
 * Inject intermediate SaveImage nodes into a multi-pass workflow.
 *
 * Call this AFTER buildMultiPassWorkflow() to add debug save points.
 * Each intermediate node does VAEDecode → SaveImage, tapping the latent
 * output of each pass.
 *
 * Node ID scheme for debug nodes: 800+ range to avoid conflicts.
 *
 * @param workflow - The existing workflow graph to mutate
 * @param prefix - Filename prefix for debug images
 * @param hasDualCharacter - Whether this is a dual-character scene
 */
export function injectDebugSaveNodes(
  workflow: Record<string, any>,
  prefix: string,
  hasDualCharacter: boolean,
): void {
  const CKPT_NODE = "100";

  // Helper: add VAEDecode → SaveImage for a given latent/image source
  const addDebugSave = (
    baseNodeId: number,
    sourceNode: string,
    sourceIsLatent: boolean,
    passName: string,
  ) => {
    if (sourceIsLatent) {
      // Need VAEDecode first
      workflow[String(baseNodeId)] = {
        class_type: "VAEDecode",
        inputs: { samples: [sourceNode, 0], vae: [CKPT_NODE, 2] },
      };
      workflow[String(baseNodeId + 1)] = {
        class_type: "SaveImage",
        inputs: {
          images: [String(baseNodeId), 0],
          filename_prefix: `${prefix}_${passName}`,
        },
      };
    } else {
      // Source is already an image (e.g. FaceDetailer output)
      workflow[String(baseNodeId)] = {
        class_type: "SaveImage",
        inputs: {
          images: [sourceNode, 0],
          filename_prefix: `${prefix}_${passName}`,
        },
      };
    }
  };

  // Pass 1 output: node 113 is KSampler (latent)
  addDebugSave(800, "113", true, "pass1_composition");

  // Pass 2 output: node 213 is KSampler (latent)
  addDebugSave(802, "213", true, "pass2_identity");

  // Pass 3 output: node 313 is KSampler (latent)
  addDebugSave(804, "313", true, "pass3_quality");

  // Pass 4a output: node 412 is FaceDetailer (image — person detection + inpaint)
  addDebugSave(806, "412", false, "pass4a_primary_person");

  // Pass 4b output (dual-character): node 432 is FaceDetailer
  if (hasDualCharacter) {
    addDebugSave(808, "432", false, "pass4b_secondary_person");
  }

  // Pass 5a output: node 511 is FaceDetailer (face)
  addDebugSave(810, "511", false, "pass5a_primary_face");

  // Pass 5b output (dual-character): node 521 is FaceDetailer
  if (hasDualCharacter) {
    addDebugSave(812, "521", false, "pass5b_secondary_face");
  }

  // Pass 7 (final cleanup) output: node 705 is VAEDecode — already decoded
  // The main SaveImage (node 600) already saves this, but we add a debug-prefixed copy
  addDebugSave(814, "705", false, "pass7_cleanup_final");
}
