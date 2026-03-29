# CLAUDE.md

## Flux Image Prompting Skill
**MANDATORY:** Before writing or reviewing any image prompt, read `skill.md` in the project root. It contains the complete Flux prompting guide — T5 encoder rules, the Five Layers framework, prompt structure templates, platform-specific rules, and the quality checklist.

## Image Generation Best Practices

### Character Consistency Rules
1. **Approved characters** have three generation stages (face, body, and LoRA can run in parallel — no sequential gate):
   a. **Face** — generated via RealVisXL + Melanin LoRA.
      Face portrait prompts (PATH A): contain ONLY face-relevant fields — age, ethnicity,
      skin tone, hair, eyes, distinguishing features. Body type and beauty descriptors are
      explicitly excluded to prevent exposed chest rendering. Negative prompt always blocks
      nudity (nude, naked, topless, bare breasts, exposed chest, nsfw, cleavage).
   b. **Body** — generated via RealVisXL + Curvy Body LoRA + Feminine Body Proportions LoRA.
      Body shot prompts (PATH B): include body type descriptors but always include explicit
      clothing language (varied per prompt variant — mini skirt + crop top, bodycon dress,
      jeans + tank top, wrap dress, leggings + crop top, camisole + shorts) and a
      nudity-blocking negative prompt. The goal is visible body proportions through
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
     using approved portrait as reference (1:1 aspect ratio)
   - Body shots (female): BigASP (`bigasp_v20.safetensors`) + Feminine Body
     Proportions LoRA (0.80) + Curvy Body LoRA (0.70) via ComfyUI on RunPod
     → Flux Kontext img2img conversion (denoise: 0.55) for photorealistic output.
     6 prompt variants cycle pose, clothing, and background evenly. hairStyle
     and hairColor from character data are injected into every prompt.
   - Body shots (male): Nano Banana 2 (Replicate) with 3:4 portrait aspect
     ratio. 6 prompt variants cycle pose, clothing, and background evenly.

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

**Pipeline Parity Rule:** Portrait generation (approval UI) and dataset generation
(LoRA training) MUST use identical model stacks for both male and female characters.
Female body images share a single config module
(`packages/image-gen/src/female-body-pipeline.ts`). Changes to checkpoints, LoRAs,
strengths, or denoise values MUST be made in this module only — never duplicate
these values in generate-character-image.ts or dataset-generator.ts.

**Character Approval (face + body):**
- Face generation: Nano Banana 2 (Replicate) for both male and female
- Body generation (female): Two-step pipeline via ComfyUI on RunPod:
  - Step 1: BigASP v2.0 (`bigasp_v20.safetensors`) + Curvy Body LoRA
    (`curvy-body-sdxl.safetensors`, strength: 0.70) + Melanin LoRA stack
    (for Black/African characters)
  - Step 2: Flux Kontext img2img conversion (`flux1KreaDev_fp8E4m3fn.safetensors`)
    with Realism LoRA (0.8) + Add Details LoRA (0.6), denoise: 0.85
  - The status polling endpoint orchestrates both steps transparently —
    when Step 1 completes, it submits Step 2 and keeps the frontend polling
- Body generation (male): Nano Banana 2 (Replicate) with face reference
- SDXL supports negative prompts — use them to prevent nudity, european/asian features and poor anatomy
- Trigger words MUST appear at the start of the positive prompt

All female body generation config (checkpoints, LoRAs, prompt builders) lives in:
`packages/image-gen/src/female-body-pipeline.ts`

The portrait route (`generate-character-image.ts`) and the dataset generator
(`dataset-generator.ts`) both import from this shared module. Changes to the
pipeline — new LoRAs, prompt fixes, denoise values — must be made ONLY in
`female-body-pipeline.ts`.

Both the /generate route (first-time generation) and the /regenerate route
(user-triggered redo with optional fixed seed) call `buildCharacterGenerationPayload()`
in `generate-character-image.ts`. The routes are thin wrappers that handle HTTP,
database reads/writes, and RunPod submission only.

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
   RealVisXL + `curvy-body-sdxl.safetensors` + `feminine-body-proportions-sdxl.safetensors` instead).
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
Feminine Body Proportions LoRA at strength 0.80 + Curvy Body LoRA
at strength 0.70 must be active during dataset generation.

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

