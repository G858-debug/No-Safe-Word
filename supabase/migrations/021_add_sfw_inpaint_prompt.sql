-- SFW body enhancement inpaint prompt for V2 pipeline.
-- Used to enhance female body shape through clothing in SFW images.
ALTER TABLE story_series
  ADD COLUMN IF NOT EXISTS sfw_inpaint_prompt TEXT;
COMMENT ON COLUMN story_series.sfw_inpaint_prompt IS
  'V2 pipeline: inpaint prompt for SFW body enhancement. Describes voluptuous figure in clothing.';
