/**
 * 200 static anime generation prompts for the LoRA training dataset.
 *
 * Distribution targets:
 *   Shot type:  100 full-body · 70 three-quarter · 30 half-body
 *   Pose:       30 standing_neutral · 30 standing_attitude · 20 walking
 *               30 seated · 30 lying_down · 25 bent_arched
 *               20 over_shoulder · 15 crouching
 *   Clothing:   50 fully_clothed · 50 partially_clothed · 50 lingerie · 50 minimal
 *   Lighting:   50 warm_golden · 50 soft_studio · 50 dramatic · 30 backlit · 20 low_warm
 *   Angle:      70 front · 80 three_quarter · 30 side · 20 low_angle
 */

export type PoseCategory =
  | 'standing_neutral'
  | 'standing_attitude'
  | 'walking'
  | 'seated'
  | 'lying_down'
  | 'bent_arched'
  | 'over_shoulder'
  | 'crouching';

export type LightingCategory = 'warm_golden' | 'soft_studio' | 'dramatic' | 'backlit' | 'low_warm';
export type ClothingState = 'fully_clothed' | 'partially_clothed' | 'lingerie' | 'minimal';
export type AngleCategory = 'front' | 'three_quarter' | 'side' | 'low_angle';
export type ShotType = 'full' | 'three_quarter' | 'half';

export interface AnimePrompt {
  id: number;
  prompt: string;
  negativePrompt: string;
  poseCategory: PoseCategory;
  lightingCategory: LightingCategory;
  clothingState: ClothingState;
  angleCategory: AngleCategory;
  shotType: ShotType;
}

// ─────────────────────────────────────────────────────────────────
// Fixed strings
// ─────────────────────────────────────────────────────────────────

const BASE = 'venusbody, Black woman, dark skin, curvaceous figure, large breasts, wide hips, thick thighs, small waist, hourglass body';
const Q = 'masterpiece, best quality, highly detailed, 8k';
const NEG = 'skinny, thin, flat chest, small breasts, narrow hips, white skin, pale skin, asian, deformed, bad anatomy, extra limbs, (worst quality:2), (low quality:2)';

const SHOTS: Record<ShotType, string> = {
  full: 'full body from head to toe',
  three_quarter: 'three-quarter body from head to mid-thigh',
  half: 'half body from head to hip',
};

// ─────────────────────────────────────────────────────────────────
// Pose text variants (cycled within each group)
// ─────────────────────────────────────────────────────────────────

const POSES: Record<PoseCategory, string[]> = {
  standing_neutral: [
    'standing tall in a composed, elegant pose',
    'standing upright with serene confident posture',
    'standing poised with natural balance',
    'standing quietly with understated confidence',
    'standing in a relaxed neutral stance',
    'standing with perfect posture, chin level',
  ],
  standing_attitude: [
    'standing with one hand planted firmly on hip',
    'hip cocked to the side, hand on waist',
    'standing with arms crossed and chin raised in attitude',
    'both hands on hips, weight shifted to one leg',
    'leaning to one side with fierce attitude',
    'shoulder cocked, defiant stance with hand on hip',
  ],
  walking: [
    'caught mid-stride walking forward with confidence',
    'walking with a natural fluid hip sway',
    'stepping forward with purpose and grace',
    'strolling with easy natural rhythm',
    'walking mid-stride, head half-turned to camera',
  ],
  seated: [
    'seated gracefully on a chair with legs crossed',
    'perched on the edge of a bed, feet flat on floor',
    'sitting on the floor with legs stretched out before her',
    'lounging on a couch with one leg stretched out',
    'seated on a stool, back straight, hands resting on knees',
    'sitting cross-legged on the floor in a relaxed pose',
  ],
  lying_down: [
    'lying on her back with arms stretched above her head',
    'lying on her side, head propped on one elbow',
    'lying on her stomach, chin resting on folded hands',
    'stretched out on her back, one knee gently raised',
    'lying on her side in a languid, curved pose',
    'lying on her back with one arm draped across her body',
  ],
  bent_arched: [
    'leaning forward with hands resting on knees, back arched',
    'arching her back gracefully, spine curved',
    'bending forward at the waist, reaching toward the floor',
    'arching back dramatically with arms extended overhead',
    'leaning forward over a surface, back naturally arched',
  ],
  over_shoulder: [
    'looking over her left shoulder with a sultry glance',
    'turned slightly away, glancing seductively back at camera',
    'back mostly to camera, head turned to look over right shoulder',
    'turned away, head turned back with a soft expression',
  ],
  crouching: [
    'crouching low with knees bent, balanced on her toes',
    'in a low squat, hands resting on knees',
    'crouching close to the ground in a powerful low stance',
    'low crouch with hands on thighs, leaning slightly forward',
  ],
};

