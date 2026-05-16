-- Single-column reference-mode selector for Flux 2 Dev scene images.
-- Replaces the per-character primary_ref_type / secondary_ref_type approach
-- with a single choice that applies to all characters in the image.
--
-- face          → face portrait only (no wardrobe bleed; body described by Mistral)
-- body          → body portrait only (proportions in reference, some bleed)
-- face_and_body → both portraits sent (strongest identity anchor, most bleed)
--
-- Default is 'face_and_body', matching the current unconditional behaviour
-- so existing rows need no backfill.

ALTER TABLE story_image_prompts
  ADD COLUMN ref_mode text NOT NULL DEFAULT 'face_and_body'
    CHECK (ref_mode IN ('face', 'body', 'face_and_body'));
