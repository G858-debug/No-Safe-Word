-- Canonicalize character portraits on the base `characters` table and drop
-- the LoRA pipeline entirely.
--
-- Why: scene image generation is now driven by Flux 2 Dev (reference image)
-- and HunyuanImage 3.0 (locked portrait prompt). Neither uses trained LoRAs.
-- Portraits should be approved once per character and reused across every
-- story that features them — not re-approved per story_characters row.
--
-- Preconditions: story_characters, character_loras, and lora_dataset_images
-- are all empty at the time this migration is applied (full content wipe
-- performed 2026-04-24). `characters` holds 10 rows with description JSONB.
-- Any new portrait fields on `characters` start null and are populated via
-- the approve route going forward.

BEGIN;

-- 1. Add canonical portrait fields to base `characters`.
--    Identity, description, approved face/body + their metadata all live here.
ALTER TABLE characters
  ADD COLUMN approved_image_id          uuid REFERENCES images(id),
  ADD COLUMN approved_fullbody_image_id uuid REFERENCES images(id),
  ADD COLUMN approved_seed              integer,
  ADD COLUMN approved_fullbody_seed     integer,
  ADD COLUMN approved_prompt            text,
  ADD COLUMN approved_fullbody_prompt   text,
  -- Injected verbatim into scene prompts under hunyuan3. Set at portrait
  -- approval time; serves both pipelines (Flux 2 uses image ref, Hunyuan
  -- uses this locked text).
  ADD COLUMN portrait_prompt_locked     text;

-- 2. Drop per-series portrait + LoRA + V3-legacy columns from
--    story_characters. Identity now lives on `characters`; story_characters
--    keeps only the series linkage + story-specific prose.
ALTER TABLE story_characters
  DROP COLUMN IF EXISTS approved,
  DROP COLUMN IF EXISTS approved_image_id,
  DROP COLUMN IF EXISTS approved_seed,
  DROP COLUMN IF EXISTS approved_prompt,
  DROP COLUMN IF EXISTS approved_fullbody,
  DROP COLUMN IF EXISTS approved_fullbody_image_id,
  DROP COLUMN IF EXISTS approved_fullbody_seed,
  DROP COLUMN IF EXISTS approved_fullbody_prompt,
  DROP COLUMN IF EXISTS portrait_prompt_locked,
  DROP COLUMN IF EXISTS face_url,
  DROP COLUMN IF EXISTS active_lora_id,
  DROP COLUMN IF EXISTS body_prompt,
  DROP COLUMN IF EXISTS body_prompt_status,
  DROP COLUMN IF EXISTS lora_file_url,
  DROP COLUMN IF EXISTS lora_trigger_word,
  DROP COLUMN IF EXISTS lora_training_status,
  DROP COLUMN IF EXISTS regen_count;

-- 3. Drop LoRA tables. lora_dataset_images cascades from character_loras,
--    but drop explicitly for clarity. nsw_lora_* belonged to the admin
--    /lora-studio workflow which is also being removed.
DROP TABLE IF EXISTS lora_dataset_images;
DROP TABLE IF EXISTS character_loras;
DROP TABLE IF EXISTS nsw_lora_images;
DROP TABLE IF EXISTS nsw_lora_sessions;

COMMIT;
