import Replicate from "replicate";

/**
 * Singleton Replicate client.
 *
 * Uses REPLICATE_API_TOKEN from the environment. The SDK handles auth,
 * prediction polling, and file output resolution.
 *
 * NOTE: HunyuanImage 3.0 generation moved to Siray.ai (see siray-client.ts).
 * This client is now only consumed by `flux2-pro-generator.ts` for the
 * Flux 2 Pro cover fallback (`cover-variant-handler.ts`). Do not add new
 * Replicate-backed providers here without revisiting that decision —
 * prefer Siray for HunyuanImage and RunPod for Flux 2 Dev.
 */
let _replicate: Replicate | null = null;

export function getReplicateClient(): Replicate {
  if (_replicate) return _replicate;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN is not set — required for HunyuanImage 3.0 generation"
    );
  }

  _replicate = new Replicate({ auth: token });
  return _replicate;
}
