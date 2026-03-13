# CLAUDE.md

## Image Generation Best Practices

### Character Consistency Rules
1. **Approved characters** have three approval stages that must be completed in order:
   a. **Face** — generated via RealVisXL + Melanin LoRA. Must be approved before body.
   b. **Body** — generated via RealVisXL + Venus Body LoRA. Must be approved before LoRA training.
   c. **Character LoRA** — trained on Replicate using `ostris/flux-dev-lora-trainer`
      with the approved face + body images as the dataset seed. Must be deployed before
      any scene images can be generated for the series.
2. **Non-character people** (background figures, unnamed extras, one-off mentions like "a waiter", "his mother", "the woman at the next table"): MUST be described inline in the scene prompt with physical details, since the pipeline has no data for them. Keep these descriptions brief — just enough for the model to render them correctly (e.g., "older woman in floral dress and doek in background" rather than full Five Layers treatment).
3. Scene prompts describe ONLY: action, pose, clothing for this scene, setting, lighting, camera angle, composition, gaze/expression — plus any non-character people as described above.
4. Never include physical descriptions (skin tone, hair, build, face shape) for approved characters in scene prompts — the pipeline injects these from character data.
5. Always specify gaze direction explicitly using plain text: "looking directly at the camera" (no emphasis weights — Flux's T5 encoder ignores them).
6. For multi-character scenes with TWO approved characters, use primary + secondary character linking. Both get their identity injected. Only describe non-character people inline.
7. **Three or more characters in a scene (Option B):** The pipeline supports a maximum
   of two linked characters per image prompt. For scenes with three or more named characters:
   - Link only the two characters with the most visual/narrative significance in this
     specific image using `character_name` and `secondary_character_name`
   - All additional characters MUST be described inline in the scene prompt with enough
     physical detail for the model to render them (e.g., "an older woman in a floral dress
     and doek stands near the door, watching them").
   - These inline characters receive no LoRA, no identity prefix, and no character reference
     image — they are rendered from prompt description alone.
   - Story image prompts in the JSON export must never have a third character field.
8. **Character LoRA injection for scene images**: The deployed character LoRA filename
   is fetched from `character_loras` table (status = 'deployed') and injected into the
   Kontext workflow `loras[]` array before style LoRAs. Character LoRAs are downloaded
   at RunPod runtime via the `character_lora_downloads` handler in patch_handler.py.
   If a character has no deployed LoRA, scene generation throws — never silently skips.
9. **Male ethnicity normalisation**: Male characters whose ethnicity or skin tone
   indicates Black/African descent have their ethnicity label replaced with
   "African American" in the generated prompt. This is AI-classified at generation
   time using Claude Haiku — not keyword-matched. Female characters are unaffected.
   The original stored character data is never modified.

### Character LoRA Training

The pipeline runs 6 stages, tracked in the `character_loras` table with checkpointing
for resume after failure:

1. **Dataset generation** — Hybrid approach:
   - Face/head shots: Nano Banana Pro (Replicate `google/nano-banana-pro`)
     using approved portrait as reference
   - Body shots (female): SDXL + Venus Body LoRA on Replicate → Flux Kontext img2img
     conversion (denoise: 0.72) for photorealistic curvaceous output
   - Body shots (male): ComfyUI/RunPod Kontext workflow directly

2. **Quality evaluation** — Claude Vision scores each image; minimum score 7/10 to pass

3. **Captioning** — Auto-generated from prompt templates (autocaption: false —
   we provide captions, not Replicate)

4. **Training** — `ostris/flux-dev-lora-trainer` on Replicate.
   Default params: steps: 1500, learning_rate: 0.0004, lora_rank: 16, resolution: 512.
   Retry params: attempt 2 → steps: 2000, lr: 0.0002; attempt 3 → lora_rank: 32

5. **Validation** — Test images generated with the trained LoRA, face scored by Claude Vision

6. **Deployment** — .safetensors uploaded to Supabase Storage,
   registered in `character_loras` table with status: 'deployed'

**Critical**: The trainer uses `ostris/flux-dev-lora-trainer` (Flux-compatible).
Never use `stability-ai/sdxl` trainer — SDXL LoRAs are architecturally incompatible
with Flux Kontext and will silently produce wrong results.

### Scene Prompt Format
Write scene prompts as **natural-language prose** — not comma-separated tags. Flux uses a T5 text encoder that processes sentences, not tag lists.

**Rules:**
- NO emphasis weights — `(tag:1.3)` syntax is ignored by T5. Just describe what you want.
- NO negative prompts — Flux has no negative conditioning. Omit "avoid X" phrasing.
- NO quality tags — no masterpiece, best quality, 8k, photorealistic, etc.
- Write flowing descriptive sentences, not comma-separated fragments.
- Character identity is injected as a prose paragraph by the pipeline — do NOT include physical descriptions.

**Clothing guidance for female characters:** Default to form-fitting, revealing, or glamorous clothing choices (fitted tops, low necklines, mini skirts, heels, bodycon dresses, etc.). The pipeline enhances attractiveness automatically — scene clothing should complement this, not fight it. Only use loose/baggy/modest clothing when it's a deliberate creative choice. Never leave clothing unspecified.

Example (old comma-tag style — DO NOT USE):
"leaning forward over restaurant table, (sharp seductive half-smile, looking directly at camera:1.3), fitted low-cut top showing tasteful cleavage, gold earrings"

Example (correct Flux prose — USE THIS):
"She leans forward over the restaurant table with a sharp seductive half-smile, looking directly at the camera. She wears a fitted low-cut top showing tasteful cleavage and gold earrings. A wine glass dangles from her fingers. The scene is lit by warm amber light from a single overhead pendant inside Piatto restaurant on a Friday evening. Medium shot at eye level with a shallow depth of field blurring the other diners."

### The Five Layers (Every Prompt Must Have All Five)
1. Expression & Gaze — face tells the story; describe gaze direction explicitly in plain text
2. Narrative Implication — something just happened or is about to, viewer fills the gap
3. Lighting & Atmosphere — name the specific light source, never "warm lighting"
4. Composition & Framing — camera angle, shot type, depth of field, strategic cropping
5. Setting & Cultural Grounding — specific South African environmental details

### What Makes a Great Sensual Image
- Tension over exposure — the "moment before" is more powerful than nudity
- Expression is the single biggest differentiator between forgettable and scroll-stopping
- Direct eye contact with intent creates immediate connection with the viewer
- Strategic obscuring (steam, fabric, shadow, another person's body) implies more than showing
- Warm, directional lighting from a named source (candle, streetlight, window) creates intimacy
- Cultural grounding (African print fabric, specific SA locations, local objects) creates authenticity and differentiates from generic AI content

### Model Selection

**Character Approval (face + body):**
- Model: RealVisXL V5.0 BakedVAE (`realvisxlV50_v50Bakedvae.safetensors`) via ComfyUI on RunPod
- Face generation: RealVisXL + Melanin Girlfriend mix LoRA (`melanin-XL.safetensors`,
  trigger: `melanin`, strength: 0.5) + Skin Tone XL (`sdxl-skin-tone-xl.safetensors`,
  trigger: `dark chocolate skin tone style`, strength: 0.6) + Skin Realism
  (`sdxl-skin-realism.safetensors`, trigger: `Detailed natural skin and blemishes
  without-makeup and acne`, strength: 0.4) — all three for Black/African characters.
  Skin Realism strength capped at 0.4 to prevent age regression artifact.
- Body generation: RealVisXL + Venus Body LoRA (`venus-body-xl.safetensors`,
  trigger: `venusbody`, strength: 0.75) + Melanin LoRA (for Black/African female characters)
- SDXL supports negative prompts — use them to prevent european/asian features and poor anatomy
- Trigger words MUST appear at the start of the positive prompt

**Scene Image Generation:**
- Model: Flux Krea Dev (`flux1KreaDev_fp8E4m3fn.safetensors`) via ComfyUI on RunPod
- Character consistency: trained character LoRA (from LoRA training pipeline) injected
  as the FIRST LoRA in the stack at strength 0.85, before style LoRAs
- Style LoRAs — slot priority order:
  - Slot 1: Realism LoRA (always)
  - Slot 2: Detail/Style LoRA (Fashion Editorial SFW / Boudoir NSFW / Add Details)
  - Slot 3: Skin texture LoRA (Beauty Skin / Oiled / Sweat — situational)
  - Slot 4: Body shape LoRA (BodyLicious / Hourglass — female only)
  - Slot 5: Kissing LoRA / Lustly NSFW anatomy
  - Slot 6: RefControl pose LoRA (optional)
  - Slot 7: Cinematic Finisher (interior/night OR clothing — not close-up/wide)
- Scene images require ALL characters to have a deployed LoRA — generation is blocked otherwise

### Self-Contained Prompts (Critical)
Every image prompt must be fully self-contained. Each image is generated independently — there is NO context, NO memory, and NO reference to any other image or prompt.

NEVER use in any prompt:
- "Same scene...", "Same bedroom...", "Same café..."
- "Same lighting...", "Same composition..."
- "But now...", "This time...", "Tighter framing than before..."
- "More intimate version of...", "The next beat of..."
- Any phrase that assumes the model knows what a previous image looked like

ALWAYS re-describe:
- The full setting (location, environment, props)
- The lighting (specific light source and direction)
- The atmosphere and mood
- Character positioning and spatial relationship
- Camera angle and composition

For NSFW paired prompts, achieve visual continuity by independently describing the same setting details (not by saying "same") while advancing the intimacy level.

### Multi-Character Scenes
- Tag the scene with the PRIMARY character only
- The secondary character's identity is injected automatically by the pipeline
- Give spatial composition instructions: "woman in foreground left, man behind right shoulder"
- For dual scenes, both portrait reference images are combined horizontally before conditioning

### Female Character Enhancement
1. Female characters receive attractiveness prose in the identity prefix (injected by the pipeline): beautiful face, curvaceous figure, etc.
2. **Body LoRAs for scene images**: `bodylicious-flux.safetensors` (default) or
   `hourglassv32_FLUX.safetensors` (optional) are loaded for scenes with female characters.
   These are SCENE IMAGE LoRAs for Flux — not used during character approval (which uses
   RealVisXL + `venus-body-xl.safetensors` instead).
3. The only override is when the scene prompt explicitly includes loose/baggy/oversized clothing — this signals a deliberate creative choice and the pipeline adjusts enhancement accordingly.

## Error Handling
- Do NOT add silent fallbacks or default values that mask errors
- If something fails, throw or surface the error explicitly
- Never swallow exceptions with try/catch unless the catch block re-throws or logs with full context
- Prefer failing loudly over degrading gracefully — this codebase needs to surface problems, not hide them

## General
- Dont ask me to check the Railway logs
- You have access to the Railway logs, check them yourself
