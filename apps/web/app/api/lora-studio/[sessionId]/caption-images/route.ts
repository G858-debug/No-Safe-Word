import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@no-safe-word/story-engine';

const CONVERTED_BUCKET = 'lora-converted-images';
const ANIME_BUCKET = 'lora-anime-images';

const CAPTION_SYSTEM_PROMPT =
  "You are generating training captions for a Flux LoRA that will learn curvy body proportions. Look at this image of a Black woman and write a short, descriptive caption focused on body attributes and pose. Always include these tokens: 'woman, dark skin, large breasts, wide hips, thick thighs, small waist, curvy figure, hourglass body'. Then describe the specific pose, clothing state, and framing visible in the image. Keep the caption under 100 words. Do not mention image quality, style, or aesthetics — only describe what is physically depicted.";

// POST /api/lora-studio/[sessionId]/caption-images
// Runs Claude Vision captioning on all approved images without captions.
// Checks converted images first; falls back to anime images if conversion was skipped.
// Returns: { results: { id, caption }[], captioned: number, skipped: number }
export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  // Try converted images first (Flux conversion pipeline)
  const { data: convertedImages } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, converted_image_url, caption')
    .eq('session_id', sessionId)
    .eq('stage', 'converted')
    .eq('human_approved', true)
    .not('converted_image_url', 'is', null)
    .order('created_at', { ascending: true });

  // Fall back to approved anime images if no converted images exist
  const useAnime = !convertedImages || convertedImages.length === 0;
  let bucket: string;
  let imageList: { id: string; image_url: string; caption: string | null }[];

  if (useAnime) {
    const { data: animeImages, error: fetchErr } = await (supabase as any)
      .from('nsw_lora_images')
      .select('id, anime_image_url, caption')
      .eq('session_id', sessionId)
      .eq('stage', 'anime')
      .eq('status', 'approved')
      .not('anime_image_url', 'is', null)
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

  const toCaption = imageList.filter((img) => !img.caption);

  if (toCaption.length === 0) {
    return NextResponse.json({ results: [], captioned: 0, skipped: imageList.length });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results: { id: string; caption: string }[] = [];

  // Generate signed URLs for all images that need captioning
  const signedUrls = await Promise.all(
    toCaption.map(async (img) => {
      const { data } = await (supabase as any).storage
        .from(bucket)
        .createSignedUrl(img.image_url, 600);
      return { id: img.id, signedUrl: data?.signedUrl ?? null };
    }),
  );

  // Caption each image sequentially (Claude has rate limits)
  for (const { id, signedUrl } of signedUrls) {
    if (!signedUrl) {
      continue;
    }

    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: CAPTION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: signedUrl } },
              { type: 'text', text: 'Write a training caption for this image.' },
            ],
          },
        ],
      });

      const caption =
        message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';

      // Skip refusals — Claude occasionally refuses to describe non-photorealistic images.
      // Storing a refusal as a training caption would corrupt the dataset.
      const isRefusal = caption.toLowerCase().startsWith("i'm not able") ||
        caption.toLowerCase().startsWith("i cannot") ||
        caption.toLowerCase().startsWith("i'm unable") ||
        caption.toLowerCase().startsWith("i am unable");

      if (caption && !isRefusal) {
        await (supabase as any)
          .from('nsw_lora_images')
          .update({ caption })
          .eq('id', id);

        results.push({ id, caption });
      } else if (isRefusal) {
        console.warn('[caption-images] Claude refused to caption image', id, '— skipping');
      }
    } catch (err) {
      console.error('[caption-images] Failed for image', id, err);
    }
  }

  return NextResponse.json({
    results,
    captioned: results.length,
    skipped: imageList.length - toCaption.length,
  });
}

// GET /api/lora-studio/[sessionId]/caption-images
// Returns all approved images with their current caption state.
// Checks converted images first; falls back to anime images if conversion was skipped.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  // Try converted images first
  const { data: convertedImages } = await (supabase as any)
    .from('nsw_lora_images')
    .select('id, converted_image_url, caption, pose_category, clothing_state, angle_category')
    .eq('session_id', sessionId)
    .eq('stage', 'converted')
    .eq('human_approved', true)
    .not('converted_image_url', 'is', null)
    .order('created_at', { ascending: true });

  const useAnime = !convertedImages || convertedImages.length === 0;

  let imageList: Record<string, any>[];
  let bucket: string;

  if (useAnime) {
    const { data: animeImages, error } = await (supabase as any)
      .from('nsw_lora_images')
      .select('id, anime_image_url, caption, pose_category, clothing_state, angle_category')
      .eq('session_id', sessionId)
      .eq('stage', 'anime')
      .eq('status', 'approved')
      .not('anime_image_url', 'is', null)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    bucket = ANIME_BUCKET;
    imageList = ((animeImages ?? []) as any[]).map((img) => ({
      ...img,
      converted_image_url: img.anime_image_url,
    }));
  } else {
    bucket = CONVERTED_BUCKET;
    imageList = (convertedImages ?? []) as Record<string, any>[];
  }

  // Generate signed URLs for thumbnails
  const signedUrls: Record<string, string> = {};
  await Promise.allSettled(
    imageList.map(async (img) => {
      const url = img.converted_image_url || img.anime_image_url;
      if (!url) return;
      const { data } = await (supabase as any).storage
        .from(bucket)
        .createSignedUrl(url, 3600);
      if (data?.signedUrl) signedUrls[img.id] = data.signedUrl;
    }),
  );

  return NextResponse.json({ images: imageList, signedUrls });
}

// PATCH /api/lora-studio/[sessionId]/caption-images
// Body: { imageId: string, caption: string }
// Update a single caption (user edit).
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;
  const { imageId, caption } = (await request.json()) as { imageId: string; caption: string };

  if (!imageId || typeof caption !== 'string') {
    return NextResponse.json({ error: 'imageId and caption are required' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('nsw_lora_images')
    .update({ caption: caption.trim() })
    .eq('id', imageId)
    .eq('session_id', sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
