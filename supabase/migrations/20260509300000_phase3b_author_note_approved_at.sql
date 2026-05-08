-- Phase 3b: explicit timestamp marking when a reviewer approved a story's
-- Author's Notes block (Stage 13 in the new pipeline numbering).
--
-- Same rationale as the Phase 3a card_approved_at column: distinguishes
-- "imported and untouched" from "reviewer locked it for publish". The
-- four format fields (website_long, email_version, linkedin_post,
-- social_caption) come pre-populated from the imported JSON; an
-- approval timestamp captures the explicit reviewer action.
--
-- Stronger lock than Phase 3a's character cards: the author-note PATCH
-- and image-regenerate routes reject after approval (with a "revoke
-- first" hint). Reasoning: author notes feed Buffer scheduling and
-- email-send pipelines, so a sneaky edit after approval can desync
-- from what got scheduled. Character profile fields only feed manual
-- website publishes — lower stakes, no lock.
--
-- author_note_approved => author_note_approved_at IS NOT NULL.

ALTER TABLE story_series
  ADD COLUMN author_note_approved_at timestamptz;
