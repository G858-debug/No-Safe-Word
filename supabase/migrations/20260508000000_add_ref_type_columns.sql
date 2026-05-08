-- Per-image character reference selector.
--
-- Adds `face | body` columns to scene prompts and to story_series cover state.
-- The dispatcher uses these to choose between `characters.approved_image_id`
-- (face) and `characters.approved_fullbody_image_id` (body) when resolving
-- the reference image URL passed to Flux 2 Dev (PuLID base64) or Hunyuan via
-- Siray (i2i `images: [...]`).
--
-- Default = 'body'. Existing rows take this default; the body portrait is now
-- the canonical reference unless a user explicitly flips the dropdown to face.

ALTER TABLE story_image_prompts
  ADD COLUMN primary_ref_type text NOT NULL DEFAULT 'body'
    CHECK (primary_ref_type IN ('face', 'body')),
  ADD COLUMN secondary_ref_type text
    CHECK (secondary_ref_type IS NULL OR secondary_ref_type IN ('face', 'body'));

ALTER TABLE story_series
  ADD COLUMN cover_primary_ref_type text NOT NULL DEFAULT 'body'
    CHECK (cover_primary_ref_type IN ('face', 'body')),
  ADD COLUMN cover_secondary_ref_type text
    CHECK (cover_secondary_ref_type IS NULL OR cover_secondary_ref_type IN ('face', 'body'));
