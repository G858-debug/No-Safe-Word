/**
 * Stable Diffusion knowledge base for the Art Director pipeline.
 *
 * Injected into Qwen VL system prompts contextually so the model
 * can make informed decisions about recipe adaptation, evaluation,
 * and iteration feedback.
 */

// ── Section A: Model Knowledge ──

export interface ModelKnowledge {
  strengths: string;
  weaknesses: string;
  recommendedSettings: {
    cfgScale: [number, number];
    steps: [number, number];
    sampler: string;
    clipSkip: number;
  };
  promptStyle: string;
  skinToneNotes: string;
}

export const MODEL_KNOWLEDGE: Record<string, ModelKnowledge> = {
  "Juggernaut XL Ragnarok": {
    strengths:
      "Best-in-class photorealism for SDXL. Excellent skin textures, natural lighting. Strong with diverse ethnicities when prompted correctly.",
    weaknesses:
      "Can struggle with complex multi-character poses without ControlNet. Tends toward lighter skin tones unless explicitly prompted.",
    recommendedSettings: {
      cfgScale: [4.5, 6.0],
      steps: [28, 35],
      sampler: "DPM++ 2M Karras",
      clipSkip: 1,
    },
    promptStyle:
      "Booru tags work but natural language mixed in helps. Front-load character descriptions before scene content.",
    skinToneNotes:
      "Handles diverse skin tones well when prompted explicitly. For each character, use the EXACT skin tone descriptor from their character data (e.g., 'light brown skin', 'caramel skin', 'medium brown skin', 'dark brown skin', 'deep ebony skin'). SDXL defaults toward medium-light tones without explicit prompting. For deeper skin tones: lower CFG to 4.5-5.5 to preserve skin texture and avoid muddy/ashy rendering. For lighter skin tones: standard CFG 5-7 works fine. Always specify the exact tone — 'Black African woman' alone doesn't communicate skin tone to the model.",
  },
  "Juggernaut XL": {
    strengths:
      "Strong photorealism, predecessor to Ragnarok. Good with natural lighting and skin detail.",
    weaknesses:
      "Older version — Ragnarok supersedes it in most tasks. Less refined on complex compositions.",
    recommendedSettings: {
      cfgScale: [4.5, 6.5],
      steps: [25, 35],
      sampler: "DPM++ 2M Karras",
      clipSkip: 1,
    },
    promptStyle:
      "Similar to Ragnarok. Booru tags + natural language hybrid works well.",
    skinToneNotes:
      "Similar to Ragnarok — explicit skin tone descriptors needed. Use the character's exact skin tone. Lower CFG to 4.5-5.5 for deep/dark brown tones; standard CFG 5-6.5 for light/medium brown tones.",
  },
  "epiCRealism XL": {
    strengths:
      "Strong photorealism, good with intimate scenes. Popular on CivitAI for couples content.",
    weaknesses:
      "Less diverse training data than Juggernaut. May need stronger ethnicity prompting.",
    recommendedSettings: {
      cfgScale: [5, 7],
      steps: [25, 35],
      sampler: "DPM++ 2M Karras",
      clipSkip: 1,
    },
    promptStyle:
      "Booru tags preferred. Quality tags like 'masterpiece, best quality' still help.",
    skinToneNotes:
      "Less diverse training data — requires explicit skin tone tags for all characters. Use the exact descriptor from character data. For deep skin tones: CFG 5-5.5 max. For lighter tones: standard CFG 5-7 is fine. Adding 'African features, full lips' alongside skin tone helps maintain facial feature accuracy.",
  },
  RealVisXL: {
    strengths:
      "Very photorealistic faces. Good for portrait and close-up work.",
    weaknesses:
      "Can produce overly smooth/plastic skin at higher steps. Less tested with diverse body types.",
    recommendedSettings: {
      cfgScale: [5, 7],
      steps: [25, 30],
      sampler: "DPM++ 2M SDE Karras",
      clipSkip: 1,
    },
    promptStyle: "Natural language works well. Quality tags helpful.",
    skinToneNotes:
      "Tends to lighten ALL skin tones — be very explicit with the exact descriptor. For deep tones: use '(dark brown skin:1.3)' with emphasis and lower CFG to 5. For medium tones: 'warm brown skin' or 'medium brown skin' works but verify. For light brown/caramel: this model handles lighter tones more reliably but still specify explicitly.",
  },
  "Pony Diffusion V6 XL": {
    strengths:
      "Strong with stylized/anime-adjacent content. Good pose adherence due to booru tag training.",
    weaknesses:
      "Not photorealistic — produces semi-anime style. Requires Pony-specific quality tags.",
    recommendedSettings: {
      cfgScale: [6, 8],
      steps: [25, 35],
      sampler: "DPM++ 2M Karras",
      clipSkip: 2,
    },
    promptStyle:
      "Booru tags ONLY. Requires score_9, score_8_up quality tags. Uses rating_safe/rating_explicit.",
    skinToneNotes:
      "Uses booru tag conventions. For skin tones: 'dark skin', 'brown skin', 'light brown skin' as booru tags. Add 'dark-skinned_female' or 'dark-skinned_male' for deeper tones. Style is inherently less photorealistic — skin tone accuracy is secondary to style consistency.",
  },
  "SDXL Base": {
    strengths:
      "Vanilla SDXL 1.0 base. Neutral starting point, predictable behavior.",
    weaknesses:
      "Not fine-tuned for any niche — worse than specialized checkpoints at everything.",
    recommendedSettings: {
      cfgScale: [6, 8],
      steps: [30, 40],
      sampler: "DPM++ 2M Karras",
      clipSkip: 1,
    },
    promptStyle:
      "Natural language or booru tags both work. Quality tags help compensate for lack of fine-tuning.",
    skinToneNotes:
      "Moderate diversity in base training but defaults toward medium-light tones. Always specify the exact skin tone from character data. Deeper tones need lower CFG (5-6). Lighter tones work at standard CFG (6-8).",
  },
};