// ─────────────────────────────────────────────────────────────────
// Clothing text variants (cycled by global index / 4)
// ─────────────────────────────────────────────────────────────────

const CLOTHING: Record<ClothingState, string[]> = {
  fully_clothed: [
    'wearing a form-fitting bodycon dress',
    'in high-waisted skinny jeans and a tight crop top',
    'in a sleek one-piece bodysuit',
    'in a fitted knee-length pencil dress',
    'wearing tailored high-waisted trousers and a fitted crop top',
    'in a form-fitting ribbed midi dress',
    'wearing a tight miniskirt and a fitted blouse',
    'in a belted wrap dress that hugs her curves',
    'wearing a fitted turtleneck and high-waisted leggings',
    'in a sleeveless bodycon jumpsuit',
  ],
  partially_clothed: [
    'wearing only a fitted crop top, bare from the waist down',
    'in an open button-down shirt with underwear visible',
    'wearing only a short tight miniskirt, bare on top',
    'in a silk robe falling off one shoulder',
    'wearing a bralette and unbuttoned low-rise jeans',
    'half-dressed with a sheet draped loosely over one hip',
    'in an oversized shirt with nothing underneath, mostly bare',
    'top slipped down to expose bare shoulders and upper chest',
    'in only high-waisted briefs, jacket hanging open',
    'wearing a mini skirt only, bare from the waist up',
  ],
  lingerie: [
    'wearing matching black lace bra and panties',
    'in a strappy satin lingerie bodysuit',
    'wearing a structured corset and silk panties',
    'in a sheer lace babydoll negligee',
    'wearing a satin push-up bra and thong',
    'in a black lace bralette and matching thong',
    'wearing a rich red satin lingerie set',
    'in a delicate embroidered bra and high-cut briefs',
    'wearing a bustier corset and garter belt',
    'in a form-fitting lace bodysuit',
  ],
  minimal: [
    'nude, bare skin artfully and tastefully composed',
    'draped only in a thin white sheet, most skin exposed',
    'nude with natural elegant posture',
    'wearing nothing, tastefully nude',
    'barely draped in sheer translucent fabric',
    'nude in a classical artistic pose',
    'unclothed with natural confident posture',
    'skin bare, nude with dignified composition',
    'wearing nothing but delicate body jewelry',
    'nude in natural light, artistically composed',
  ],
};

// ─────────────────────────────────────────────────────────────────
// Lighting text variants
// ─────────────────────────────────────────────────────────────────

const LIGHTING: Record<LightingCategory, string[]> = {
  warm_golden: [
    'bathed in warm golden amber side lighting from a setting sun',
    'lit by rich warm golden hour light streaming from the left',
    'in warm amber sunlight streaming through a window',
    'wrapped in golden sunset glow with warm amber tones',
    'in warm golden back-lit sunlight with amber side fill',
  ],
  soft_studio: [
    'under soft even studio lighting on a clean neutral background',
    'in bright diffused studio light with no harsh shadows',
    'under large soft box studio lighting, clean white background',
    'in soft flattering studio light with even illumination',
    'under professional studio lighting, beautifully and evenly lit',
  ],
  dramatic: [
    'lit by a single powerful side light creating dramatic deep shadows',
    'in stark high-contrast chiaroscuro lighting',
    'under one hard key light casting deep moody shadows',
    'dramatically lit by a single spot from the upper right',
    'in intense high-contrast directional Rembrandt lighting',
  ],
  backlit: [
    'strongly backlit with rim lighting creating a glowing silhouette',
    'backlit against a bright window with golden rim light on her body',
    'silhouetted against bright backlight with a warm rim highlight',
  ],
  low_warm: [
    'in the intimate warm glow of candlelight from below',
    'softly illuminated by the warm amber light of a bedside lamp',
  ],
};

// ─────────────────────────────────────────────────────────────────
// Angle text variants
// ─────────────────────────────────────────────────────────────────

const ANGLES: Record<AngleCategory, string[]> = {
  front: [
    'facing directly forward at the camera, straight frontal view',
    'looking straight at the camera, full front-facing',
    'direct frontal angle, body and face turned toward camera',
  ],
  three_quarter: [
    'at a three-quarter angle to the camera, showing depth and form',
    'turned slightly to the right in a three-quarter view',
    'three-quarter angle from the left, beautifully composed',
    'angled forty-five degrees to the camera, natural and dynamic',
  ],
  side: [
    'in clean side profile, body fully facing sideways',
    'full side profile view, elegant line from head to toe',
    'side view, body turned ninety degrees to camera',
  ],
  low_angle: [
    'photographed from slightly below, empowering low camera angle',
    'from a low eye-level empowering angle, looking slightly up',
  ],
};

