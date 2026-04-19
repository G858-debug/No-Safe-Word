# Story Publisher — Image Generation Pipeline Audit
**Date:** 2026-04-19
**Repo:** /Users/Howard/Projects/No-Safe-Word

## Current Active Pipeline

The Story Publisher runs **two coexisting generation flows** today:

1. **Art Director orchestrator (PRIMARY)** — default for all story scene images, initiated from the UI. Uses Qwen VL 2.5 72B on a RunPod GPU pod + CivitAI image search + CivitAI generation API, with iterative vision-evaluated retries.
2. **Juggernaut Ragnarok V4 (FALLBACK / LEGACY)** — still functional at `/api/stories/[seriesId]/generate-images-v4/`, but the UI no longer calls it. Reachable only via direct API call. Uses RunPod serverless + ComfyUI with character LoRAs trained via Kohya.

Character portrait generation (Stage 8) has its own dedicated route and always goes through Juggernaut Ragnarok on RunPod serverless — Art Director is not involved.

## Stage 8: Character Portrait Generation

- **UI flow:** Character approval dashboard → `CharacterCard.tsx` + `CharacterApproval.tsx` → "Generate" / "Regenerate" buttons
- **API route:** `POST /api/stories/characters/[storyCharId]/generate/`
- **Backend:** RunPod serverless (endpoint `vj6jc0gd61l9ov`) → ComfyUI → Juggernaut Ragnarok SDXL checkpoint
- **Consistency mechanism:** **One-shot portrait, no LoRA.** The character is generated once from structured description fields (gender, ethnicity, bodyType, etc.) stored on `characters.description`. Editor approves a single portrait; approved image URL is stored at `story_characters.approved_image_id → images.stored_url`. That approved URL is the reference asset passed into the Art Director for downstream scene consistency.
- **Optional request body** supports `seed`, `type` (portrait|fullBody), `stage` (face|body), `customPrompt`, `customNegativePrompt`, `loraStrengths`.

## Stage 9: Story Image Generation

### Flow A — Art Director modal (PRIMARY, user-facing)
- **UI flow:** Story Publisher dashboard → image cards → "Generate" button → `ImageGeneration.tsx:517-545` opens `ArtDirectorModal.tsx:105+`. "Generate All" queues eligible prompts sequentially through the same modal. Regenerate on an existing image opens the same modal (`ImageGeneration.tsx:554-559`).
- **API routes:** `/api/art-director/*` (6 active routes, including `/pod` for Qwen VL lifecycle).
- **Backend:** 8-step orchestration:
  1. Qwen VL analyzes prompt intent
  2. 3 query variants searched on CivitAI
  3. Multi-image vision ranking by Qwen VL
  4. User selects preferred reference in modal
  5. Qwen VL extracts generation recipe (model, prompt, sampler, CFG, steps)
  6. Generation submitted via CivitAI API
  7. Qwen VL scores result vs. intent (80-point pass threshold)
  8. Up to 4 iterations with escalating feedback; best kept
- **How character data flows in:** Art Director analyze route pulls the character's `approved_image_id → images.stored_url` and the structured `characters.description` JSON for both primary and secondary character IDs on the `story_image_prompts` row, then feeds them to Qwen VL for intent analysis and reference ranking.
- **Infrastructure:** Qwen VL pod `4312q9iygityqc` — auto-starts on first modal open via `/api/art-director/pod` (create/start/stop lifecycle). Health check: `POST /qwen-vl-health`, 8s timeout. Polling: up to 30 × 10s.
- **Persistence:** `art_director_jobs` table (migration 032) stores full orchestration state.

### Flow B — V4 batch (LEGACY, direct-API only)
- **UI flow:** None active. The old batch button code is commented out at `ImageGeneration.tsx:487-551`.
- **API route:** `POST /api/stories/[seriesId]/generate-images-v4/` — still functional.
- **Backend:** `generate-scene-image-v4.ts` (builds payload) → `workflow-builder.ts` (Juggernaut Ragnarok ComfyUI graph) → RunPod serverless. Prose is converted to Booru tags via Claude. Character LoRAs (status=`deployed`) are fetched and stacked into the workflow (max 8 LoRAs; default character weights model 0.8 / clip 0.8, adjustable on retries). Trigger words are indexed by character position.
- **How character data flows in:** `generate-scene-image-v4.ts:153-188` loads deployed LoRAs for each character referenced in the prompt. Lines 281-296 **throw** if any character lacks a deployed LoRA — so this flow is hard-blocked unless every character on the prompt is fully trained.
- **Client polling:** `/api/status/{jobId}`.

