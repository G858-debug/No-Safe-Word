-- V2 Pipeline: Add NB2 + UnCanny inpainting as an image engine option.
-- Adds series-level inpaint prompt and per-prompt SFW image tracking.

-- Migrate any legacy engine values to kontext before adding new constraint
UPDATE story_series SET image_engine = 'kontext'
  WHERE image_engine NOT IN ('kontext', 'nb2_uncanny');

-- Allow nb2_uncanny as an image_engine value
ALTER TABLE story_series
  DROP CONSTRAINT IF EXISTS story_series_image_engine_check;
ALTER TABLE story_series
  ADD CONSTRAINT story_series_image_engine_check
    CHECK (image_engine IN ('kontext', 'nb2_uncanny'));

-- Series-level inpaint prompt for V2 NSFW generation
ALTER TABLE story_series
  ADD COLUMN IF NOT EXISTS inpaint_prompt TEXT;
COMMENT ON COLUMN story_series.inpaint_prompt IS
  'V2 pipeline: default prompt for UnCanny inpainting (describes what replaces masked clothing). Used for website_nsfw_paired images.';

-- Store the NB2 base image separately for NSFW paired prompts
ALTER TABLE story_image_prompts
  ADD COLUMN IF NOT EXISTS sfw_image_id UUID REFERENCES images(id);
COMMENT ON COLUMN story_image_prompts.sfw_image_id IS
  'V2 pipeline: NB2 base (clothed) image for NSFW paired prompts. image_id holds the inpainted NSFW version.';