/**
 * Try to find a model in our knowledge base by fuzzy matching the name.
 * CivitAI recipe metadata uses inconsistent naming.
 */
export function lookupModelKnowledge(
  modelName: string | null
): ModelKnowledge | null {
  if (!modelName) return null;

  const lower = modelName.toLowerCase();

  // Exact match first
  for (const [key, value] of Object.entries(MODEL_KNOWLEDGE)) {
    if (key.toLowerCase() === lower) return value;
  }

  // Partial match
  for (const [key, value] of Object.entries(MODEL_KNOWLEDGE)) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) || keyLower.includes(lower)) return value;
  }

  // Keyword matching
  if (lower.includes("juggernaut") && lower.includes("ragnarok"))
    return MODEL_KNOWLEDGE["Juggernaut XL Ragnarok"];
  if (lower.includes("juggernaut"))
    return MODEL_KNOWLEDGE["Juggernaut XL"];
  if (lower.includes("epic") && lower.includes("real"))
    return MODEL_KNOWLEDGE["epiCRealism XL"];
  if (lower.includes("realvis"))
    return MODEL_KNOWLEDGE["RealVisXL"];
  if (lower.includes("pony"))
    return MODEL_KNOWLEDGE["Pony Diffusion V6 XL"];

  return null;
}

// ── Section B: Technical Knowledge ──

