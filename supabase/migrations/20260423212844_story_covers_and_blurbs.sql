-- ============================================================
-- Phase 1 (Covers & Blurbs): foundation schema
-- ============================================================
-- Adds cover-image and blurb variant storage to story_series,
-- plus a public-read `story-covers` storage bucket.
--
-- Pipeline sequencing (see also CLAUDE.md):
--   1. Story imported (Stage 7 JSON)              → blurb/cover columns null
--   2. Character portraits generated + approved    → portrait_prompt_locked set
--   3. *** Cover generation + approval ***         → cover_status: pending → complete
--   4. Scene image generation                      → story_image_prompts.status flow
--
-- Cover generation is model-locked to Flux 2 Dev regardless of
-- story_series.image_model. Blurbs are text-only (no model binding).
--
-- All columns here are nullable / defaulted so this migration is
-- safe on existing rows; covers and blurbs are filled in by a
-- separate post-import workflow (see Prompt 5's retroactive
-- migration script for back-filling existing stories).
-- ============================================================

-- Cover fields ------------------------------------------------

ALTER TABLE public.story_series
  ADD COLUMN IF NOT EXISTS cover_prompt           TEXT,
  ADD COLUMN IF NOT EXISTS cover_base_url         TEXT,
  ADD COLUMN IF NOT EXISTS cover_variants         JSONB,
  ADD COLUMN IF NOT EXISTS cover_selected_variant INTEGER,
  ADD COLUMN IF NOT EXISTS cover_sizes            JSONB,
  ADD COLUMN IF NOT EXISTS cover_status           TEXT NOT NULL DEFAULT 'pending';

-- Constrain cover_status to the known state machine. Using a
-- named constraint so future migrations can drop/replace cleanly.
ALTER TABLE public.story_series
  DROP CONSTRAINT IF EXISTS story_series_cover_status_check;

ALTER TABLE public.story_series
  ADD CONSTRAINT story_series_cover_status_check
  CHECK (cover_status IN (
    'pending',         -- no generation attempted yet
    'generating',      -- Flux 2 Dev job in flight for the 4 variants
    'variants_ready',  -- 4 variants generated, awaiting user selection
    'approved',        -- user selected a variant; base.png copied to bucket
    'compositing',     -- typography passes running (hero/card/og/email)
    'complete',        -- all composites written; ready for publish
    'failed'           -- any stage failed; retry from the last checkpoint
  ));

-- Selected variant must be 0–3 or null (null until a variant is picked).
ALTER TABLE public.story_series
  DROP CONSTRAINT IF EXISTS story_series_cover_selected_variant_check;

ALTER TABLE public.story_series
  ADD CONSTRAINT story_series_cover_selected_variant_check
  CHECK (cover_selected_variant IS NULL
         OR (cover_selected_variant >= 0 AND cover_selected_variant <= 3));

COMMENT ON COLUMN public.story_series.cover_prompt IS
  'Generation prompt for the cover image. Editable in the Story Publisher; fed into Flux 2 Dev regardless of story_series.image_model.';
COMMENT ON COLUMN public.story_series.cover_base_url IS
  'Public URL of the approved base cover variant (no typography, 1024×1536). Copied from variants/variant-N.png to base.png on approval.';
COMMENT ON COLUMN public.story_series.cover_variants IS
  'JSONB array of up to 4 variant URLs produced by Flux 2 Dev during cover generation. Cleared (or retained for audit) once cover_status = approved.';
COMMENT ON COLUMN public.story_series.cover_selected_variant IS
  'Index 0–3 of the user-selected variant from cover_variants. Null until the user approves a variant.';
COMMENT ON COLUMN public.story_series.cover_sizes IS
  'JSONB map of composited output URLs after typography compositing. Keys: hero (1600×2400), card (600×900), og (1200×630), email (1200×600).';
COMMENT ON COLUMN public.story_series.cover_status IS
  'Cover generation state machine: pending → generating → variants_ready → approved → compositing → complete (or failed).';

-- Blurb fields ------------------------------------------------

ALTER TABLE public.story_series
  ADD COLUMN IF NOT EXISTS blurb_short_variants JSONB,
  ADD COLUMN IF NOT EXISTS blurb_short_selected INTEGER,
  ADD COLUMN IF NOT EXISTS blurb_long_variants  JSONB,
  ADD COLUMN IF NOT EXISTS blurb_long_selected  INTEGER;

-- Selected indices must be 0–2 or null.
ALTER TABLE public.story_series
  DROP CONSTRAINT IF EXISTS story_series_blurb_short_selected_check;

ALTER TABLE public.story_series
  ADD CONSTRAINT story_series_blurb_short_selected_check
  CHECK (blurb_short_selected IS NULL
         OR (blurb_short_selected >= 0 AND blurb_short_selected <= 2));

ALTER TABLE public.story_series
  DROP CONSTRAINT IF EXISTS story_series_blurb_long_selected_check;

ALTER TABLE public.story_series
  ADD CONSTRAINT story_series_blurb_long_selected_check
  CHECK (blurb_long_selected IS NULL
         OR (blurb_long_selected >= 0 AND blurb_long_selected <= 2));

COMMENT ON COLUMN public.story_series.blurb_short_variants IS
  'JSONB array of 3 short blurb strings (1–2 sentences each). Used for story cards, email subjects, OG previews.';
COMMENT ON COLUMN public.story_series.blurb_short_selected IS
  'Index 0–2 of the selected short blurb variant. Null until a variant is approved.';
COMMENT ON COLUMN public.story_series.blurb_long_variants IS
  'JSONB array of 3 long blurb strings (150–250 words each). Used on website story detail pages.';
COMMENT ON COLUMN public.story_series.blurb_long_selected IS
  'Index 0–2 of the selected long blurb variant. Null until a variant is approved.';

-- Storage bucket ----------------------------------------------
-- Public-read, following the same pattern as lora-training-datasets
-- and story-images. Write protection comes from service-role key
-- discipline in API routes, not storage.objects RLS. See
-- docs/security-debt.md for the tech-debt note.

INSERT INTO storage.buckets (id, name, public)
VALUES ('story-covers', 'story-covers', true)
ON CONFLICT (id) DO NOTHING;
