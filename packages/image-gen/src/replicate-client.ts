import Replicate from 'replicate';

const NANO_BANANA_MODEL = 'google/nano-banana-2' as const;

/**
 * Read a Replicate FileOutput (ReadableStream) or legacy URL string into a Buffer.
 * Replicate SDK v1.x returns FileOutput objects from replicate.run() instead of
 * plain URL strings. FileOutput implements ReadableStream, so we consume the stream
 * directly — no intermediate URL download needed.
 */
export async function readReplicateOutput(output: unknown): Promise<Buffer> {
  // Unwrap arrays (e.g., [FileOutput] or [url])
  const value = Array.isArray(output) ? output[0] : output;

  if (!value) {
    throw new Error('Replicate returned empty output');
  }

  // FileOutput is a ReadableStream — read it directly
  if (typeof value === 'object' && typeof (value as any)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of value as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // Legacy: plain URL string — download it
  if (typeof value === 'string' && value.startsWith('http')) {
    const response = await fetch(value);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error(`Unexpected Replicate output format: ${typeof value}`);
}

/**
 * Run Nano Banana 2 on Replicate for character portrait generation.
 * Returns the generated image as a Buffer.
 *
 * @param prompt - Text prompt describing the portrait
 * @param referenceImageUrl - Optional reference image URL (e.g. approved face for body generation)
 * @param seed - Optional seed for reproducible generation
 */
export async function runNanoBanana(
  prompt: string,
  referenceImageUrl?: string,
  seed?: number,
): Promise<Buffer> {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: '1:1',
    output_format: 'png',
    safety_tolerance: 6,
  };

  if (referenceImageUrl) {
    input.image_input = [referenceImageUrl];
  }

  if (seed !== undefined) {
    input.seed = seed;
  }

  const output = await replicate.run(NANO_BANANA_MODEL, { input });
  return readReplicateOutput(output);
}