export const SDXL_TECHNICAL_KNOWLEDGE = `
## SDXL Generation Technical Reference

### Resolution
- SDXL native: 1024x1024. Never generate at non-SDXL resolutions (512x512 is SD1.5).
- Landscape (two characters side by side, lying down scenes): 1216x832 or 1344x768
- Portrait (standing, single character focus): 832x1216 or 768x1344
- Choose based on scene composition, not randomly.

### CFG Scale
- Controls how strictly the model follows the prompt vs generating freely.
- 4-5.5: Soft, natural, photorealistic. Best for intimate scenes and characters with deeper skin tones.
- 6-7: Balanced. Good default for most scenes.
- 8+: Aggressive prompt adherence. Colors oversaturate, skin looks plastic, artifacts appear. Almost never use above 8 for photorealism.

### CFG and Skin Tones
- CFG interacts differently with different skin tones:
  - Light brown / caramel skin: CFG 5-7 works well. Standard range.
  - Medium brown skin: CFG 5-6 is the sweet spot. Above 7 starts to wash out texture.
  - Dark brown / deep skin: CFG 4.5-5.5 only. Higher values destroy skin texture, create muddy/ashy artifacts, or add unwanted shininess.
- Always check the character's specific skin tone from their character data and adjust CFG accordingly.
- When iterating: if skin looks wrong, CFG adjustment is the FIRST thing to try.

### Samplers
- DPM++ 2M Karras: The workhorse. Fast, reliable, good quality. Default choice.
- DPM++ SDE Karras: More detail, slightly more variation between generations. Good for scenes needing fine texture (skin, fabric, hair).
- Euler a: Simpler, faster, sometimes softer results. Good for dreamy/soft-focus scenes.
- UniPC: Fast convergence, good for lower step counts. Less common in CivitAI recipes.
- If a reference recipe used a specific sampler and the image looked good, KEEP that sampler.

### Steps
- 20-25: Quick, sometimes slightly soft. Fine for evaluation/iteration drafts.
- 28-35: Sweet spot for final quality. Most CivitAI NSFW images use this range.
- 40+: Diminishing returns. Rarely improves quality, doubles generation time.
- During iteration: use 20-25 steps for speed. Final generation after 90% score: bump to 30-35.

### LoRA Stacking Rules
- Max 3-4 LoRAs before quality degrades. Each LoRA pulls the model in a direction — too many and they fight each other.
- Character/face LoRAs: 0.5-0.7 strength. Higher = more identity adherence but less flexibility.
- Body/pose LoRAs: 0.3-0.5 strength. These are subtle adjustments.
- Style LoRAs: 0.3-0.5. Too high and they override the checkpoint's photorealism.
- Anatomy fix LoRAs (hands, feet): 0.3-0.5. Essential for multi-character scenes.
- NEVER stack two LoRAs that do the same thing (e.g., two different hand-fix LoRAs).
- If a reference recipe used 6+ LoRAs, that's a red flag — the creator was overcompensating. Simplify.

### Multi-Character Composition (THE HARD PROBLEM)
- SDXL's 77-token CLIP window is the enemy. Two character descriptions + a scene description easily exceeds this.
- Front-load character COUNT: "2people", "1boy 1girl", "couple" — this must be in the first 10 tokens.
- Front-load interaction TYPE: "sex", "kissing", "embracing" — within the first 15 tokens.
- Character details (skin tone, body type) should be brief per character — don't write paragraphs.
- Scene details (lighting, setting) come LAST — they're the first to get truncated by CLIP.
- This is why CivitAI recipes for successful multi-character NSFW scenes often use very short, dense tag lists — they're optimizing for the CLIP window.

### Negative Prompts for Photorealism
Standard base: "cartoon, anime, illustration, painting, drawing, 3d render, CGI, bad anatomy, deformed, extra limbs, missing limbs, blurry, watermark, text, signature"
For intimate scenes add: "extra fingers, mutated hands, poorly drawn hands, poorly drawn face, mutation, ugly, disfigured"

### Negative Prompts and Skin Tone
- NEVER put skin tone terms in the negative prompt. Let the positive prompt handle skin tone entirely.
- If the reference recipe's negative prompt contains skin tone terms (e.g., "pale skin", "dark skin"), REMOVE them regardless of your character's tone.
- The positive prompt's explicit skin tone descriptor + appropriate CFG is sufficient.

### Prompt Token Budget Strategy
Given 77 tokens total:
- Tokens 1-5: Character count + interaction ("2people, 1boy 1girl, sex")
- Tokens 6-15: Position/pose ("cowgirl position, woman straddling man")
- Tokens 16-30: Key body language ("hands on chest, head tilted back, eyes closed")
- Tokens 31-45: Skin/body descriptions ("{character's exact skin tone}, curvaceous woman, muscular man, nude")
- Tokens 46-60: Setting ("township bedroom, warm lamp light")
- Tokens 61-75: Composition ("medium shot, low angle, golden tones")
- Tokens 76-77: Quality anchor ("masterpiece" or similar)
This order matches CLIP's attention decay — most important tokens go first.
`;

// ── Section C: Character Adaptation Knowledge ──