## Database Schema (Image-Related)

### `story_image_prompts`
`id`, `post_id`, `image_type` (facebook_sfw | website_nsfw_paired | website_only), `pairs_with` (self-FK), `position`, `position_after_word`, `character_name`, `character_id`, `secondary_character_name` (migration 006), `secondary_character_id`, `prompt`, `image_id`, `previous_image_id` (migration 031 — revert support), `status` (pending | generating | generated | approved | failed)

### `images`
`id`, `character_id` (null for scene images), `prompt`, `negative_prompt`, `settings` (JSONB: width/height/engine/seed/...), `mode` (sfw | nsfw), `sfw_url` (legacy), `nsfw_url` (legacy), `stored_url` (primary), `created_at`

### `character_loras`
`id`, `character_id`, `filename`, `storage_path`, `storage_url`, `trigger_word`, `base_model` ('sdxl'), `training_provider`, `training_id`, `dataset_size`, `validation_score`, `status` (pending | generating_dataset | evaluating | captioning | training | validating | deployed | failed), `created_at`, `updated_at`, `deployed_at`

### `lora_dataset_images`
`id`, `lora_id`, `image_url`, `storage_path`, `prompt_template`, `variation_type` (angle | expression | lighting | clothing | framing), `category` (face-closeup | head-shoulders | waist-up | full-body | body-detail), `eval_status` (pending | passed | failed | replaced), `eval_score`, `eval_details` (JSONB), `caption`, `created_at`

### `art_director_jobs`
`id`, `prompt_id` (FK story_image_prompts), `series_id`, `status` (analyzing | awaiting_selection | generating | completed | failed | cancelled), `intent_analysis` (JSONB), `reference_images` (JSONB), `selected_reference_id` (CivitAI image ID), `adapted_recipe` (JSONB), `iterations` (JSONB array), `current_iteration`, `best_iteration`, `best_score`, `final_image_url`, `final_image_id`, `error`, `created_at`, `updated_at`

## Active Environment Variables

```
CIVITAI_API_KEY=...                 # CivitAI search + generation (Art Director)
RUNPOD_API_KEY=...                  # RunPod control plane (serverless + pods)
RUNPOD_ENDPOINT_ID=vj6jc0gd61l9ov   # Juggernaut Ragnarok serverless endpoint
RUNPOD_NETWORK_VOLUME_ID=0ibg3mpboj # Shared model volume (/runpod-volume/models/)
QWEN_VL_POD_ID=4312q9iygityqc       # Qwen VL 2.5 72B pod for Art Director
ANTHROPIC_API_KEY=...               # Claude (prompt enhancement, prose→Booru)
REPLICATE_API_TOKEN=...              # Present but UNUSED by active code paths
ENABLE_LORA_TRAINING=true
ENABLE_CONTROLNET=true              # DWPose ControlNet in ComfyUI graph
```

## Infrastructure References

### RunPod
- **Inference (serverless):** endpoint `vj6jc0gd61l9ov`. Base image `ghcr.io/g858-debug/nsw-comfyui-base:latest`. Thin app layer. Custom ComfyUI nodes: `nsw_refresh_models`, `nsw_region_masks`. Checkpoint: `Juggernaut-Ragnarok.safetensors` (`packages/image-gen/src/workflow-builder.ts:12`).
- **Training (pods):** Kohya image `ghcr.io/g858-debug/nsw-kohya-trainer:v5-ragnarok`. Managed via `packages/image-gen/src/runpod-pods.ts` (distinct from serverless client at `packages/image-gen/src/runpod.ts`). Webhook-based completion notification.
- **Art Director (pods):** Qwen VL 2.5 72B on pod `4312q9iygityqc`. Auto-start via `/api/art-director/pod`.

