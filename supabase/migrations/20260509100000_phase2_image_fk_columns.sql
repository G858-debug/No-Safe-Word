-- Phase 2: FK columns linking the Phase 1 cached URL columns to the
-- canonical `images` row that produced them.
--
-- Rationale: every other image type in the system uses an FK to `images`
-- (which holds stored_url, prompt, seed, settings, dimensions). Phase 1
-- shipped direct text URL columns to keep the schema surface small.
-- Phase 2 wires the actual generation pipeline, which is async and writes
-- through `images` first. Adding the FKs lets the existing generation_jobs
-- → status-route → images.stored_url plumbing reach the parent table on
-- completion, while keeping the Phase 1 `*_url` columns as cached
-- text-only convenience columns for read paths.
--
-- ON DELETE SET NULL keeps the parent row alive if its image is ever
-- deleted (mirrors the cover_secondary_character_id pattern).

ALTER TABLE characters
  ADD COLUMN card_image_id uuid REFERENCES images(id) ON DELETE SET NULL;

ALTER TABLE story_series
  ADD COLUMN author_note_image_id uuid REFERENCES images(id) ON DELETE SET NULL;