export const CHARACTER_ADAPTATION_KNOWLEDGE = `
## Adapting CivitAI Recipes for Black South African Characters

### Character Identity in SDXL
Black South African characters are defined by facial features + specific skin tone + hair texture, NOT by skin darkness alone. Our characters span the full spectrum:
- Light: "light brown skin", "caramel skin", "honey complexion"
- Medium: "brown skin", "warm brown skin", "medium brown skin", "chestnut skin"
- Deep: "dark brown skin", "deep brown skin", "ebony skin", "rich dark skin"

The character's structured data includes a specific skinTone field. ALWAYS use that exact descriptor in prompts. Never default to "dark skin" for all characters.

### Prompt Modifications When Adapting a Reference Recipe
1. READ the character's skinTone from their structured data. Use EXACTLY that descriptor.
2. ADD the skin tone descriptor early in the prompt: "{character's skinTone} skin" — e.g., "caramel skin" or "dark brown skin"
3. ADD facial feature descriptors: "full lips, broad nose, African features" — these define Black identity independent of skin tone
4. ADD hair specifics from character data: "braids", "natural hair", "afro", "locs", "cornrows", "relaxed hair" — use the exact style from the character description
5. ADD body type tags for curvaceous female characters: "curvy, wide hips, thick thighs, full breasts, hourglass figure" — be explicit, SDXL defaults to slim builds
6. REMOVE from reference prompt: any conflicting ethnicity or skin tone tags ("pale skin", "fair skin", "white", "asian", "japanese", or any skin tone that contradicts the character)
7. KEEP from reference prompt: all pose, composition, lighting, and setting tags — these transfer directly

### CFG Adjustment by Skin Tone
- Light brown / caramel characters: Keep reference recipe's CFG if it's 5-7. Only lower if above 7.
- Medium brown characters: Lower CFG by 0.5-1 point from reference. Target 5-6.
- Dark brown / deep characters: Lower CFG by 1.5-2 points from reference. Target 4.5-5.5.
- This is the single most important setting change for skin tone accuracy.

### LoRA Modifications
1. REMOVE any LoRAs that are character-specific to the reference image's subject (face LoRAs, specific person LoRAs)
2. KEEP pose/composition LoRAs — these are position-agnostic
3. KEEP quality/detail LoRAs (DetailTweaker, hand fixers, etc.)
4. KEEP style LoRAs if the aesthetic matches what we want
5. CONSIDER searching CivitAI for LoRAs that help with the character's specific features if default rendering is poor

### Common Failure Modes
- Skin tone doesn't match character: The prompt's skin tone descriptor is wrong or missing. Use the EXACT term from character data.
- Skin turns ashy/gray: CFG too high for that skin tone. Lower it.
- Skin looks plastic/shiny: Too many quality LoRAs or steps too high. Reduce both.
- Model defaults to light skin despite tags: Some models have strong priors. Increase emphasis weight: "(dark brown skin:1.3)". Or try a different base model.
- Model defaults to dark skin when character is light-skinned: Remove any "dark" terms from positive prompt. Add "(light brown skin:1.2)" or "(caramel skin:1.2)" with emphasis.
- Character merged into one person: Character count not front-loaded in prompt. Put "2people" literally first.
- Wrong body type: SDXL defaults to slim. Be very explicit about curves.
- Hair wrong: SDXL has limited training data for afro-textured hairstyles. Be extremely specific.
`;

// ── Section D: Evaluation Criteria Knowledge ──

export const EVALUATION_KNOWLEDGE = `
## Image Evaluation Criteria for Art Director

When evaluating a generated image against the prompt intent, score each dimension 0-100:

### Position/Pose Accuracy (weight: 30%)
- 90-100: Exact position match. Bodies are arranged as described. Limbs are where they should be.
- 70-89: Right general position but details off (e.g., cowgirl but hands in wrong place)
- 50-69: Approximation of the position but clearly not what was asked (e.g., asked for doggystyle, got missionary)
- Below 50: Completely wrong position or characters not interacting as described

### Character Count (weight: 20%)
- 100: Correct number of characters with correct genders
- 50: Right number but wrong gender for one character (e.g., two women instead of man + woman)
- 0: Wrong number of characters (this is a hard fail — the most common failure mode)

### Setting/Environment (weight: 15%)
- 90-100: Setting matches description (bedroom, bar, workshop, etc.) with specific details present
- 70-89: Right general setting but missing specific details (e.g., bedroom but no moonlight)
- 50-69: Generic setting, some elements match
- Below 50: Wrong setting entirely

### Lighting/Mood (weight: 10%)
- 90-100: Lighting matches description (moonlight, warm lamp, neon, etc.) and creates the right mood
- 70-89: Generally right atmosphere but light source doesn't match description
- Below 70: Lighting is generic or contradicts the prompt

### Character Appearance (weight: 15%)
- Compare against the approved character portraits provided
- 90-100: Skin tone matches character data exactly, body type correct, hair style/color correct, facial features appropriate
- 70-89: Most features match, skin tone approximately right (within one shade), 1-2 minor details off
- 50-69: General resemblance but skin tone noticeably wrong (e.g., character is caramel-skinned but image shows dark brown, or vice versa)
- Below 50: Doesn't look like the approved character — wrong skin tone range, wrong body type, wrong features
- CRITICAL: A light-skinned character rendered with dark skin is just as wrong as a dark-skinned character rendered with light skin. The specific tone from the character data is the ground truth.

### Composition Quality (weight: 10%)
- 90-100: Camera angle matches, framing is cinematic, depth of field appropriate
- 70-89: Decent composition but angle or framing doesn't match prompt
- Below 70: Poor composition, awkward framing, or doesn't match requested angle

### Severity Rules
- Character count wrong = overall score CANNOT exceed 40, regardless of other dimensions
- Completely wrong position (e.g., standing when should be lying down) = overall score CANNOT exceed 55
- Wrong skin tone (more than one shade off from character data) = characterAppearance score CANNOT exceed 50
`;

