import { buildFlux2Workflow, type Flux2ReferenceImage } from "./flux2-workflow-builder";
import { submitRunPodJob } from "./runpod";
import { VISUAL_SIGNATURE } from "./hunyuan-generator";

export interface Flux2GenerateOptions {
  /** Scene/action description — will be suffixed with the visual signature. */
  scenePrompt: string;
  /** Optional pre-formatted visual signature to append (defaults to the shared VISUAL_SIGNATURE). */
  visualSignature?: string;
  /** Reference images for character consistency. Each is a {name, base64} pair. */
  references?: Array<{ name: string; base64: string; strength?: number }>;
  /** Optional pose/depth control image, with base64 payload. */
  controlImage?: {
    name: string;
    base64: string;
    strength?: number;
    preprocessor?: "openpose";
    controlNetModel?: string;
  };
  /** Output dimensions. Defaults: 768×1024 (portrait). Use 1024×768 for two-character. */
  width?: number;
  height?: number;
  /** Random seed (-1 → RunPod picks). */
  seed?: number;
  /** Sampler / schedule overrides. */
  steps?: number;
  cfg?: number;
  /** Endpoint override — defaults to RUNPOD_FLUX2_ENDPOINT_ID from env. */
  endpointId?: string;
  /** Filename prefix for the SaveImage node. */
  filenamePrefix?: string;
}

export interface Flux2GenerateResult {
  /** RunPod job ID — caller polls via waitForRunPodResult / getRunPodJobStatus. */
  jobId: string;
  /** Full prompt sent to the workflow (scene + visual signature). */
  prompt: string;
  /** Seed used (caller-supplied or random). */
  seed: number;
  model: "flux2_dev";
  /** The ComfyUI workflow JSON that was submitted (useful for debugging). */
  workflow: Record<string, any>;
}

const DEFAULT_WIDTH = 768;
const DEFAULT_HEIGHT = 1024;

/**
 * Assemble the full Flux 2 Dev prompt (scene + visual signature).
 *
 * Character identity lives in the reference image, not the prompt text,
 * so there's no character block to inject — just the scene + the signature.
 */
export function assembleFlux2Prompt(
  scenePrompt: string,
  visualSignature: string = VISUAL_SIGNATURE
): string {
  const parts: string[] = [];
  if (scenePrompt?.trim()) parts.push(scenePrompt.trim());
  if (visualSignature?.trim()) parts.push(visualSignature.trim());
  return parts.join(" ");
}

/**
 * Submit a Flux 2 Dev generation to RunPod (async).
 *
 * Returns a jobId; the caller is responsible for polling the RunPod
 * endpoint via the existing waitForRunPodResult / getRunPodJobStatus
 * helpers. Uses a SEPARATE endpoint ID (RUNPOD_FLUX2_ENDPOINT_ID) from
 * the legacy Juggernaut endpoint — both can coexist on the same RunPod
 * account.
 */
export async function generateFlux2Image(
  options: Flux2GenerateOptions
): Promise<Flux2GenerateResult> {
  const endpointId =
    options.endpointId ??
    process.env.RUNPOD_FLUX2_ENDPOINT_ID ??
    process.env.RUNPOD_ENDPOINT_ID;
  if (!endpointId) {
    throw new Error(
      "RUNPOD_FLUX2_ENDPOINT_ID (or RUNPOD_ENDPOINT_ID) is not set — required for Flux 2 Dev generation"
    );
  }

  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const prompt = assembleFlux2Prompt(
    options.scenePrompt,
    options.visualSignature
  );

  const refNames: Flux2ReferenceImage[] =
    options.references?.map((r) => ({ name: r.name, strength: r.strength })) ??
    [];

  const workflow = buildFlux2Workflow({
    prompt,
    width,
    height,
    seed,
    references: refNames,
    controlNet: options.controlImage
      ? {
          controlImageName: options.controlImage.name,
          strength: options.controlImage.strength,
          preprocessor: options.controlImage.preprocessor,
          controlNetModel: options.controlImage.controlNetModel,
        }
      : undefined,
    steps: options.steps,
    cfg: options.cfg,
    filenamePrefix: options.filenamePrefix ?? "flux2_scene",
  });

  const images = [
    ...(options.references ?? []).map((r) => ({ name: r.name, image: r.base64 })),
    ...(options.controlImage
      ? [{ name: options.controlImage.name, image: options.controlImage.base64 }]
      : []),
  ];

  const { jobId } = await submitRunPodJob(
    workflow,
    images.length > 0 ? images : undefined,
    undefined,
    endpointId
  );

  return {
    jobId: `runpod-${jobId}`,
    prompt,
    seed,
    model: "flux2_dev",
    workflow,
  };
}
