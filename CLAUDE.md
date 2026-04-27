# CLAUDE.md

## Project Overview

No Safe Word is a serialized adult romance fiction platform targeting Black South African audiences. Stories are published on two platforms simultaneously:
- **Facebook** — SFW teaser images + story text (audience growth)
- **Website** (nosafeword.co.za) — NSFW paired images + full story content (monetisation)

Tech stack: Next.js 14 monorepo, Supabase (PostgreSQL + Storage), Railway deployment, RunPod (GPU inference for Flux 2 Dev), Replicate (HunyuanImage 3.0), Anthropic Claude (prompt enhancement + image evaluation).

## Repository Structure

```
apps/web/              — Next.js app (dashboard + public site + API — ONE app for everything)
packages/image-gen/    — Image generation pipeline (Flux 2 Dev + HunyuanImage 3.0)
packages/shared/       — Types, constants, utilities
packages/story-engine/ — Supabase client, story import logic
infra/runpod/          — ComfyUI inference Docker image (serverless, Flux 2 Dev)
supabase/migrations/   — Append-only migration history (never delete these)
docs/skills/           — Prompting reference guides
scripts/               — Utility scripts (model downloads, test harnesses)
```

**There is NO `apps/dashboard` directory. It was deleted. All code lives in `apps/web`.**

## Image Generation Pipeline

**Dual-model architecture.** Every story picks one of two pipelines at import time, stored on `story_series.image_model`:

- **`flux2_dev`** — Flux 2 Dev on RunPod via ComfyUI. Character consistency via **reference-image injection**: the approved portrait on the base `characters.approved_image_id` → `images.stored_url` is base64-encoded and passed as a reference image to the generation job. **No character text is injected into the prompt** — identity lives in the pixels, and adding text descriptions of the character competes with the image reference and degrades likeness.
- **`hunyuan3`** — HunyuanImage 3.0 on Replicate. Character consistency via **prompt injection**: `characters.portrait_prompt_locked` (the exact text that produced the approved portrait). Hunyuan has no reference-image conditioning, so identity is text-only. Scene generation strips the portrait's framing/lighting and prepends a `${name}: ${stripped}` block; cover generation injects the locked text verbatim because covers ARE posed portraits and benefit from the framing language.

**Canonical character description.** After portrait approval, `characters.portrait_prompt_locked` is the canonical character description for the image-generation pipeline. The structured `characters.description` JSONB and the per-story `story_characters.prose_description` are independent of image generation — they are seed data for the initial portrait and human-readable context for the dashboard, respectively. Once a portrait is approved, the pipeline reads only `portrait_prompt_locked` (Hunyuan) or `approved_image_id` (Flux). To change a character's appearance after approval, regenerate and re-approve the portrait — there is no per-scene override.

Selection is set at import (defaults to `flux2_dev`) and switchable via `POST /api/stories/[seriesId]/change-image-model`. **Switching does NOT reset portraits** — they live on the base `characters` table and serve both pipelines. Switching only resets in-flight scene prompts for that series.

**Dispatcher:** `POST /api/stories/[seriesId]/generate-image` reads `image_model` and routes to `runFlux2Generation()` or `runHunyuanGeneration()`.

### Cover generation follows the story's image_model

**Cover generation uses the same model as the story's scenes.** `POST /api/stories/[seriesId]/generate-cover` reads `story_series.image_model` and dispatches to either the Flux 2 Dev path (PuLID reference images, no character text) or the Hunyuan 3 path (verbatim `portrait_prompt_locked` injection). The Hunyuan cover path differs from the Hunyuan scene path in one detail: covers keep the locked text verbatim (including portrait composition language), because a cover IS a posed portrait. Scenes strip the portrait composition before injection so it doesn't fight the scene's own framing.

### Legacy LoRA / Juggernaut Ragnarok pipelines — DELETED (2026-04-24)

The Juggernaut Ragnarok (V4) and character-LoRA training pipelines were removed:

- No character LoRAs are trained. No Kohya pods. No dataset generation or approval.
- `character_loras`, `lora_dataset_images`, `nsw_lora_*` tables dropped.
- `story_characters` no longer carries `active_lora_id` / `approved_*` / `face_url`; identity lives on base `characters`.
- `/api/stories/[seriesId]/generate-images-v4/`, `/admin/lora-studio/*`, `/api/stories/characters/*/train-lora`, `/api/stories/characters/*/dataset-*` are all gone.
- The `story_series.image_engine` column still exists but is unused; do not read it in new code.

Never reintroduce a "use LoRAs" branch without first re-introducing the tables and training infra. The design now assumes one approved portrait per character identity, used as reference image (Flux 2) or locked text (Hunyuan).

## Character Model (reusable across stories)

Identity and approved portraits are **canonical on the base `characters` table**. One row per unique identity; multiple `story_characters` rows (one per story) link to it via `character_id`.

