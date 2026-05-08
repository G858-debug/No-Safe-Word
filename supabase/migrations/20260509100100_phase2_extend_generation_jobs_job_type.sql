-- Phase 2: extend the generation_jobs.job_type CHECK constraint to allow
-- the two new simple-image job types introduced by Phase 2:
--
--   - character_card  → MEET THE CAST environmental shot per character
--   - author_note     → atmospheric image accompanying the Author's Notes
--                       block per story
--
-- Both flow through the existing async submit/poll infrastructure
-- (generation_jobs + /api/status/[jobId]) and propagate completion to
-- characters.card_image_id / story_series.author_note_image_id via the
-- shared simple-image-completion helper.

ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_job_type_check;

ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_job_type_check
  CHECK (job_type = ANY (ARRAY[
    'scene_image'::text,
    'cover_variant'::text,
    'character_portrait'::text,
    'character_card'::text,
    'author_note'::text
  ]));
