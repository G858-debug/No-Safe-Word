# CLAUDE.md

## Project Overview

No Safe Word is a serialized adult romance fiction platform targeting Black South African audiences. Stories are published on two platforms simultaneously:
- **Facebook** — SFW teaser images + story text (audience growth)
- **Website** (nosafeword.co.za) — NSFW paired images + full story content (monetisation)

Tech stack: Next.js 14 monorepo, Supabase (PostgreSQL + Storage), Railway deployment, RunPod (GPU inference + training), Anthropic Claude (prompt enhancement + image evaluation).

## Repository Structure

```
apps/web/              — Next.js app (dashboard + public site + API — ONE app for everything)
packages/image-gen/    — Image generation pipeline (Juggernaut Ragnarok)
packages/shared/       — Types, constants, utilities
packages/story-engine/ — Supabase client, story import logic
infra/runpod/          — ComfyUI inference Docker image (serverless)
infra/kohya-trainer/   — Kohya LoRA training Docker image (pods)
supabase/migrations/   — Append-only migration history (never delete these)
docs/skills/           — Prompting, training, and editing reference guides
scripts/               — Utility scripts (model downloads, LoRA uploads, data management)
```

**There is NO `apps/dashboard` directory. It was deleted. All code lives in `apps/web`.**

## Image Generation Pipeline

**There is ONE image pipeline: Juggernaut Ragnarok (`juggernaut_ragnarok`).**
No engine switching, no engine selector, no conditional paths.

- **Checkpoint:** Juggernaut XL Ragnarok (SDXL architecture, photorealistic)
- **Compute:** RunPod serverless → ComfyUI → character LoRAs → FaceDetailer
- **Defaults:** DPM++ 2M SDE Karras, 30 steps, CFG 3-5, Clip Skip 1
- **Resolutions:** 832×1216 (portrait), 1216×832 (landscape), 1024×1024 (square)

Key files:
- `packages/image-gen/src/pony-workflow-builder.ts` — ComfyUI workflow construction
- `packages/image-gen/src/pony-prompt-builder.ts` — Booru tag assembly
- `packages/image-gen/src/pony-lora-registry.ts` — Style LoRA catalog
- `apps/web/lib/server/generate-scene-image-v4.ts` — Scene generation orchestration
- `apps/web/lib/server/pony-character-image.ts` — Character portrait/body generation

## Juggernaut Ragnarok Prompting Rules

**Read `docs/skills/juggernaut-ragnarok/SKILL.md` before writing ANY image prompt.**

### Format: Natural Language + Booru Tags

Juggernaut Ragnarok supports BOTH natural language prompts AND Booru-style tags. Use natural language for SFW scenes and Booru tags for NSFW anatomical detail.

### Quality Tags

For maximum photorealism, prepend to positive prompt:
```
masterpiece, 4k, ray tracing, intricate details, highly-detailed, hyper-realistic, 8k RAW Editorial Photo
```

For clean photographic look (simpler, often better):
```
photograph, high resolution, cinematic, skin textures
```

Do NOT use Pony-specific tags (`score_9`, `score_8_up`, `score_7_up`, `rating_safe`, `rating_explicit`, `source_pony`). These are meaningless to Juggernaut Ragnarok.

### SFW/NSFW Control

Juggernaut Ragnarok has NSFW baked into training. Control content through prompts:

**SFW (Facebook):** Always describe clothing explicitly. Add to negative prompt: `nudity, naked, nsfw, topless, nude`

**NSFW (Website):** Use Booru-style tags for anatomical precision. No special rating tag needed — the model generates NSFW content when prompted.

### Prompt Component Order (earlier = more weight)

```
[subject], [action/pose], [clothing — REQUIRED for SFW],
[expression/gaze], [setting], [props],
[lighting source], [atmosphere], [composition],
[quality boosters — optional]
```

### Negative Prompts

