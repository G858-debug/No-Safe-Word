# Juggernaut Ragnarok Pipeline — Pre-Flight Checklist

## Before First Run

### RunPod Infrastructure
- [ ] Download `Juggernaut-Ragnarok.safetensors` to RunPod network volume `nsw-comfyui-models` under `checkpoints/`
- [ ] Download `sd_xl_base_1.0.safetensors` to RunPod network volume (for LoRA training base)
- [ ] Download `4xNMKD-Siax_200k.pth` upscaler to RunPod network volume under `upscale_models/`
- [ ] Verify RunPod serverless endpoint is configured with the new checkpoint
- [ ] Update `RUNPOD_PONY_ENDPOINT_ID` env var to `RUNPOD_ENDPOINT_ID` (or create new endpoint)

### Docker Image
- [ ] Rebuild Kohya Docker image with updated `train_entrypoint.py` (new defaults: SDXL base, clip skip 1, network dim 32)
- [ ] Push new image to GHCR with new tag (NOT `:latest` — force fresh pull)
- [ ] Update `KOHYA_TRAINER_IMAGE` env var with new tag
- [ ] Verify GHCR personal access token has `write:packages` scope and hasn't expired

### Environment Variables
- [ ] `RUNPOD_ENDPOINT_ID` — points to endpoint with Juggernaut Ragnarok checkpoint
- [ ] `KOHYA_TRAINER_IMAGE` — points to updated Docker image tag
- [ ] `TRAINING_WEBHOOK_SECRET` — unchanged, carries forward
- [ ] `CIVITAI_API_KEY` — may be needed for model downloads

### Database
- [ ] Run migration to update `story_series.image_engine` default from `pony_cyberreal` to `juggernaut_ragnarok`
- [ ] Update existing series rows: `UPDATE story_series SET image_engine = 'juggernaut_ragnarok' WHERE image_engine = 'pony_cyberreal'`
- [ ] Archive old Pony-trained LoRAs: `UPDATE character_loras SET status = 'archived' WHERE base_model IN ('pony_cyberreal', 'CyberRealistic_PonySemi_V4.5') AND status != 'archived'`
- [ ] Clear `active_lora_id` on story characters that reference archived LoRAs so they retrain from scratch
- [ ] Image category migration (follow-up): `facebook_sfw`/`website_nsfw_paired`/`website_only` to `shared`/`progression_pairs`/`website_exclusive`

**Note on existing LoRAs:** Pony-era LoRAs (dim 8, clip skip 2, trained on ponyDiffusionV6XL) will not produce good results with Juggernaut Ragnarok. They may load without errors but will cause identity drift and artifacts. All characters need retraining from scratch with the new pipeline (dim 32, clip skip 1, trained on SDXL 1.0 base).

### Codebase
- [ ] All TypeScript compiles without import errors
- [ ] New skill docs exist in `docs/skills/`
- [ ] Old Pony skill docs deleted
- [ ] CLAUDE.md updated with Ragnarok references
- [ ] No remaining Pony references in code (run sweep)

## First Test: Character Generation
- [ ] Create a test character in the Story Publisher
- [ ] Generate character portrait with Juggernaut Ragnarok
- [ ] Verify: photorealistic output (not semi-realistic)
- [ ] Verify: skin tone renders correctly at the specified tone
- [ ] Verify: clothing appears in SFW generation (no accidental nudity)
- [ ] Verify: hair style matches description (no afro default for male characters)

## First Test: Dark Skin Rendering
- [ ] Generate portraits at: light brown, medium-brown, dark brown, deep brown skin tones
- [ ] Verify: skin is not flat or poorly lit at any tone
- [ ] Verify: facial features are distinct and detailed at all tones
- [ ] If quality is poor at specific tones: research supplementary skin rendering LoRA

## First Test: LoRA Training
- [ ] Trigger training pipeline for one test character
- [ ] Verify: RunPod pod starts successfully
- [ ] Verify: SDXL base checkpoint downloads or exists on volume
- [ ] Verify: Kohya training runs with new parameters (dim 32, clip skip 1)
- [ ] Verify: trained LoRA uploads to Supabase Storage
- [ ] Verify: webhook fires and completeTrainingPipeline() runs
- [ ] Verify: validation images generate using the trained LoRA

## First Test: Scene Generation
- [ ] Generate a SFW scene with an approved character LoRA
- [ ] Verify: character identity is consistent with approved portrait
- [ ] Verify: clothing is present and matches prompt
- [ ] Verify: scene composition matches prompt description
- [ ] Generate a two-character scene
- [ ] Verify: both characters appear, neither is dropped
- [ ] Verify: spatial composition is reasonable

## First Test: NSFW Generation
- [ ] Generate an NSFW scene with an approved character LoRA
- [ ] Verify: anatomical coherence
- [ ] Verify: character identity maintained
- [ ] Verify: scene matches prompt description

## Quality Comparison
- [ ] Generate the SAME scene prompt with both Juggernaut Ragnarok and CyberRealistic Pony (if still available)
- [ ] Compare: photorealism, skin rendering, facial detail, clothing accuracy
- [ ] Document any areas where Ragnarok underperforms — these may need supplementary LoRAs or prompt adjustments

## Follow-Up Tasks
- [ ] Implement second-pass training dataset generation
- [ ] Migrate image categories from `facebook_sfw`/`website_nsfw_paired`/`website_only` to `shared`/`progression_pairs`/`website_exclusive`
- [ ] ComfyUI inpainting workflow validation on RunPod (test with real images)
- [ ] ComfyUI img2img workflow validation
- [ ] ComfyUI upscale workflow validation