## Pony V6 Character LoRA Training Skill

A comprehensive character LoRA training guide for the V4 (`pony_cyberreal`) pipeline is available
at `docs/skills/pony-lora-training/SKILL.md`.

**Always read this skill before:**
- Generating character training dataset images (the initial 40-60 candidates)
- Writing or reviewing code that curates, evaluates, or scores training images
- Writing or reviewing captioning/tagging logic for training datasets
- Configuring or modifying LoRA training parameters
- Evaluating trained LoRA quality or debugging consistency issues
- Modifying training-related code in `packages/image-gen/src/pony-character-lora/`

**Existing files:**
- `packages/image-gen/src/pony-character-lora/training-image-evaluator.ts` — dataset curation scoring and selection
- `packages/image-gen/src/pony-character-lora/training-caption-builder.ts` — booru tag caption preparation with identity tag stripping

**Planned files (not yet created):**
- `pony-lora-trainer.ts` — Kohya SS / Replicate training integration
- `pony-lora-registry.ts` — Pony LoRA checkpoint and inference config registry

**Key principles (quick reference):**
- 15-20 curated training images, not 50 mediocre ones — quality over quantity
- Training images MUST cover multiple angles, framings, expressions, lighting, and clothing states
- Remove ALL identity tags (hair, skin, eyes, body, ethnicity) from captions — the trigger word carries identity
- Network dim 8 for characters, noise offset 0.03 for sharp facial details
- Save every epoch, sample every epoch — earlier epochs are often more flexible than later ones
- Train on the SAME checkpoint you'll use for inference (CyberRealistic Pony v17)
- Test the trained LoRA WITHOUT identity tags to verify the character is baked into the trigger word
- SFW and NSFW images both needed in training set for dual-capability output
- Pony V6 LoRAs are SDXL-architecture — must ONLY be used with SDXL/Pony inference, never with Flux

## Pony V6 / CyberRealistic Scene Generation Skill

A comprehensive scene image generation guide for the V4 (`pony_cyberreal`) pipeline is available
at `docs/skills/pony-scene-generation/SKILL.md`.

**Always read this skill before:**
- Writing or enhancing ANY scene image prompt for the pony_cyberreal engine
- Modifying the prompt builder, prompt enhancer, or negative prompt logic
- Writing SFW/NSFW paired prompts (the Facebook → Website visual continuity)
- Constructing dual-character intimate scene prompts
- Debugging image quality: flat lighting, wrong proportions, uncanny faces, dark images
- Adding body proportion, clothing, or pose tags to prompts

**Key principles (quick reference):**
- Tag order matters — quality tags first, then rating, then characters, then scene
- Body proportion emphasis order: ass/hips/thighs FIRST, then breasts (matches brand)
- SFW images use the "moment before" technique — anticipation, not nudity
- NSFW images must specify anatomical positioning explicitly for accuracy
- SFW/NSFW paired prompts rebuild the SAME setting independently (no "same scene" references)
- Name specific light sources — never use generic "warm lighting"
- CyberRealistic Pony: omit source tags or use source_anime lightly; add source_pony to NEGATIVE
- CyberRealistic Pony: VAE is baked in — never load external VAE
- Dual-character scenes: landscape orientation, both LoRAs at 0.65-0.75, tight AttentionCouplePPM regions
- South African settings must be specific (Middelburg, Soweto, Sandton) not generic "African"

## Error Handling
- Do NOT add silent fallbacks or default values that mask errors
- If something fails, throw or surface the error explicitly
- Never swallow exceptions with try/catch unless the catch block re-throws or logs with full context
- Prefer failing loudly over degrading gracefully — this codebase needs to surface problems, not hide them

## General
- Dont ask me to check the Railway logs
- You have access to the Railway logs, check them yourself
