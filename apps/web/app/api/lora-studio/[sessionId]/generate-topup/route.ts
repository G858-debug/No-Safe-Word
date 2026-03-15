import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';

const REPLICATE_MODEL = 'lucataco/realvisxl-v2-with-lora';
const VENUS_BODY_LORA_URL = 'https://civitai.com/api/download/models/136081';

const BASE =
  'venusbody, Black woman, dark skin, curvaceous figure, large breasts, wide hips, thick thighs, small waist, hourglass body';
const Q = 'masterpiece, best quality, highly detailed, 8k';
const NEG =
  'skinny, thin, flat chest, small breasts, narrow hips, white skin, pale skin, asian, deformed, bad anatomy, extra limbs, (worst quality:2), (low quality:2)';

const SHOT_TEXT: Record<string, string> = {
  full: 'full body from head to toe',
  three_quarter: 'three-quarter body from head to mid-thigh',
  half: 'half body from head to hip',
};

const POSE_VARIANTS: Record<string, string[]> = {
  standing_neutral: [
    'standing tall in a composed, elegant pose',
    'standing upright with serene confident posture',
    'standing in a relaxed neutral stance',
  ],
  standing_attitude: [
    'standing with one hand planted firmly on hip',
    'hip cocked to the side, hand on waist',
    'both hands on hips, weight shifted to one leg',
  ],
  walking: [
    'caught mid-stride walking forward with confidence',
    'walking with a natural fluid hip sway',
    'stepping forward with purpose and grace',
  ],
  seated: [
    'seated gracefully on a chair with legs crossed',
    'lounging on a couch with one leg stretched out',
    'sitting cross-legged on the floor in a relaxed pose',
  ],
  lying_down: [
    'lying on her back with arms stretched above her head',
    'lying on her side, head propped on one elbow',
    'stretched out on her back, one knee gently raised',
  ],
  bent_arched: [
    'leaning forward with hands resting on knees, back arched',
    'arching her back gracefully, spine curved',
    'bending forward at the waist, reaching toward the floor',
  ],
  over_shoulder: [
    'looking over her left shoulder with a sultry glance',
    'turned slightly away, glancing seductively back at camera',
    'back mostly to camera, head turned to look over right shoulder',
  ],
  crouching: [
    'crouching low with knees apart, hands resting on thighs',
    'squatting with perfect balance, looking at camera',
  ],
};

const CLOTHING_VARIANTS: Record<string, string[]> = {
  fully_clothed: [
    'wearing a form-fitting midi dress',
    'in a tailored blazer and high-waisted trousers',
    'in a fitted bodycon dress',
  ],
  partially_clothed: [
    'in an unbuttoned shirt falling off one shoulder',
    'in a crop top and low-rise jeans',
    'in a sheer blouse over a bralette',
  ],
  lingerie: [
    'in a strappy black lace bralette and matching panties',
    'in a sheer babydoll negligee',
    'in a red satin lingerie set',
  ],
  minimal: [
    'topless, arms positioned artistically',
    'in minimal draping fabric',
    'nude figure, tasteful artistic composition',
  ],
};

const LIGHTING_VARIANTS: Record<string, string[]> = {
  warm_golden: ['bathed in warm golden hour sunlight', 'lit by warm afternoon sunlight through sheer curtains'],
  soft_studio: ['under soft diffused studio lighting', 'in even soft studio light with a white seamless backdrop'],
  dramatic: ['lit by a single dramatic side light', 'in high-contrast chiaroscuro lighting from one window'],
  backlit: ['backlit by a bright window creating a silhouette', 'rim-lit from behind with golden afternoon light'],
  low_warm: ['under low warm candlelight', 'lit by a single warm bedside lamp'],
};

const ANGLE_VARIANTS: Record<string, string[]> = {
  front: ['front-facing, direct eye contact with the camera', 'facing the camera directly'],
  three_quarter: ['at a three-quarter angle to the camera', 'turned at 45 degrees to the camera'],
  side: ['in a side profile view', 'fully side-on to the camera'],
  low_angle: ['from a low camera angle looking up', 'shot from below eye level'],
};