**SFW standard:**
```
nudity, naked, nsfw, topless, nude, bad anatomy, bad hands, extra limbs, watermark, blurry, text, cartoon, illustration, painting, low quality, worst quality, deformed
```

**NSFW standard:**
```
bad anatomy, bad hands, extra limbs, watermark, blurry, text, cartoon, illustration, painting, low quality, worst quality, deformed
```

### What NOT to Do

- **No Pony quality/rating tags** — `score_9`, `rating_safe`, `source_pony` etc. are Pony-specific
- **No emphasis weights** — `(word:1.3)` syntax is not reliably supported in SDXL CLIP
- **No missing clothing in SFW** — The model defaults toward nudity. Always describe clothing.
- **No CFG above 7** — Causes waxy skin and oversaturation
- **No prompts over 75 tokens** — Content is truncated beyond CLIP limit
- **No physical descriptions for approved characters** — Identity comes from the LoRA trigger word

## Character LoRA System

Characters get SDXL identity LoRAs trained with Kohya sd-scripts on RunPod GPU pods. Read `docs/skills/sdxl-character-lora-training/SKILL.md` for the full two-pass training architecture.

### Training Pipeline (8 stages)

1. **Dataset generation** — 40-60 images (10-12 face, 6-8 head-shoulders, 6-8 waist-up, 8-10 full-body) via RunPod serverless with Juggernaut Ragnarok checkpoint
2. **Claude Vision evaluation** — Auto-scores each image for face/skin/body/quality consistency
3. **Curation** — `selectTrainingSet()` curates to best 30-50 meeting diversity requirements
4. **Human approval** — Pipeline pauses; user reviews in dashboard
5. **Captioning** — Natural language captions with identity tag stripping via `buildTrainingCaption()`
6. **Packaging** — Images + captions → tar.gz → Supabase Storage
7. **Training** — Kohya `sdxl_train_network.py` on RunPod GPU pod against SDXL 1.0 base (30-60 min)
8. **Validation** — 6 test images scored by Claude Vision against reference portrait

Training runs on RunPod **PODS** (batch jobs), NOT serverless. The orchestrator creates the pod and returns — a webhook handles completion.

### Training Parameters

- Network dim: 32, alpha: 16
- Optimizer: Prodigy, LR: 1.0
- Scheduler: cosine_with_restarts
- Noise offset: 0.03
- Resolution: 1024, Clip skip: 1
- Epochs: 10-15, Save every 2 epochs, Batch size: 2
- Trigger word format: `{firstname}_nsw` (e.g., `lindiwe_nsw`)

### Key Files

- `packages/image-gen/src/lora-trainer.ts` — Pipeline orchestrator
- `packages/image-gen/src/dataset-generator.ts` — Training image generation
- `packages/image-gen/src/character-lora-validator.ts` — Post-training validation
- `packages/image-gen/src/character-lora/training-image-evaluator.ts` — Dataset curation
- `packages/image-gen/src/character-lora/training-caption-builder.ts` — Caption generation

### RunPod Interfaces

Two separate clients — do not mix them up:
- `packages/image-gen/src/runpod.ts` — **Serverless** endpoint API (inference jobs)
- `packages/image-gen/src/runpod-pods.ts` — **Pod** API (batch training jobs)

## Character Consistency Rules

1. **Approved characters** get identity from their trained LoRA trigger word. Scene prompts include ONLY: action, pose, clothing, setting, lighting, composition, expression. **Never include physical descriptions** (skin tone, hair, build) for approved characters.

2. **Non-character people** (background figures, unnamed extras): Describe inline with brief physical details — the pipeline has no LoRA data for them. Example: `older woman in floral dress in background`

3. **Multi-character scenes:** Maximum 2 linked characters per image prompt. Use `character_name` + `secondary_character_name`. Additional characters must be described inline.

4. **Character LoRA injection:** Deployed LoRA filename is fetched from `character_loras` table (status = 'deployed') and injected into the ComfyUI workflow. If a character has no deployed LoRA, scene generation throws.

## Scene Image Prompt Rules

