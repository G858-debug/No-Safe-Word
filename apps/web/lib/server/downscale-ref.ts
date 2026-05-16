import sharp from "sharp";

// Max pixel dimension for reference images sent to RunPod.
// Two full-res portraits (~6-8 MB each) exceed RunPod's 10 MB payload cap;
// 768px keeps both references well under 2 MB total with no identity loss.
const REF_MAX_PX = 768;

export async function downscaleRefToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch reference image: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const resized = await sharp(buf)
    .resize(REF_MAX_PX, REF_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return resized.toString("base64");
}