### Clients
- `packages/image-gen/src/runpod.ts` — serverless
- `packages/image-gen/src/runpod-pods.ts` — pods
- Do **not** mix the two.

## Dead / Commented Code

- **OLD V4 batch UI handler** — `apps/web/.../ImageGeneration.tsx:487-551` (`handleBatchGenerate_OLD`). The underlying API route still works; only the UI wiring is commented out.
- **Experimental model scripts** (not wired into the app):
  - `scripts/test-flux-2-dev.ts`
  - `scripts/test-flux-2-pro.ts`
  - `scripts/test-flux2-controlnet.ts`
  - `scripts/test-hunyuan-image-3.ts`
  - `scripts/test-hunyuan-styled.ts`
  Results land in untracked `flux2_results/`, `flux2_dev_results/`, `flux2_controlnet_results/`, `hunyuan3_results/`, `hunyuan_consistency/` (all currently dirty in git status).
- **Replicate integration** — `REPLICATE_API_TOKEN` is in `.env.local` but no active code imports or calls Replicate. The only surviving references are comments in `packages/image-gen/src/character-lora/types.ts`.
- **Engine selector UI** — removed; `apps/web/app/dashboard/stories/[seriesId]/page.tsx:20` has a comment noting the removal. `story_series.image_engine` is effectively pinned to `juggernaut_ragnarok` by application code.

## Files / Migrations Referencing Obsolete Models

These migrations are append-only history, retained per CLAUDE.md but no longer honored by the application:

- `supabase/migrations/020_add_nb2_uncanny_engine.sql`
- `supabase/migrations/022_add_flux_pulid_engine.sql`
- `supabase/migrations/023_add_flux2_pro_engine.sql`
- `supabase/migrations/024_add_pony_cyberreal_engine.sql`
- `supabase/migrations/025_pony_only_cleanup.sql`

The `story_series.image_engine` CHECK constraint still technically permits these values; app code rejects anything other than `juggernaut_ragnarok`.

## Character Consistency Mechanism (Current)

**Two-tier, per-flow:**

- **Art Director flow:** Tier-1 only — approved character portrait URL + structured description passed to Qwen VL for reference ranking. No LoRA. No IP-Adapter at inference. Consistency comes from Qwen VL's ranking of CivitAI references against the approved portrait.
- **V4 legacy flow:** Tier-2 — deployed character LoRA(s) injected into the ComfyUI workflow with trigger words in the positive prompt (model 0.8 / clip 0.8 default). No IP-Adapter / face-swap post-processing. Hard-blocked if any character lacks a deployed LoRA.

## Recent Git Signal

Last 5 commits show PuLID / Flux2Fun ComfyUI patching (fff29ab, f70fb85) and an Art Director type-error fix (a236404) gating a Railway build. Art Director commits are recent and active; V4 / Juggernaut commits are older and stable — consistent with Art Director being the live path and V4 being in maintenance mode.

## Summary Table: Active vs Dead

| Component | Status | Location | Notes |
|---|---|---|---|
| Art Director orchestrator | **ACTIVE** | `/api/art-director/*`, `ArtDirectorModal.tsx` | Primary story-image UX |
| Juggernaut V4 scene route | **ACTIVE (fallback)** | `/api/stories/[seriesId]/generate-images-v4/` | No UI entry; hard-blocks on missing LoRA |
| Character portrait gen | **ACTIVE** | `/api/stories/characters/[storyCharId]/generate/` | Juggernaut, no LoRA |
| LoRA training pipeline | **ACTIVE** | `packages/image-gen/src/lora-trainer.ts` + Kohya | 8-stage, RunPod pods |
| V4 batch UI button | **DEAD (commented)** | `ImageGeneration.tsx:487-551` | Route functional, UI wired to Art Director |
| Flux 2 / Hunyuan test scripts | **EXPERIMENTAL** | `scripts/test-*` | Outputs under `flux2_*/`, `hunyuan*/` |
| Replicate | **DORMANT** | `.env.local` token only | No active callers |
| NB2 / Pony / Flux 1 engines | **DEPRECATED** | Migrations 020, 022-025 | DB allows, app rejects |
