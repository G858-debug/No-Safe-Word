-- V3 Pipeline: Flux Krea + PuLID engine (no LoRA training required).
-- Face-only character approval with text body prompts.

-- Expand image_engine constraint to include flux_pulid
ALTER TABLE story_series
  DROP CONSTRAINT IF EXISTS story_series_image_engine_check;
ALTER TABLE story_series
  ADD CONSTRAINT story_series_image_engine_check
    CHECK (image_engine IN ('kontext', 'nb2_uncanny', 'flux_pulid'));

-- Per-character body description prompt (text only, no image generated).
-- Injected into scene prompts as identity reinforcement.
ALTER TABLE story_characters
  ADD COLUMN IF NOT EXISTS body_prompt TEXT;
COMMENT ON COLUMN story_characters.body_prompt IS
  'V3 pipeline: approved prose description of character body proportions. Injected into scene prompt identity prefix. No body image generated — text only.';

ALTER TABLE story_characters
  ADD COLUMN IF NOT EXISTS body_prompt_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (body_prompt_status IN ('pending', 'approved'));
COMMENT ON COLUMN story_characters.body_prompt_status IS
  'V3 pipeline: whether the body description prompt has been reviewed and approved.';
