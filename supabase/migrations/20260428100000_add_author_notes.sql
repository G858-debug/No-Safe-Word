-- ============================================================
-- Author's Notes: optional editorial reflection block
-- ============================================================
-- Adds a single JSONB column to story_series for storing the
-- "Nontsikelelo Mabaso" author-persona reflection block produced
-- at Stage 7 of the story creation workflow. NULL when the story
-- is entertainment-only and did not earn notes.
--
-- Shape when present (validated at import — see
-- packages/shared/src/story-types.ts validateImportPayload):
--   {
--     website_long:   string (400–700 words, paywalled on website)
--     email_version:  string (200–350 words)
--     linkedin_post:  string (150–250 words)
--     social_caption: string (60–120 words)
--   }
--
-- All four sub-fields are required when the block is present;
-- partial blocks and unknown keys are rejected at import.
-- ============================================================

ALTER TABLE public.story_series
  ADD COLUMN IF NOT EXISTS author_notes JSONB;

COMMENT ON COLUMN public.story_series.author_notes IS
  'Optional editorial reflection block from Stage 7 import. NULL when the story is entertainment-only and did not earn notes. Shape when present: { website_long, email_version, linkedin_post, social_caption } — all four non-empty strings. Validated at import; rendered on the Publish review screen.';