### Self-Contained Prompts (Critical)

Every image prompt must be fully self-contained. Each image is generated independently with NO memory of previous images.

**NEVER use:** "Same scene...", "Same lighting...", "But now...", "This time...", "More intimate version of..."

**ALWAYS re-describe:** Full setting, lighting source, atmosphere, character positioning, camera angle.

### SFW/NSFW Paired Prompts

- SFW (Facebook): Use the "moment before" technique — anticipation, tension, explicit clothing description
- NSFW (Website): Same setting independently described, intimate action, Booru tags for anatomical precision
- Achieve visual continuity by describing the same setting details, not by saying "same"

### Image Categories

- `shared` — images identical on both Facebook and website
- `progression_pairs` — SFW + intimate versions, only where scenes build toward intimacy
- `website_exclusive` — additional images for website reading experience

### Composition Preferences

- Prefer medium shots or 3/4 shots (mid-thigh up) over full-body
- Full-body only for establishing or environmental context shots
- Specify exact body position: what the torso does, where arms/hands are, furniture contact

### South African Cultural Grounding

Settings must be specific: Middelburg, Soweto, Sandton — not generic "African". Include local details: shweshwe fabric, Amarula bottle, township bedroom, mechanic workshop.

## LoRA Training Standards

**Read `docs/skills/sdxl-character-lora-training/SKILL.md` before modifying any training code.**

### Body Shape Requirements (Female Characters)

All female characters: very large natural breasts, very wide hips, very large round ass, narrow defined waist, soft stomach, full thighs. Visible and consistent across ALL training images.

### Dataset Diversity

Training datasets must include varied backgrounds:
- Indoor day (restaurant, cafe, office, home)
- Indoor night (bedroom, lounge, artificial light)
- Outdoor day (street, township, park)
- Outdoor golden hour (sunset, warm light)
- Close-up/detail shots (face only, waist up)

Minimum 20% per category. Plain/neutral backgrounds must not exceed 20%.

### Caption Format

Trigger word first, then natural language description of the scene. Identity tags (hair, skin, body, ethnicity) are STRIPPED — the trigger word carries these.

```
lindiwe_nsw, a young woman smiling, fitted blazer and tailored trousers, warm expression looking at camera, modern office interior, soft window light
```

## Prompt Enhancement

All scene prompts route through Claude before generation (`prompt-enhancer.ts`). The enhancer converts Five Layers Framework descriptions into Juggernaut Ragnarok prompts:
- Layer 1: Expression & Gaze
- Layer 2: Narrative Moment (specific action/pose)
- Layer 3: Lighting (named source, never generic)
- Layer 4: Composition (shot type, angle)
- Layer 5: South African Setting (specific location + props)

Output format:
- **SFW scenes:** Natural language prompt with explicit clothing descriptions + SFW negative prompt
- **NSFW scenes:** Natural language scene description + Booru tags for anatomical precision + NSFW negative prompt

Enhancement via `claude-haiku-4-5-20251001`.

## Database

Key tables: `story_series`, `story_posts`, `story_characters`, `story_image_prompts`, `images`, `character_loras`, `lora_dataset_images`

- `story_series.image_engine` — always `juggernaut_ragnarok`
- `character_loras.status` — pipeline stages: pending → generating_dataset → evaluating → awaiting_dataset_approval → captioning → training → validating → deployed
- Migrations are append-only. Never delete migration files.

## Error Handling

- Do NOT add silent fallbacks or default values that mask errors
- If something fails, throw or surface the error explicitly
- Never swallow exceptions with try/catch unless the catch block re-throws or logs with full context
- Prefer failing loudly over degrading gracefully

## General

- Don't ask me to check the Railway logs — you have access, check them yourself
- `apps/web` is the ONLY app. Never create files in `apps/dashboard`
- All image generation goes through `/api/stories/[seriesId]/generate-images-v4/`
- Character generation goes through `/api/stories/characters/[storyCharId]/generate`
