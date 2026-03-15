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
export type AngleCategory = 'front' | 'three_quarter' | 'side' | 'low_angle' | 'back';
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

const BASE = 'extremely voluptuous figure, very large natural breasts, very wide hips, very large round ass, narrow defined waist, full thighs, photo of a Black woman, dark skin, (curvaceous figure:1.5), (large breasts:1.5), wide hips, (thick thighs:1.5), small waist, (hourglass body:1.5), (huge butt:1.5), faceless, no face visible, head cropped out of frame';
const Q = 'photorealistic, professional photograph, high resolution, sharp focus, detailed skin texture, natural skin pores';
const NEG = 'face, head, eyes, nose, mouth, portrait, skinny, thin, flat chest, small breasts, narrow hips, white skin, pale skin, asian, deformed, bad anatomy, extra limbs, worst quality, low quality, cartoon, anime, illustration, drawing, painting, 3d render, cgi';

const SHOTS: Record<ShotType, string> = {
  full: 'full body from neck down to toe, head not visible',
  three_quarter: 'body from shoulders down to mid-thigh, head cropped out',
  half: 'body from shoulders down to hip, head not in frame',
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
    'standing with perfect posture, shoulders back',
  ],
  standing_attitude: [
    'standing with one hand planted firmly on hip',
    'hip cocked to the side, hand on waist',
    'standing with arms crossed, weight shifted to one leg',
    'both hands on hips, weight shifted to one leg',
    'leaning to one side with fierce attitude',
    'shoulder cocked, defiant stance with hand on hip',
  ],
  walking: [
    'caught mid-stride walking forward with confidence',
    'walking with a natural fluid hip sway',
    'stepping forward with purpose and grace',
    'strolling with easy natural rhythm',
    'walking mid-stride with confident body movement',
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
    'lying on her back with arms stretched above',
    'lying on her side, body propped on one elbow',
    'lying on her stomach with hands folded beneath her',
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
    'body turned away from camera, back visible',
    'turned slightly away, showing back and shoulders',
    'back mostly to camera, body angled away',
    'turned away with body twisted to show curves from behind',
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
    'body facing directly forward at the camera, straight frontal view',
    'body squared to the camera, full front-facing',
    'direct frontal angle, body turned toward camera',
  ],
  three_quarter: [
    'body at a three-quarter angle to the camera, showing depth and form',
    'body turned slightly to the right in a three-quarter view',
    'three-quarter angle from the left, beautifully composed',
    'body angled forty-five degrees to the camera, natural and dynamic',
  ],
  side: [
    'in clean side profile, body fully facing sideways',
    'full side profile view, elegant body line',
    'side view, body turned ninety degrees to camera',
  ],
  low_angle: [
    'photographed from slightly below, empowering low camera angle',
    'from a low angle, camera tilted upward at the body',
  ],
  back: [
    'back facing the camera, rear view, back of body facing the camera',
    'back turned to camera, full rear view showing back and behind',
    'rear-facing view, body turned completely away from camera',
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

// ─────────────────────────────────────────────────────────────────
// Targeted batch: 40 additional prompts for back views, side views,
// and fill shots to improve LoRA training coverage.
// ─────────────────────────────────────────────────────────────────
const TARGETED_PROMPTS: AnimePrompt[] = [
  // --- 20 BACK-FACING VIEWS (201-220) ---
  { id: 201, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing straight with relaxed arms at sides, wearing lace lingerie set, in soft diffused studio light with no harsh shadows, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'soft_studio', clothingState: 'lingerie', angleCategory: 'back', shotType: 'full' },
  { id: 202, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with one hand on hip and weight shifted to one leg, wearing tiny bikini bottoms, in warm golden hour light streaming from the left, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'warm_golden', clothingState: 'minimal', angleCategory: 'back', shotType: 'full' },
  { id: 203, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing upright with arms relaxed, wearing a tight bodycon dress that hugs every curve, in dramatic single-source side lighting casting deep shadows, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'dramatic', clothingState: 'fully_clothed', angleCategory: 'back', shotType: 'full' },
  { id: 204, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, walking away from camera mid-stride, wearing an open silk robe with nothing underneath, backlit by warm light creating a rim glow around the silhouette, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'backlit', clothingState: 'partially_clothed', angleCategory: 'back', shotType: 'full' },
  { id: 205, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with both hands raised touching the back of the head, wearing a thong and unclasped bra, in low warm candlelight with amber tones, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'low_warm', clothingState: 'lingerie', angleCategory: 'back', shotType: 'full' },
  { id: 206, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing straight with legs slightly apart, nude with towel draped over one shoulder, in even soft studio lighting, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'soft_studio', clothingState: 'minimal', angleCategory: 'back', shotType: 'full' },
  { id: 207, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, walking away with confident stride, wearing high-waisted jeans and crop top, in warm golden light, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'warm_golden', clothingState: 'fully_clothed', angleCategory: 'back', shotType: 'full' },
  { id: 208, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with arched back and hands on lower back, completely nude, in dramatic chiaroscuro lighting from above, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'dramatic', clothingState: 'minimal', angleCategory: 'back', shotType: 'full' },
  { id: 209, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, bending forward slightly at the waist with arched lower back, wearing a lace thong and garter belt, in bright studio light, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'bent_arched', lightingCategory: 'soft_studio', clothingState: 'lingerie', angleCategory: 'back', shotType: 'full' },
  { id: 210, prompt: `${BASE}, body from shoulders down to mid-thigh, head not visible, back facing the camera with slight over-the-shoulder twist, wearing an oversized shirt slipping off one shoulder exposing back, in warm golden window light from the right, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'over_shoulder', lightingCategory: 'warm_golden', clothingState: 'partially_clothed', angleCategory: 'back', shotType: 'three_quarter' },
  { id: 211, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with feet together, wearing a fitted pencil skirt and sleeveless blouse, backlit creating a silhouette rim light, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'backlit', clothingState: 'fully_clothed', angleCategory: 'back', shotType: 'full' },
  { id: 212, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with crossed arms behind back, nude body, in low warm lamplight with deep amber glow, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'low_warm', clothingState: 'minimal', angleCategory: 'back', shotType: 'full' },
  { id: 213, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, walking away in heels with swaying hips, wearing matching bra and panty set with garter stockings, in dramatic spotlight from above, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'dramatic', clothingState: 'lingerie', angleCategory: 'back', shotType: 'full' },
  { id: 214, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, leaning forward with hands on knees and back arched, wearing unbuttoned denim shorts and no top, in even studio lighting, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'bent_arched', lightingCategory: 'soft_studio', clothingState: 'partially_clothed', angleCategory: 'back', shotType: 'full' },
  { id: 215, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing relaxed with one knee slightly bent, wearing only a thong, in warm golden sunset light from the side, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'warm_golden', clothingState: 'minimal', angleCategory: 'back', shotType: 'full' },
  { id: 216, prompt: `${BASE}, body from shoulders down to mid-thigh, head not visible, back facing the camera with torso twisted slightly, wearing a backless evening gown, in dramatic side lighting casting long shadows, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'over_shoulder', lightingCategory: 'dramatic', clothingState: 'fully_clothed', angleCategory: 'back', shotType: 'three_quarter' },
  { id: 217, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with legs apart in a power stance, wearing a sheer bodysuit, backlit with warm rim light tracing the curves, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'backlit', clothingState: 'lingerie', angleCategory: 'back', shotType: 'full' },
  { id: 218, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, walking away barefoot on studio floor, nude body glistening with light oil sheen, in clean bright studio light, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'soft_studio', clothingState: 'minimal', angleCategory: 'back', shotType: 'full' },
  { id: 219, prompt: `${BASE}, body from shoulders down to mid-thigh, head not visible, back facing the camera, rear view, bending over with exaggerated arch in lower back, wearing loose tank top hanging forward and boy shorts, in warm golden light, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'bent_arched', lightingCategory: 'warm_golden', clothingState: 'partially_clothed', angleCategory: 'back', shotType: 'three_quarter' },
  { id: 220, prompt: `${BASE}, full body from neck down to toe, head not visible, back facing the camera, rear view, standing with arms at sides, wearing fitted yoga pants and sports bra, in neutral studio lighting, back of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'soft_studio', clothingState: 'fully_clothed', angleCategory: 'back', shotType: 'full' },
  // --- 10 SIDE PROFILE VIEWS (221-230) ---
  { id: 221, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, standing straight with arms relaxed at sides, nude body, in dramatic single-source light from behind creating rim lighting on curves, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'dramatic', clothingState: 'minimal', angleCategory: 'side', shotType: 'full' },
  { id: 222, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, standing with one leg forward and back arched, wearing a corset and thigh-high stockings, in soft even studio light, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'soft_studio', clothingState: 'lingerie', angleCategory: 'side', shotType: 'full' },
  { id: 223, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, mid-stride walking to the right, wearing a fitted wrap dress and heels, in warm golden light from behind, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'warm_golden', clothingState: 'fully_clothed', angleCategory: 'side', shotType: 'full' },
  { id: 224, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, standing straight with hands behind back, wearing an open kimono robe with nothing underneath, backlit creating a silhouette with rim glow, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'backlit', clothingState: 'partially_clothed', angleCategory: 'side', shotType: 'full' },
  { id: 225, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, bending forward with deeply arched back, nude body, in low warm ambient light with golden tones, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'bent_arched', lightingCategory: 'low_warm', clothingState: 'minimal', angleCategory: 'side', shotType: 'full' },
  { id: 226, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, standing with hand on hip and chest pushed out, wearing skin-tight leather pants and halter top, in dramatic spotlight from above, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'dramatic', clothingState: 'fully_clothed', angleCategory: 'side', shotType: 'full' },
  { id: 227, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, standing relaxed with weight on back leg, wearing a sheer negligee, in warm golden window light, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'warm_golden', clothingState: 'lingerie', angleCategory: 'side', shotType: 'full' },
  { id: 228, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, walking to the left with confident stride, wearing only high heels, in clean bright studio lighting, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'soft_studio', clothingState: 'minimal', angleCategory: 'side', shotType: 'full' },
  { id: 229, prompt: `${BASE}, body from shoulders down to mid-thigh, head not visible, side profile with slight twist toward camera, wearing an unbuttoned blouse tied at the waist and mini skirt, in dramatic moody side lighting, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'over_shoulder', lightingCategory: 'dramatic', clothingState: 'partially_clothed', angleCategory: 'side', shotType: 'three_quarter' },
  { id: 230, prompt: `${BASE}, full body from neck down to toe, head not visible, full side profile view, standing with arched back and arms raised overhead, wearing matching bra and panty set, backlit with warm light creating glowing rim outline, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'backlit', clothingState: 'lingerie', angleCategory: 'side', shotType: 'full' },
  // --- 10 FRONT/THREE-QUARTER/LOW-ANGLE FILL (231-240) ---
  { id: 231, prompt: `${BASE}, full body from neck down to toe, head not visible, three-quarter view angled slightly to the right, standing with legs apart, nude body, in dramatic chiaroscuro lighting from the left, body angled to the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'dramatic', clothingState: 'minimal', angleCategory: 'three_quarter', shotType: 'full' },
  { id: 232, prompt: `${BASE}, body from shoulders down to hip, head not visible, front facing the camera, crouching down in a deep squat with knees apart, wearing a lace bralette and matching bottoms, in soft studio lighting, body squared to the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'crouching', lightingCategory: 'soft_studio', clothingState: 'lingerie', angleCategory: 'front', shotType: 'half' },
  { id: 233, prompt: `${BASE}, full body from neck down to toe, head not visible, three-quarter view, bending forward with hands on thighs and back arched, wearing an unzipped hoodie with nothing underneath, in warm golden light, ${Q}`, negativePrompt: NEG, poseCategory: 'bent_arched', lightingCategory: 'warm_golden', clothingState: 'partially_clothed', angleCategory: 'three_quarter', shotType: 'full' },
  { id: 234, prompt: `${BASE}, full body from neck down to toe, head not visible, low angle looking up at the body, standing with hands on hips in a power pose, wearing a fitted mini dress and platform heels, in dramatic upward lighting, low angle view, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'dramatic', clothingState: 'fully_clothed', angleCategory: 'low_angle', shotType: 'full' },
  { id: 235, prompt: `${BASE}, full body from neck down to toe, head not visible, low angle looking up at the body, standing with legs slightly apart, nude body, backlit with warm rim light from behind, low angle view, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_neutral', lightingCategory: 'backlit', clothingState: 'minimal', angleCategory: 'low_angle', shotType: 'full' },
  { id: 236, prompt: `${BASE}, body from shoulders down to hip, head not visible, three-quarter view, kneeling on one knee with the other leg forward, wearing an open flannel shirt with underwear, in low warm lamplight, ${Q}`, negativePrompt: NEG, poseCategory: 'crouching', lightingCategory: 'low_warm', clothingState: 'partially_clothed', angleCategory: 'three_quarter', shotType: 'half' },
  { id: 237, prompt: `${BASE}, full body from neck down to toe, head not visible, front facing the camera, walking toward the camera with confident stride, wearing fitted leggings and a tight crop top, in bright studio light, body approaching the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'walking', lightingCategory: 'soft_studio', clothingState: 'fully_clothed', angleCategory: 'front', shotType: 'full' },
  { id: 238, prompt: `${BASE}, full body from neck down to toe, head not visible, side view, lying on side on a bed with legs stacked and slightly bent, nude body with satin sheet partially draped over hip, in warm golden light from a bedside lamp, side of body facing the camera, ${Q}`, negativePrompt: NEG, poseCategory: 'lying_down', lightingCategory: 'warm_golden', clothingState: 'minimal', angleCategory: 'side', shotType: 'full' },
  { id: 239, prompt: `${BASE}, full body from neck down to toe, head not visible, three-quarter rear view showing back and side, standing with one leg crossed in front of the other, wearing a strappy bodysuit, in dramatic spotlight from the right, ${Q}`, negativePrompt: NEG, poseCategory: 'standing_attitude', lightingCategory: 'dramatic', clothingState: 'lingerie', angleCategory: 'three_quarter', shotType: 'full' },
  { id: 240, prompt: `${BASE}, full body from neck down to toe, head not visible, low angle looking up, leaning forward with back arched and hands on knees, wearing a push-up bra and high-waisted thong, in soft studio light, low angle view, ${Q}`, negativePrompt: NEG, poseCategory: 'bent_arched', lightingCategory: 'soft_studio', clothingState: 'lingerie', angleCategory: 'low_angle', shotType: 'full' },
];

export const ANIME_PROMPTS: AnimePrompt[] = [...buildPrompts(), ...TARGETED_PROMPTS];
