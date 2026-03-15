# CLAUDE.md

## Image Generation Best Practices

### Character Consistency Rules
1. **Approved characters** have three generation stages (face, body, and LoRA can run in parallel — no sequential gate):
   a. **Face** — generated via RealVisXL + Melanin LoRA.
      Face portrait prompts (PATH A): contain ONLY face-relevant fields — age, ethnicity,
      skin tone, hair, eyes, distinguishing features. Body type and beauty descriptors are
      explicitly excluded to prevent exposed chest rendering. Negative prompt always blocks
      nudity (nude, naked, topless, bare breasts, exposed chest, nsfw, cleavage).
   b. **Body** — generated via RealVisXL + Venus Body LoRA.
      Body shot prompts (PATH B): include body type descriptors but always include explicit
      clothing language ("form-fitting bodycon dress" or "fitted top and jeans, fully clothed")
      and a nudity-blocking negative prompt. The goal is visible body proportions through
      clothing, not nudity — LoRA training benefits more from clothed full-body shots with
      a clear silhouette.
   c. **Character LoRA** — trained on Replicate using `ostris/flux-dev-lora-trainer`
      with the face + body images as the dataset seed.
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
9. **Ethnicity normalisation**: All characters whose ethnicity or skin tone
   indicates Black/African descent have their ethnicity label replaced with
   "African American" in the generated prompt — in both SDXL character approval
   prompts and Flux scene generation prompts. This is AI-classified at generation
   time using Claude Haiku — not keyword-matched. The original stored character
   data is never modified.

### Character LoRA Training

The pipeline runs 6 stages, tracked in the `character_loras` table with checkpointing
for resume after failure:

1. **Dataset generation** — Hybrid approach:
   - Face/head shots: Nano Banana 2 (Replicate `google/nano-banana-2`)
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

### Image Prompt Rules

#### Structure (mandatory order)
Every image prompt must follow this exact structure:
1. Setting/environment (1 sentence)
2. Lighting (1 sentence)
3. Character A — pose + clothing (1-2 sentences)
4. Character B — pose + clothing (1-2 sentences, dual-character only)
5. Composition/framing (1 sentence)

#### Length
Maximum 100 words per prompt. Every sentence must earn its place.

#### Setting first
Setting and lighting always appear before any character description. Never open a prompt with a character name or physical description.

#### Pose descriptions must be anatomically literal
Do not use vague action words like "leans forward" or "looks at him". Instead describe exact body position: what the torso is doing, where arms/hands are placed, whether seated/standing/lying, position relative to the other character or environment, and any furniture contact (elbow ON table, back AGAINST wall, sitting ON crate, etc.).

#### Clothing must be explicit and specific
Name the specific garment. Use "She wears a fitted black mini skirt stopping mid-thigh and a strappy fitted top" not "she wears a top".
- Add "fully clothed" after clothing description for SFW images with regular clothing (tops, skirts, dresses).
- Do NOT add "fully clothed" for bedroom or lingerie scenes — the garment description is sufficient.
- Female characters default to: fitted short mini skirt stopping mid-thigh + strappy/fitted top, unless scene context requires otherwise.

#### Preferred compositions
Prefer medium shots or 3/4 shots (framed from mid-thigh up) over full-body shots. Full-body shots dilute curvature and read as editorial rather than intimate. Use full-body only for establishing or environmental context shots where no character is the focus.

#### Token efficiency
Flux uses 77-token chunking. Front-load the most important information. Cut redundant adjectives, repeated anatomical narration, and colour names for elements that don't affect the story read.

#### Flux syntax rules
- NO emphasis weights — `(tag:1.3)` syntax is ignored by T5. Just describe what you want.
- NO negative prompts — Flux has no negative conditioning.
- NO quality tags — no masterpiece, best quality, 8k, photorealistic, etc.
- Write natural-language prose, not comma-separated tag lists.
- Character identity is injected by the pipeline — do NOT include physical descriptions for approved characters.

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
- Body generation (female): SDXL-only pipeline. RealVisXL + Curvy Body LoRA
  (`curvy-body-sdxl.safetensors`, strength: 0.90, no trigger word) + Melanin LoRA
  (for Black/African characters). No Flux conversion, no PuLID — pure SDXL output.
