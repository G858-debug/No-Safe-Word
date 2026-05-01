-- Add cover_secondary_character_id to story_series.
--
-- Cover generation defaults to the protagonist + the love_interest role
-- character. This column lets a series override the secondary character
-- on the cover (e.g. a story where the cover scene features a different
-- supporting character than the love_interest of the wider plot) without
-- mutating the story_characters role assignments — which would also
-- affect scene image generation and other role-driven logic.
--
-- NULL = no override; cover generation falls back to the love_interest
-- role as before. Non-NULL = use the referenced character's approved
-- portrait as the secondary reference image AND identity in the cover
-- prompt.
ALTER TABLE story_series
  ADD COLUMN IF NOT EXISTS cover_secondary_character_id uuid
  REFERENCES characters(id) ON DELETE SET NULL;