// ── Section E: Few-Shot Recipe Adaptation Examples ──

export const RECIPE_ADAPTATION_EXAMPLES = `
## Few-Shot Examples: Recipe Adaptation

### Example 1: Couple Scene (Intimate) — Light-skinned female + Medium-skinned male

ORIGINAL CIVITAI RECIPE:
- Model: epiCRealism XL
- Prompt: "1boy 1girl, cowgirl position, woman on top, sex, nude, pale skin, slim blonde woman, muscular man, bedroom, warm lighting, medium shot from side, masterpiece"
- Negative: "cartoon, anime, bad anatomy, extra limbs, blurry, watermark, pale skin"
- CFG: 7, Steps: 30, Sampler: DPM++ 2M Karras, Size: 1216x832
- LoRAs: [EpicRealism Helper (0.4), Better Hands (0.5), PersonX Face (0.7)]

OUR CHARACTERS:
- Palesa: Black South African woman, skinTone: "caramel", relaxed straight hair, curvaceous figure (wide hips, full breasts, thick thighs)
- Kagiso: Black South African man, skinTone: "warm brown", muscular build, short hair

ADAPTED RECIPE:
- Model: epiCRealism XL (KEPT — good with intimate scenes)
- Prompt: "2people, 1boy 1girl, cowgirl position, woman on top, sex, nude, caramel skin, African features, full lips, curvaceous woman, wide hips, full breasts, thick thighs, relaxed straight hair, warm brown skin man, muscular, short hair, African features, township bedroom, warm lamp light, medium shot from side"
  [CHANGES: removed "pale skin, slim blonde"; used EXACT skin tones from character data — "caramel" for Palesa, "warm brown" for Kagiso; added African features for facial identity; added body type; added cultural setting; removed quality tags to save tokens]
- Negative: "cartoon, anime, bad anatomy, extra limbs, blurry, watermark, extra fingers, mutated hands, 3 people, third person"
  [CHANGES: removed ALL skin tone terms from negative — "pale skin" was there; added character count enforcement]
- CFG: 6.5 (LOWERED from 7 but only slightly — caramel + warm brown tones don't need aggressive CFG reduction; 6.5 is fine for medium tones)
- Steps: 30 (KEPT)
- Sampler: DPM++ 2M Karras (KEPT)
- Size: 1216x832 (KEPT — landscape suits side-angle couple scene)
- LoRAs: [EpicRealism Helper (0.4) KEPT, Better Hands (0.5) KEPT, PersonX Face REMOVED — that's the reference creator's face LoRA]

### Example 2: Solo Female Scene — Deep-skinned character

ORIGINAL CIVITAI RECIPE:
- Model: RealVisXL
- Prompt: "1girl, standing in doorway, white lingerie, lace bra, looking over shoulder, seductive smile, bedroom behind her, soft backlighting, portrait shot, masterpiece, 8k"
- Negative: "bad anatomy, deformed, blurry, watermark, ugly, worst quality, low quality"
- CFG: 6, Steps: 28, Sampler: DPM++ 2M SDE Karras, Size: 832x1216
- LoRAs: [RealVis Helper (0.3), DetailTweaker XL (0.5), AsianGirl_v2 (0.6)]

OUR CHARACTER:
- Zanele: Black South African woman, skinTone: "deep ebony", natural afro, voluptuous build, full figure

ADAPTED RECIPE:
- Model: RealVisXL (KEPT — excellent for portraits and close-ups)
- Prompt: "1girl, deep ebony skin, dark brown skin, African features, full lips, broad nose, voluptuous, curvy, wide hips, full breasts, natural afro, standing in doorway, white lace lingerie, lace bra, looking over shoulder, seductive smile, Soweto home bedroom, soft backlighting, portrait shot"
  [CHANGES: front-loaded EXACT skin tone "deep ebony" from character data; added "dark brown skin" as reinforcement because RealVisXL tends to lighten; added African facial features; added body shape; specific SA location; removed "masterpiece, 8k" to save tokens]
- Negative: "bad anatomy, deformed, blurry, watermark, ugly, worst quality, low quality, extra fingers, mutated hands"
  [CHANGES: added hand fixes; NO skin tone terms in negative — let positive prompt handle it entirely]
- CFG: 4.5 (LOWERED from 6 — deep ebony skin needs aggressive CFG reduction on RealVisXL which already lightens)
- Steps: 28 (KEPT)
- Sampler: DPM++ 2M SDE Karras (KEPT — good for skin texture detail, especially important for deep tones)
- Size: 832x1216 (KEPT — portrait orientation suits doorway pose)
- LoRAs: [DetailTweaker XL (0.5) KEPT, AsianGirl_v2 REMOVED — ethnicity-specific LoRA conflicts with our character]

### Example 3: Romantic/Kissing Scene — Medium-skinned female + Dark-skinned male

ORIGINAL CIVITAI RECIPE:
- Model: Juggernaut XL Ragnarok
- Prompt: "couple kissing passionately, 1boy 1girl, french kiss, eyes closed, woman's hand on man's face, man holding woman's waist, close-up upper body, bar counter background, neon lights, moody atmosphere, cinematic"
- Negative: "cartoon, anime, 3d render, bad anatomy, extra limbs, blurry, text, watermark, 3 people"
- CFG: 5, Steps: 30, Sampler: DPM++ 2M Karras, Size: 1216x832
- LoRAs: [French Kiss XL (0.5), Better Hands (0.4), CoupleHug (0.3), DetailTweaker (0.4), SkinGlow (0.3), EyeDetail (0.2)]

OUR CHARACTERS:
- Sipho: Black South African man, skinTone: "dark brown", tall, athletic build, short cropped hair
- Nomvula: Black South African woman, skinTone: "warm brown", natural curls, petite but curvy

ADAPTED RECIPE:
- Model: Juggernaut XL Ragnarok (KEPT — our primary model, excellent for this)
- Prompt: "couple kissing passionately, 2people, 1boy 1girl, french kiss, eyes closed, warm brown skin woman, African features, natural curls, petite curvy, full lips, dark brown skin man, African features, tall athletic, short cropped hair, hand on face, holding waist, close-up upper body, Maboneng bar, neon signs, moody atmosphere"
  [CHANGES: front-loaded interaction; used EXACT skin tones — "warm brown" for Nomvula, "dark brown" for Sipho; added African features for both; specific SA location; dropped "cinematic" to save tokens. NOTE: each character gets their OWN skin tone tag, not a generic "dark-skinned couple"]
- Negative: "cartoon, anime, 3d render, bad anatomy, extra limbs, blurry, text, watermark, 3 people, third person, extra person"
  [CHANGES: reinforced character count in negative; no skin tone terms in negative]
- CFG: 5 (KEPT — already optimal; dark brown + warm brown tones both work at CFG 5 on Juggernaut)
- Steps: 30 (KEPT)
- Sampler: DPM++ 2M Karras (KEPT)
- Size: 1216x832 (KEPT — landscape suits two-character close-up)
- LoRAs: [French Kiss XL (0.5) KEPT — directly relevant to the pose, Better Hands (0.4) KEPT, DetailTweaker (0.4) KEPT]
  [REMOVED: CoupleHug (conflicts with kiss pose), SkinGlow (can wash out skin texture), EyeDetail (eyes are closed — useless). Reduced from 6 LoRAs to 3 — much cleaner.]
`;
