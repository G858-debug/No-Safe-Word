-- Add approved_prompt to story_characters so the exact prompt used for the
-- approved portrait can be reused when generating story images, keeping
-- character appearance consistent across all images in the series.
ALTER TABLE public.story_characters
  ADD COLUMN IF NOT EXISTS approved_prompt text;
