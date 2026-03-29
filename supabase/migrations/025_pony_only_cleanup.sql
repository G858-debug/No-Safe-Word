-- Migration 025: Pony-only pipeline cleanup
-- Migrate all existing stories to pony_cyberreal and drop dead columns.
-- Keep face_url on story_characters — still useful for Pony reference images.

-- 1. Migrate all existing stories to pony_cyberreal
UPDATE story_series SET image_engine = 'pony_cyberreal' WHERE image_engine != 'pony_cyberreal';

-- 2. Set default for new stories
ALTER TABLE story_series ALTER COLUMN image_engine SET DEFAULT 'pony_cyberreal';

-- 3. Drop V2-only columns (inpaint prompts)
ALTER TABLE story_series DROP COLUMN IF EXISTS inpaint_prompt;
ALTER TABLE story_series DROP COLUMN IF EXISTS sfw_inpaint_prompt;

-- 4. Drop V3-only columns (text body prompt)
ALTER TABLE story_characters DROP COLUMN IF EXISTS body_prompt;
ALTER TABLE story_characters DROP COLUMN IF EXISTS body_prompt_status;

-- Note: We intentionally keep:
-- - story_series.image_engine column (set to pony_cyberreal for all rows)
-- - story_characters.face_url (useful for Pony character reference)
-- - The enum values in image_engine — restricting Postgres enums requires
--   creating a new type. The TypeScript type is already restricted.