const ALL_POSES = Object.keys(POSE_VARIANTS);
const ALL_CLOTHING = Object.keys(CLOTHING_VARIANTS);
const ALL_LIGHTING = Object.keys(LIGHTING_VARIANTS);
const ALL_ANGLES = Object.keys(ANGLE_VARIANTS);
const ALL_SHOTS = Object.keys(SHOT_TEXT);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildTopupPrompt(
  poseCategory: string,
  clothingState: string,
  lightingCategory: string,
  angleCategory: string,
  shotType: string,
  variant: number,
): { prompt: string; negativePrompt: string } {
  const shot = SHOT_TEXT[shotType] ?? SHOT_TEXT.full;
  const pose = pick(POSE_VARIANTS[poseCategory] ?? POSE_VARIANTS.standing_neutral);
  const clothing = pick(CLOTHING_VARIANTS[clothingState] ?? CLOTHING_VARIANTS.fully_clothed);
  const lighting = pick(LIGHTING_VARIANTS[lightingCategory] ?? LIGHTING_VARIANTS.warm_golden);
  const angle = pick(ANGLE_VARIANTS[angleCategory] ?? ANGLE_VARIANTS.front);

  const prompt =
    `${Q}, ${BASE}, ${shot}, ${pose}, ${clothing}, ${lighting}, ${angle}` +
    `, topup_v${variant}_${Date.now()}`;

  return { prompt, negativePrompt: NEG };
}

// POST /api/lora-studio/[sessionId]/generate-topup
// Body: {
//   count: number,
//   poseCategory?: string,
//   clothingState?: string,
//   lightingCategory?: string,
//   angleCategory?: string,
// }
// Generates N additional training images matching the given category filters.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not set' }, { status: 500 });
  }

  const body = (await request.json()) as {
    count: number;
    poseCategory?: string;
    clothingState?: string;
    lightingCategory?: string;
    angleCategory?: string;
  };

  const count = Math.min(Math.max(Number(body.count) || 1, 1), 50);

  // Verify session
  const { data: session, error: sessionErr } = await (supabase as any)
    .from('nsw_lora_sessions')
    .select('id')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const dispatched: { imageId: string; predictionId: string }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    const poseCategory = body.poseCategory ?? pick(ALL_POSES);
    const clothingState = body.clothingState ?? pick(ALL_CLOTHING);
    const lightingCategory = body.lightingCategory ?? pick(ALL_LIGHTING);
    const angleCategory = body.angleCategory ?? pick(ALL_ANGLES);
    const shotType = pick(ALL_SHOTS);

    const { prompt, negativePrompt } = buildTopupPrompt(
      poseCategory,
      clothingState,
      lightingCategory,
      angleCategory,
      shotType,
      i,
    );

    try {
      const replicateRes = await fetch(
        `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'respond-async',
          },
          body: JSON.stringify({
            input: {
              prompt,
              negative_prompt: negativePrompt,
              lora_weights: VENUS_BODY_LORA_URL,
              lora_scale: 0.90,
              width: 768,
              height: 1152,
              num_inference_steps: 30,
              guidance_scale: 7.5,
              seed: Math.floor(Math.random() * 2_147_483_647),
            },
          }),
        },
      );

      if (!replicateRes.ok) {
        errors.push(`Image ${i + 1}: Replicate error ${replicateRes.status}`);
        continue;
      }

      const prediction = await replicateRes.json();
      const predictionId: string = prediction.id;

      const { data: inserted, error: insertErr } = await (supabase as any)
        .from('nsw_lora_images')
        .insert({
          session_id: sessionId,
          stage: 'anime',
          status: 'generating',
          anime_prompt: prompt,
          replicate_prediction_id: predictionId,
          pose_category: poseCategory,
          lighting_category: lightingCategory,
          clothing_state: clothingState,
          angle_category: angleCategory,
        })
        .select('id')
        .single();

      if (insertErr || !inserted) {
        errors.push(`Image ${i + 1}: DB insert failed: ${insertErr?.message}`);
        continue;
      }

      dispatched.push({ imageId: inserted.id, predictionId });
    } catch (err) {
      errors.push(`Image ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return NextResponse.json({ dispatched, errors, count: dispatched.length });
}