- SDXL supports negative prompts — use them to prevent european/asian features and poor anatomy
- Trigger words MUST appear at the start of the positive prompt

All character image generation logic (prompt building, LoRA selection, negative
prompts, workflow construction) lives in a single shared module:
`apps/web/lib/server/generate-character-image.ts`

Both the /generate route (first-time generation) and the /regenerate route
(user-triggered redo with optional fixed seed) call this module. Changes to
the pipeline — new LoRAs, prompt fixes, clothing rules, skin improvements —
must be made ONLY in generate-character-image.ts. The routes are thin wrappers
that handle HTTP, database reads/writes, and RunPod submission only.

The only behavioural difference:
  - /generate: random seed, sets generated state on success
  - /regenerate: accepts optional fixed seed from client, does not change
    approval state

**Scene Image Generation:**
- Model: Flux Krea Dev (`flux1KreaDev_fp8E4m3fn.safetensors`) via ComfyUI on RunPod
- Character consistency: trained character LoRA (from LoRA training pipeline) injected
  as the FIRST LoRA in the stack at strength 0.65, before style LoRAs
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

## Character LoRA Training Standards

### Body Shape Requirements (Female Characters)
All female character training datasets must produce characters with:
- Very large natural breasts (not augmented-looking)
- Very wide hips
- Very large round ass
- Narrow defined waist
- Soft stomach (not athletic/flat)
- Full thighs

These must be visible and consistent across ALL training images.
When generating training images via /admin/lora-studio, use these
body descriptors explicitly in every SDXL generation prompt.
Venus Body LoRA must be active at strength 0.90 during dataset
generation. Venus Body LoRA at strength 0.90.

### Background Diversity Requirements
Training datasets must include varied backgrounds across these categories:
- Indoor day (restaurant, café, office, home interior)
- Indoor night (bedroom, lounge, dark room with artificial light)
- Outdoor day (street, township, workshop exterior, park)
- Outdoor golden hour (sunset, warm light)
- Close-up/detail shots (face only, waist up, hands)

Minimum 20% of training images must show the character in each
category. Plain/neutral backgrounds must not exceed 20% of the dataset.

### Caption Requirements
Every training image must have a detailed caption (.txt file) that includes:
1. Trigger word first (e.g. "lndw_character")
2. Setting/environment description
3. Lighting description
4. Body position/pose
5. Clothing description
6. Expression

Example:
"lndw_character, Piatto restaurant interior, warm amber pendant light,
seated at table leaning forward, wearing fitted low-cut top and mini skirt,
conspiratorial half-smile looking sideways"

### Inference Settings (from training)
- Train on: Flux 1 Dev
- Infer on: Flux 1 Krea Dev Uncensored
- Training steps: 1500-2500, save checkpoint every 500 steps
- Test each checkpoint against scene prompts before selecting final
- Character LoRA inference strength: 0.65 (scene images), 0.80 (portraits)
- PuLID weight: 0.75 bright scenes, 0.55 dark/interior scenes
- PuLID denoise: 0.30 bright scenes, 0.20 dark/interior scenes
- Redux: DISABLED for scene images permanently

### Approval Flow
- Face portrait and body portrait generate simultaneously (no gate)
- Approval is editorial review only, not a pipeline blocker
- Scene images can generate using any existing reference image

## Error Handling
- Do NOT add silent fallbacks or default values that mask errors
- If something fails, throw or surface the error explicitly
- Never swallow exceptions with try/catch unless the catch block re-throws or logs with full context
- Prefer failing loudly over degrading gracefully — this codebase needs to surface problems, not hide them

## General
- Dont ask me to check the Railway logs
- You have access to the Railway logs, check them yourself
