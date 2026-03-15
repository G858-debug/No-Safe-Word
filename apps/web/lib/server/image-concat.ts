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
    sharp(bufA).resize({ height, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer(),
    sharp(bufB).resize({ height, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer(),
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
    .jpeg({ quality: 85 })
    .toBuffer();

  return combined.toString('base64');
}

/**
 * Concatenate two base64 images vertically (top-to-bottom).
 * Used for Kontext single-character workflows — combines face portrait (top)
 * and full-body shot (bottom) into a single reference before sending to ComfyUI.
 *
 * Both images are resized to the same width (768px by default), preserving aspect ratio.
 */
export async function concatImagesVertically(
  base64Top: string,
  base64Bottom: string,
  targetWidth = 768,
): Promise<string> {
  const bufTop = Buffer.from(base64Top, 'base64');
  const bufBottom = Buffer.from(base64Bottom, 'base64');

  // Resize both to the same width, preserving aspect ratio
  const [resizedTop, resizedBottom] = await Promise.all([
    sharp(bufTop).resize({ width: targetWidth, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer(),
    sharp(bufBottom).resize({ width: targetWidth, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer(),
  ]);

  const metaTop = await sharp(resizedTop).metadata();
  const metaBottom = await sharp(resizedBottom).metadata();
  const heightTop = metaTop.height || 512;
  const heightBottom = metaBottom.height || 512;

  const combined = await sharp({
    create: {
      width: targetWidth,
      height: heightTop + heightBottom,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: resizedTop, left: 0, top: 0 },
      { input: resizedBottom, left: 0, top: heightTop },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();

  return combined.toString('base64');
}

/**
 * Compress and resize a base64 image for RunPod payload embedding.
 * Resizes to max dimension on longest side and converts to JPEG.
 * Used for PuLID face references and any other images embedded in the payload.
 */
export async function compressImageForPayload(
  base64: string,
  maxDimension = 1024,
  quality = 85,
): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
  const compressed = await sharp(buf)
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside' })
    .jpeg({ quality })
    .toBuffer();
  return compressed.toString('base64');
}
