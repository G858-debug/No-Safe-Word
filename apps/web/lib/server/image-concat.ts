import sharp from 'sharp';

/**
 * Concatenate two base64 images side by side (horizontally).
 * Used for Kontext dual-character workflows — combines primary and secondary
 * reference portraits into a single reference before sending to ComfyUI.
 *
 * This lives in the web app (not image-gen) because sharp is a native Node.js
 * module that breaks webpack client builds when imported from a shared package.
 */
export async function concatImagesHorizontally(base64A: string, base64B: string): Promise<string> {
  const bufA = Buffer.from(base64A, 'base64');
  const bufB = Buffer.from(base64B, 'base64');

  const [metaA, metaB] = await Promise.all([
    sharp(bufA).metadata(),
    sharp(bufB).metadata(),
  ]);

  const height = Math.max(metaA.height || 512, metaB.height || 512);

  // Resize both to the same height, preserving aspect ratio
  const [resizedA, resizedB] = await Promise.all([
    sharp(bufA).resize({ height, fit: 'inside' }).png().toBuffer(),
    sharp(bufB).resize({ height, fit: 'inside' }).png().toBuffer(),
  ]);

  const metaRA = await sharp(resizedA).metadata();
  const metaRB = await sharp(resizedB).metadata();
  const widthA = metaRA.width || 512;
  const widthB = metaRB.width || 512;

  const combined = await sharp({
    create: {
      width: widthA + widthB,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: resizedA, left: 0, top: 0 },
      { input: resizedB, left: widthA, top: 0 },
    ])
    .png()
    .toBuffer();

  return combined.toString('base64');
}
