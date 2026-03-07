import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import archiver from 'archiver';
import { PassThrough } from 'stream';

const CONVERTED_BUCKET = 'lora-converted-images';
const ANIME_BUCKET = 'lora-anime-images';
const DATASET_BUCKET = 'lora-training-datasets';

// POST /api/lora-studio/[sessionId]/package-dataset
// Downloads all approved+captioned images, creates a ZIP in Kohya format
// (image.jpg + image.txt for each), and uploads to lora-training-datasets/[sessionId].zip.
// Checks converted images first; falls back to anime images if conversion was skipped.
// Returns: { zipUrl, imageCount, sizeBytes }
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  // Try converted images first
  const { data: convertedImages } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, converted_image_url, caption')
    .eq('session_id', sessionId)
    .eq('stage', 'converted')
    .eq('human_approved', true)
    .not('converted_image_url', 'is', null)
    .not('caption', 'is', null)
    .order('created_at', { ascending: true });

  const useAnime = !convertedImages || convertedImages.length === 0;
  let bucket: string;
  let imageList: { id: string; image_url: string; caption: string }[];

  if (useAnime) {
    const { data: animeImages, error: fetchErr } = await (supabase as any)
      .from('nsw_lora_images')
      .select('id, anime_image_url, caption')
      .eq('session_id', sessionId)
      .eq('stage', 'anime')
      .eq('status', 'approved')
      .not('anime_image_url', 'is', null)
      .not('caption', 'is', null)
      .order('created_at', { ascending: true });

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    bucket = ANIME_BUCKET;
    imageList = ((animeImages ?? []) as any[]).map((img) => ({
      id: img.id,
      image_url: img.anime_image_url,
      caption: img.caption,
    }));
  } else {
    bucket = CONVERTED_BUCKET;
    imageList = ((convertedImages ?? []) as any[]).map((img) => ({
      id: img.id,
      image_url: img.converted_image_url,
      caption: img.caption,
    }));
  }

  if (imageList.length === 0) {
    return NextResponse.json(
      { error: 'No captioned images found. Run captioning first.' },
      { status: 400 },
    );
  }

  // Generate signed URLs for downloading
  const signedEntries = await Promise.all(
    imageList.map(async (img, idx) => {
      const { data } = await (supabase as any).storage
        .from(bucket)
        .createSignedUrl(img.image_url, 600);
      return {
        idx,
        id: img.id,
        caption: img.caption,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );

  const validEntries = signedEntries.filter((e) => e.signedUrl !== null);

  // Download all images in parallel
  type DownloadedEntry = (typeof validEntries)[number] & { buffer: Buffer };
  const downloadedEntries = await Promise.allSettled(
    validEntries.map(async (entry): Promise<DownloadedEntry> => {
      const response = await fetch(entry.signedUrl!);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return { ...entry, buffer };
    }),
  );

  const readyEntries = downloadedEntries
    .filter((r): r is PromiseFulfilledResult<DownloadedEntry> => r.status === 'fulfilled')
    .map((r) => r.value);

  if (readyEntries.length === 0) {
    return NextResponse.json({ error: 'Failed to download any images' }, { status: 500 });
  }

  // Build ZIP in memory
  const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const entry of readyEntries) {
      const name = String(entry.idx).padStart(4, '0');
      archive.append(entry.buffer, { name: `${name}.jpg` });
      archive.append(entry.caption, { name: `${name}.txt` });
    }

    archive.finalize();
  });

  // Upload ZIP to Supabase Storage (public bucket — Replicate needs to download it)
  const zipPath = `${sessionId}.zip`;
  const { error: uploadErr } = await (supabase as any).storage
    .from(DATASET_BUCKET)
    .upload(zipPath, zipBuffer, {
      contentType: 'application/zip',
      upsert: true,
    });

  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: urlData } = (supabase as any).storage
    .from(DATASET_BUCKET)
    .getPublicUrl(zipPath);

  const zipUrl: string = urlData.publicUrl;

  // Save the dataset URL to the session
  await (supabase as any)
    .from('nsw_lora_sessions')
    .update({ dataset_zip_url: zipUrl })
    .eq('id', sessionId);

  return NextResponse.json({
    zipUrl,
    imageCount: readyEntries.length,
    sizeBytes: zipBuffer.length,
  });
}

// GET /api/lora-studio/[sessionId]/package-dataset
// Returns whether the dataset has been packaged (dataset_zip_url is set).
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const { data: session, error } = await (supabase as any)
    .from('nsw_lora_sessions')
    .select('dataset_zip_url')
    .eq('id', sessionId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ zipUrl: session?.dataset_zip_url ?? null });
}
