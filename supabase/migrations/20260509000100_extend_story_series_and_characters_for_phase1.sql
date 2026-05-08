-- Phase 1: Extend story_series and characters for the author system,
-- character profile cards, and author's notes image prompt.
--
-- story_series:
--   - author_id              : FK to authors. Backfilled to Nontsikelelo
--                              for every existing row, then locked NOT NULL.
--   - author_note_image_prompt: prompt text for the future Author's Notes
--                              accompanying image (image generation is
--                              Phase 2).
--   - author_note_image_url  : output URL once that image is generated +
--                              approved (Phase 2).
--   - author_note_publish_states: jsonb tracking which formats have been
--                              published and where. Defaults to '{}'.
--
-- NOTE: story_series.author_notes (jsonb) already exists from a prior
-- migration. It uses keys website_long / email_version / linkedin_post /
-- social_caption. Phase 1 keeps those keys.
--
-- characters:
--   Eight new profile-card fields (all nullable, no constraints). Drive
--   the new "MEET THE CAST" section on story detail pages and a new
--   approval stage in the Story Publisher (UI is Phase 3).

ALTER TABLE story_series
  ADD COLUMN author_id uuid REFERENCES authors(id),
  ADD COLUMN author_note_image_prompt text,
  ADD COLUMN author_note_image_url text,
  ADD COLUMN author_note_publish_states jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE story_series
SET author_id = (SELECT id FROM authors WHERE slug = 'nontsikelelo-mabaso')
WHERE author_id IS NULL;

ALTER TABLE story_series ALTER COLUMN author_id SET NOT NULL;

ALTER TABLE characters
  ADD COLUMN archetype_tag text,
  ADD COLUMN vibe_line text,
  ADD COLUMN wants text,
  ADD COLUMN needs text,
  ADD COLUMN defining_quote text,
  ADD COLUMN watch_out_for text,
  ADD COLUMN bio_short text,
  ADD COLUMN card_image_prompt text,
  ADD COLUMN card_image_url text;
