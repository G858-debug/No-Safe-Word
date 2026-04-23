-- ============================================================
-- Phase 2 (Covers & Blurbs): generation_jobs cover fields
-- ============================================================
-- Extends generation_jobs with a job_type discriminator so the
-- shared status polling endpoint (/api/status/[jobId]) can branch
-- between scene-image completion (upload to story-images, write to
-- story_image_prompts, run evaluation pipeline) and cover-variant
-- completion (upload to story-covers/{slug}/variants/variant-N.png,
-- write to story_series.cover_variants[N], skip evaluation).
--
-- Also adds story_series.cover_error so the UI can surface failure
-- details without scraping logs.
--
-- Design note: image_id stays NOT NULL. Each cover variant still
-- gets its own images row (carrying settings.model='flux2_dev',
-- settings.purpose='cover_variant', settings.series_id, and
-- settings.variant_index) for provenance and so the existing
-- stored_url plumbing keeps working. The variant's public URL is
-- also mirrored into story_series.cover_variants for UI reads.
-- ============================================================

-- Job-type discriminator + cover-specific context.
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS job_type      TEXT NOT NULL DEFAULT 'scene_image',
  ADD COLUMN IF NOT EXISTS variant_index INTEGER,
  ADD COLUMN IF NOT EXISTS series_id     UUID REFERENCES public.story_series(id) ON DELETE SET NULL;

-- Valid discriminator values. Add new job types here as new
-- pipelines get added (blurb generation, etc.).
ALTER TABLE public.generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_job_type_check;

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_job_type_check
  CHECK (job_type IN ('scene_image', 'cover_variant', 'character_portrait'));

-- variant_index is only meaningful for cover_variant jobs and must
-- be 0–3 (4-variant cover grid). Null for scene_image jobs.
ALTER TABLE public.generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_variant_index_check;

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_variant_index_check
  CHECK (
    variant_index IS NULL
    OR (variant_index >= 0 AND variant_index <= 3)
  );

-- Shape invariant: cover_variant jobs must carry both series_id and
-- variant_index; scene_image jobs must carry neither.
ALTER TABLE public.generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_cover_shape_check;

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_cover_shape_check
  CHECK (
    (job_type = 'cover_variant' AND series_id IS NOT NULL AND variant_index IS NOT NULL)
    OR (job_type <> 'cover_variant' AND variant_index IS NULL)
  );

-- Index for the "did all 4 variants finish?" query in the status
-- endpoint. Filters by series_id + job_type.
CREATE INDEX IF NOT EXISTS generation_jobs_cover_lookup_idx
  ON public.generation_jobs (series_id, job_type)
  WHERE job_type = 'cover_variant';

COMMENT ON COLUMN public.generation_jobs.job_type IS
  'Discriminator: scene_image (default, existing behavior), cover_variant (covers), character_portrait (future). The status endpoint branches on this.';
COMMENT ON COLUMN public.generation_jobs.variant_index IS
  'For cover_variant jobs: 0–3 index in story_series.cover_variants. Null for other job types.';
COMMENT ON COLUMN public.generation_jobs.series_id IS
  'For cover_variant jobs: the series being covered. Null for scene_image (series is reachable via image_id→story_image_prompts).';

-- story_series.cover_error ------------------------------------

ALTER TABLE public.story_series
  ADD COLUMN IF NOT EXISTS cover_error TEXT;

COMMENT ON COLUMN public.story_series.cover_error IS
  'Last cover-generation failure message. Null on success or before first attempt. Cleared when a new generation starts.';