- `characters.id / name / description` — identity and structured JSON description.
- `characters.approved_image_id` / `approved_fullbody_image_id` — FK to `images`. Set on portrait approval; used as reference image for Flux 2 scene generation.
- `characters.portrait_prompt_locked` — exact prompt text behind the approved portrait. Under Hunyuan 3, scene generation strips the portrait framing/lighting and prepends `${name}: ${stripped}`; cover generation uses it verbatim. Under Flux 2 Dev, this column is unused (identity flows via the reference image).
- `characters.approved_seed / approved_prompt / approved_fullbody_*` — provenance metadata.

**`story_characters` is now just a link table:** `id`, `series_id`, `character_id`, `role`, `prose_description`. Portrait state is NOT duplicated per series.

**Import dedupes by name.** `upsertCharacter()` in [packages/story-engine/src/story-import.ts](packages/story-engine/src/story-import.ts) looks up existing characters by `name`; re-importing "Lindiwe" across multiple stories links all series to the same base row. Her approved portrait is inherited automatically.

## Character Approval

Stage 8 of the publishing pipeline. The dashboard character cards drive:

1. Generate portrait → preview → approve (stage = "face"). Writes to `characters.approved_image_id`, `portrait_prompt_locked`, `approved_seed`, `approved_prompt`.
2. Generate full body → preview → approve (stage = "body"). Writes to `characters.approved_fullbody_*`.
3. Once every character linked to the series has both `approved_image_id` and `approved_fullbody_image_id` set on the base row, series status advances to `images_pending`.

Routes:
- `POST /api/stories/characters/[storyCharId]/generate` — generate portrait or fullbody. Branches on `image_model` (flux2_dev async via RunPod; hunyuan3 synchronous via Replicate).
- `POST /api/stories/characters/[storyCharId]/approve` — promote an image to the base character row.
- `POST /api/stories/characters/[storyCharId]/reset-portrait` — clear approved fields on the base row; `resetFace: true` clears portrait + body, `false` clears only body.

**Changing the image model does NOT wipe portraits.** Because the approved image + locked prompt both exist, switching from flux2_dev to hunyuan3 (or vice versa) works without re-approval. `change-image-model` only resets in-flight scene prompts.

## Scene Image Generation

`POST /api/stories/[seriesId]/generate-image` with `{ promptId }`:

1. Read the `story_image_prompts` row + linked character IDs.
2. Resolve `characters.portrait_prompt_locked` (hunyuan) or `characters.approved_image_id → images.stored_url` (flux2) for the primary + secondary characters.
3. Block generation with a clear error if a referenced character has no approved portrait.
4. Dispatch to `generateHunyuanImage()` or `generateFlux2Image()`.
5. Upload result to Supabase Storage, link image to prompt, status → `generated`.

Flux 2 jobs are async — the client polls `/api/status/[jobId]` until the image is uploaded.

## Scene Image Prompt Rules

### Self-Contained Prompts (Critical)

Every image prompt must be fully self-contained. Each image is generated independently with NO memory of previous images.

**NEVER use:** "Same scene...", "Same lighting...", "But now...", "This time...", "More intimate version of..."

**ALWAYS re-describe:** Full setting, lighting source, atmosphere, character positioning, camera angle.

### SFW/NSFW Paired Prompts

- SFW (Facebook): Use the "moment before" technique — anticipation, tension, explicit clothing description
- NSFW (Website): Same setting independently described, intimate action
- Achieve visual continuity by describing the same setting details, not by saying "same"

### Image Categories

The import schema uses these three arrays on each post (see `PostImagesImport` in `packages/shared/src/story-types.ts`):

- `facebook_sfw` — SFW images shown on Facebook (and the website)
- `website_nsfw_paired` — NSFW companion to a specific facebook_sfw image (linked via `pairs_with_facebook`)
- `website_only` — extra website-only images, positioned by `position_after_word` in the story text

### Character Linking in Scenes

- Maximum 2 linked characters per image prompt. Use `character_name` + `secondary_character_name`.
- Non-character people (background figures, unnamed extras) go inline in the prompt text. The pipeline has no identity data for them.
- **No physical descriptions for linked characters** — their identity flows from the reference image (Flux 2) or locked prompt (Hunyuan).

### Composition Preferences

- Prefer medium shots or 3/4 shots (mid-thigh up) over full-body
- Full-body only for establishing or environmental context shots
- Specify exact body position: what the torso does, where arms/hands are, furniture contact

### South African Cultural Grounding

Settings must be specific: Middelburg, Soweto, Sandton — not generic "African". Include local details: shweshwe fabric, Amarula bottle, township bedroom, mechanic workshop.

## HunyuanImage 3.0 — Known-Working Composition Patterns

The Hunyuan path through `assembleHunyuanPrompt` produces reliable explicit
imagery only when scene prompts use specific compositional patterns. This was
established by structured testing in April 2026. The prompt rewriter
(`packages/image-gen/src/prompt-rewriter.ts`) targets these patterns and
should be updated whenever new patterns are validated or existing patterns
fail.

### Reliable patterns (use these)

