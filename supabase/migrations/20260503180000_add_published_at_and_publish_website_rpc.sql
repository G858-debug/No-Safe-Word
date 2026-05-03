-- Phase 0.6a: Website-only publish flow.
--
-- Background: until now the only code path that sets a story_posts row
-- to status='published' is the Facebook publish handler, and nothing
-- ever flips story_series.status to 'published'. The public chapter
-- page (apps/web/app/stories/[slug]/[partNumber]/page.tsx) requires
-- BOTH series.status='published' AND post.status='published', so
-- chapters stay invisible on nosafeword.co.za regardless of how much
-- content is ready.
--
-- This migration adds:
--   1. story_series.published_at (nullable timestamptz) — stamps when
--      the series went live on the website. NULL means draft.
--   2. publish_story_to_website(p_series_id) — atomic RPC that flips
--      the series and every still-unpublished post to 'published' in a
--      single transaction. Posts already at 'published' (e.g. ones
--      that went out via Facebook earlier) are left alone. If either
--      UPDATE fails, both roll back, so we never leave the series
--      visible while chapters 404.
--
-- The RPC is the backing call for the new "Publish Whole Story to
-- Website Now" button in the Story Publisher's Publish tab. The
-- handler at apps/web/app/api/stories/[seriesId]/publish-website
-- runs the precondition checklist before invoking this function.

ALTER TABLE public.story_series
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN public.story_series.published_at IS
  'Timestamp the series went live on the public website. NULL means draft/unpublished. Set by publish_story_to_website().';

CREATE OR REPLACE FUNCTION publish_story_to_website(
  p_series_id uuid
)
RETURNS TABLE (
  out_series_id     uuid,
  out_published_at  timestamptz,
  out_posts_updated integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now           timestamptz := now();
  v_posts_updated integer;
BEGIN
  -- Lock the series row for the duration of the transaction so a
  -- concurrent delete or competing publish can't race us.
  PERFORM 1
    FROM story_series
   WHERE id = p_series_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'series % not found', p_series_id;
  END IF;

  UPDATE story_series
     SET status       = 'published',
         published_at = v_now,
         updated_at   = v_now
   WHERE story_series.id = p_series_id;

  -- Promote every post that isn't already published. Excluded statuses
  -- match the spec exactly: 'draft', 'images_pending',
  -- 'images_approved', 'ready', 'scheduled'. Posts at 'published' are
  -- left untouched so we don't clobber a Facebook publish timestamp.
  WITH updated AS (
    UPDATE story_posts
       SET status       = 'published',
           published_at = v_now,
           updated_at   = v_now
     WHERE story_posts.series_id = p_series_id
       AND story_posts.status IN (
             'draft',
             'images_pending',
             'images_approved',
             'ready',
             'scheduled'
           )
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_posts_updated FROM updated;

  RETURN QUERY
    SELECT p_series_id     AS out_series_id,
           v_now           AS out_published_at,
           v_posts_updated AS out_posts_updated;
END;
$$;

COMMENT ON FUNCTION publish_story_to_website(uuid) IS
  'Atomically publish a series to the public website. Sets story_series.status=''published'' + published_at=now() and promotes every non-published story_posts row in the series. Single transaction: if either UPDATE fails, both roll back. Called by POST /api/stories/[seriesId]/publish-website.';
