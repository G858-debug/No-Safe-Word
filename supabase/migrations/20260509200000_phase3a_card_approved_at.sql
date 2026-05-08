-- Phase 3a: explicit timestamp marking when a reviewer approved a
-- character's profile-card stage (Stage 9 in the new pipeline numbering).
--
-- Why a dedicated column rather than deriving from existing fields:
--   - The seven profile-card text fields (archetype_tag, vibe_line, wants,
--     needs, defining_quote, watch_out_for, bio_short) come pre-populated
--     from the imported JSON. "All non-null" can't distinguish "imported
--     and untouched" from "reviewed and approved".
--   - The card image (card_image_id / card_image_url) is set at generation
--     time, not at approval time — same problem.
--   - An explicit `card_approved_at` mirrors how `published_at` works
--     elsewhere: the timestamp captures the reviewer action, gives free
--     audit, and is trivially revocable (set NULL → re-approval needed).
--
-- card_approved => card_approved_at IS NOT NULL.

ALTER TABLE characters
  ADD COLUMN card_approved_at timestamptz;