**Pattern A — Female-from-behind, male anonymous.**
Female subject fully visible from behind. Male figure represented only by hands
at her hips and male anatomy entering from the camera direction. Critical
prompt rule: male hands must be described as "coming from the same direction
as the camera" — not "hands at her hips." Lifting/restating this rule reliably
produces correct hand placement.

**Pattern B — Side profile, male cropped.**
Camera at 90° to the scene. Female subject's face visible in profile with
expression. Torso visible from the side. Male figure cropped entirely out of
frame except for the anatomical connection entering from the left frame edge.
Specify "left edge of frame" for the male element and "right side of frame"
for the female face.

**Pattern C — Kissing close-up, both faces visible.**
Both characters' faces visible. Requires explicit lip-contact language: "lips
pressed firmly together in contact, mouths closed and sealed." Without this
language the model produces faces approaching but not touching.

**Pattern D — Oral, no hands, low upward angle.**
Face-only female subject, male anatomy from low angle. Do NOT specify hand
placement — adding hands causes the model to position them from the sides
rather than from the camera axis. The "no hands" variant of this pattern is
the only reliable form.

### Unreliable patterns (do not use)

**Reversed gender (male visible, female anonymous).**
The gender-flipped version of Pattern A produces consistently poor output.
Abandoned.

**True top-down first-person oral.**
Steep overhead first-person perspective produces anatomical distortion
regardless of how it's prompted. The model defaults to a low upward angle or
fails at the geometry. Use Pattern D instead.

**Fully visible two-character explicit (both bodies fully in frame, both
genders rendered, anatomical connection visible).**
This is the pattern HunyuanImage 3.0 cannot reliably render. The two-pipeline
strategy (Hunyuan + Pony specialist) was considered and deferred. For now,
explicit scenes use Patterns A–D and avoid this composition entirely.

### Universal prompt rules for Hunyuan explicit scenes

- Female character's full physical description must appear inline in every
  prompt. HunyuanImage has no reference-image conditioning.
- Every prompt must be fully self-contained — full setting, lighting, and
  positioning re-described each time.
- Male figure must be explicitly described as "cropped out of frame /
  off-frame" when using Pattern B — not just absent or unmentioned.
- Male anatomy and hands must enter from "the same direction as the camera"
  for Pattern A — stated explicitly.

### When to update this section

- A new composition pattern proves reliable across at least 5 generations on
  3 different seeds — add it as a lettered pattern above.
- A pattern that was reliable starts failing — flag it in the unreliable
  section with the date and what changed.
- HunyuanImage 3.0 is replaced or upgraded — re-test and revise.

## Prompt Enhancement

Scene prompts route through Claude before generation (`prompt-enhancer.ts`). The enhancer converts Five Layers Framework descriptions into final generation prompts:
- Layer 1: Expression & Gaze
- Layer 2: Narrative Moment (specific action/pose)
- Layer 3: Lighting (named source, never generic)
- Layer 4: Composition (shot type, angle)
- Layer 5: South African Setting (specific location + props)

Enhancement via `claude-haiku-4-5-20251001`.

## Database

Key tables: `story_series`, `story_posts`, `story_characters`, `story_image_prompts`, `images`, `characters`.

- `characters` — base-roster identity. Holds `approved_image_id`, `approved_fullbody_image_id`, `portrait_prompt_locked`, seed/prompt provenance. Reused across every story that features the character.
- `story_characters` — per-series link to a base character. Columns: `id`, `series_id`, `character_id`, `role`, `prose_description`. Unique `(series_id, character_id)`.
- `story_series.image_model` — authoritative generation model: `flux2_dev` (Flux 2 Dev / RunPod) or `hunyuan3` (HunyuanImage 3.0 / Replicate). Default `flux2_dev`.
- `story_series.image_engine` — legacy column, unused by new code.
- `story_series.cover_status` — cover state machine: pending → generating → variants_ready → approved → compositing → complete (or failed).
- Migrations are append-only. Never delete migration files.

## Error Handling

- Do NOT add silent fallbacks or default values that mask errors
- If something fails, throw or surface the error explicitly
- Never swallow exceptions with try/catch unless the catch block re-throws or logs with full context
- Prefer failing loudly over degrading gracefully

## General

- **API keys live in `.env.local`** — RunPod, Supabase, Replicate, and Anthropic tokens are all there. Read `.env.local` first before asking the user to provide keys or do things manually. Only ask if you've already tried and failed.
- Don't ask me to check the Railway logs — you have access, check them yourself
- `apps/web` is the ONLY app. Never create files in `apps/dashboard`
- Scene image generation goes through `/api/stories/[seriesId]/generate-image` (model-aware dispatcher).
- Cover generation goes through `/api/stories/[seriesId]/generate-cover` (model-aware: dispatches on `story_series.image_model` like scene generation).
- Character generation goes through `/api/stories/characters/[storyCharId]/generate`.
- **Never download large files (models, datasets, checkpoints) to the local machine.** The local machine is for code only. All model downloads must go directly to RunPod (network volume via S3 API or in-pod downloads). All heavy processing (inference) runs on RunPod or Replicate, never locally.