// ─────────────────────────────────────────────────────────────────
// Distribution tiles (length 20, repeat × 10 = 200)
//   Lighting: 5 wg + 5 ss + 5 dr + 3 bl + 2 lw = 20
//   Angle:    7 front + 8 tq + 3 side + 2 low = 20
// ─────────────────────────────────────────────────────────────────

const LIGHTING_TILE: LightingCategory[] = [
  'warm_golden', 'soft_studio', 'dramatic', 'backlit',
  'warm_golden', 'soft_studio', 'dramatic', 'backlit',
  'warm_golden', 'soft_studio', 'dramatic', 'low_warm',
  'warm_golden', 'soft_studio', 'dramatic', 'backlit',
  'warm_golden', 'soft_studio', 'dramatic', 'low_warm',
];

const ANGLE_TILE: AngleCategory[] = [
  'front', 'three_quarter', 'front', 'three_quarter', 'side',
  'front', 'three_quarter', 'front', 'three_quarter', 'side',
  'front', 'three_quarter', 'front', 'three_quarter', 'side',
  'front', 'three_quarter', 'low_angle', 'three_quarter', 'low_angle',
];

const CLOTHING_ORDER: ClothingState[] = [
  'fully_clothed', 'partially_clothed', 'lingerie', 'minimal',
];

// ─────────────────────────────────────────────────────────────────
// Shot type interleaver: distributes shots proportionally
// ─────────────────────────────────────────────────────────────────

function makeShots(
  count: number,
  nFull: number,
  nTQ: number,
  nHalf: number,
): ShotType[] {
  const result: ShotType[] = [];
  let fi = 0, tqi = 0, hi = 0;
  for (let i = 0; i < count; i++) {
    const fR = nFull > 0 ? fi / nFull : Infinity;
    const tqR = nTQ > 0 ? tqi / nTQ : Infinity;
    const hR = nHalf > 0 ? hi / nHalf : Infinity;
    if (fR <= tqR && fR <= hR) { result.push('full'); fi++; }
    else if (tqR <= hR) { result.push('three_quarter'); tqi++; }
    else { result.push('half'); hi++; }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Builder — runs once at module load, never at request time
// ─────────────────────────────────────────────────────────────────

function buildPrompts(): AnimePrompt[] {
  const prompts: AnimePrompt[] = [];
  let g = 0; // global index 0–199

  // Per-lighting-category counter for variant cycling
  const lc: Partial<Record<LightingCategory, number>> = {};
  const ac: Partial<Record<AngleCategory, number>> = {};

  const groups: Array<{ pose: PoseCategory; count: number; shots: ShotType[] }> = [
    { pose: 'standing_neutral',  count: 30, shots: makeShots(30, 15, 10, 5) },
    { pose: 'standing_attitude', count: 30, shots: makeShots(30, 15, 10, 5) },
    { pose: 'walking',           count: 20, shots: makeShots(20, 12,  6, 2) },
    { pose: 'seated',            count: 30, shots: makeShots(30,  8, 13, 9) },
    { pose: 'lying_down',        count: 30, shots: makeShots(30, 16, 13, 1) },
    { pose: 'bent_arched',       count: 25, shots: makeShots(25, 13,  8, 4) },
    { pose: 'over_shoulder',     count: 20, shots: makeShots(20, 10,  7, 3) },
    { pose: 'crouching',         count: 15, shots: makeShots(15, 11,  3, 1) },
  ];

  for (const group of groups) {
    const poseVariants = POSES[group.pose];

    for (let i = 0; i < group.count; i++) {
      const shot         = group.shots[i];
      const clothingState = CLOTHING_ORDER[g % 4];
      const lightingCat  = LIGHTING_TILE[g % 20];
      const angleCat     = ANGLE_TILE[g % 20];

      const poseText    = poseVariants[i % poseVariants.length];
      const clothingIdx = Math.floor(g / 4) % CLOTHING[clothingState].length;
      const clothingText = CLOTHING[clothingState][clothingIdx];

      const lcCount = lc[lightingCat] ?? 0;
      const lightingText = LIGHTING[lightingCat][lcCount % LIGHTING[lightingCat].length];
      lc[lightingCat] = lcCount + 1;

      const acCount = ac[angleCat] ?? 0;
      const angleText = ANGLES[angleCat][acCount % ANGLES[angleCat].length];
      ac[angleCat] = acCount + 1;

      const prompt = `${BASE}, ${SHOTS[shot]}, ${poseText}, ${clothingText}, ${lightingText}, ${angleText}, ${Q}`;

      prompts.push({
        id: g + 1,
        prompt,
        negativePrompt: NEG,
        poseCategory: group.pose,
        lightingCategory: lightingCat,
        clothingState,
        angleCategory: angleCat,
        shotType: shot,
      });

      g++;
    }
  }

  return prompts;
}

export const ANIME_PROMPTS: AnimePrompt[] = buildPrompts();
