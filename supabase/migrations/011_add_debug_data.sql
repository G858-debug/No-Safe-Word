-- Add debug_data JSONB column for storing multi-pass debug generation diagnostics.
-- Stores intermediate image URLs, decomposed prompts, optimization results,
-- scene classification, and pass-by-pass metadata.
ALTER TABLE story_image_prompts
  ADD COLUMN IF NOT EXISTS debug_data jsonb;
