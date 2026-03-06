-- Remove SDXL engine references — Flux/Kontext is now the sole image engine.

-- Migrate all existing series to Kontext
UPDATE story_series SET image_engine = 'kontext' WHERE image_engine = 'sdxl';

-- Update the default and constraint
ALTER TABLE story_series
  ALTER COLUMN image_engine SET DEFAULT 'kontext';

ALTER TABLE story_series
  DROP CONSTRAINT IF EXISTS story_series_image_engine_check;

ALTER TABLE story_series
  ADD CONSTRAINT story_series_image_engine_check
    CHECK (image_engine = 'kontext');

COMMENT ON COLUMN story_series.image_engine IS 'Image generation engine. Currently only kontext (Flux Kontext).';

-- Update character_loras base_model default if the column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'character_loras' AND column_name = 'base_model'
  ) THEN
    UPDATE character_loras SET base_model = 'flux' WHERE base_model = 'sdxl';
    ALTER TABLE character_loras ALTER COLUMN base_model SET DEFAULT 'flux';
  END IF;
END $$;
