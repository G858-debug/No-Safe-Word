-- Backfill cover-pipeline events for Story #1 ("the-lobola-list",
-- ae21e397-4f76-4747-9734-86ea9a65e2af).
--
-- Reconstructs the event history that would have been logged if the
-- B2 + post-B2 cleanup instrumentation had been in place during this
-- series' original approval and Phase B1 manual-trigger cycle.
--
-- Ground truth used for timestamps:
--   - story_series.cover_status went 'variants_ready' → 'approved' at
--     2026-04-26 10:24:30 (Phase A diagnostic snapshot).
--   - The fire-and-forget that should have followed this approval was
--     silently rejected with 401 by the middleware. NO compositing
--     ran for this approval — so there is NO composite_started event
--     to backfill for it.
--   - On 2026-04-27 a manual Phase B1 trigger of /composite-cover
--     ran the pipeline for the first time. It failed at the 'hero'
--     size with the @shuding/opentype.js fvar parsing bug. The
--     revertToApproved write landed at 2026-04-27 15:42:44. Compositing
--     takes 10–30s so composite_started is dated ~15s earlier.
--   - After deploying the font fix, a second manual trigger ran
--     successfully. cover_status flipped to 'complete' at
--     2026-04-27 16:09:25, with cover_sizes hashes that still match
--     the live composites (hero-1600x2400-54e6b109.jpg etc).
--
-- Idempotent: re-running the migration is safe because of the
-- WHERE NOT EXISTS guard on the backfill_marker.

do $$
begin
  if not exists (
    select 1
    from public.events
    where metadata ->> 'backfill_marker' = 'story-1-cover-history-2026-04-28'
  ) then
    insert into public.events (event_type, user_id, metadata, created_at) values
      (
        'cover.approved',
        null,
        jsonb_build_object(
          'series_id',        'ae21e397-4f76-4747-9734-86ea9a65e2af',
          'slug',             'the-lobola-list',
          'selected_variant', 1,
          'backfill_marker',  'story-1-cover-history-2026-04-28',
          'note',             'Backfilled — original approval predated cover.approved instrumentation. Fire-and-forget composite trigger that should have followed was silently 401d by middleware.'
        ),
        '2026-04-26 10:24:30+00'::timestamptz
      ),
      (
        'cover.composite_started',
        null,
        jsonb_build_object(
          'series_id',       'ae21e397-4f76-4747-9734-86ea9a65e2af',
          'slug',            'the-lobola-list',
          'attempt',         1,
          'backfill_marker', 'story-1-cover-history-2026-04-28',
          'note',            'Backfilled — Phase B1 manual curl trigger after Phase A diagnostic.'
        ),
        '2026-04-27 15:42:30+00'::timestamptz
      ),
      (
        'cover.composite_failed',
        null,
        jsonb_build_object(
          'series_id',       'ae21e397-4f76-4747-9734-86ea9a65e2af',
          'slug',            'the-lobola-list',
          'attempt',         1,
          'failed_at',       'hero',
          'error',           'Compositing failed at size ''hero'': Cannot read properties of undefined (reading ''256'')',
          'root_cause',      'CormorantGaramond.ttf and Inter.ttf were variable fonts; @shuding/opentype.js parseFvarAxis crashed reading the fvar table.',
          'fix_commit',      '1e1130c',
          'backfill_marker', 'story-1-cover-history-2026-04-28'
        ),
        '2026-04-27 15:42:44+00'::timestamptz
      ),
      (
        'cover.composite_started',
        null,
        jsonb_build_object(
          'series_id',       'ae21e397-4f76-4747-9734-86ea9a65e2af',
          'slug',            'the-lobola-list',
          'attempt',         2,
          'backfill_marker', 'story-1-cover-history-2026-04-28',
          'note',            'Backfilled — Phase B1 manual curl trigger after font fix deploy (commit 1e1130c).'
        ),
        '2026-04-27 16:09:00+00'::timestamptz
      ),
      (
        'cover.composite_completed',
        null,
        jsonb_build_object(
          'series_id',       'ae21e397-4f76-4747-9734-86ea9a65e2af',
          'slug',            'the-lobola-list',
          'attempt',         2,
          'cover_sizes', jsonb_build_object(
            'hero',  'https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/story-covers/the-lobola-list/hero-1600x2400-54e6b109.jpg',
            'card',  'https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/story-covers/the-lobola-list/card-600x900-890f8072.jpg',
            'og',    'https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/story-covers/the-lobola-list/og-1200x630-867baca3.jpg',
            'email', 'https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/story-covers/the-lobola-list/email-1200x600-3dbd515b.jpg'
          ),
          'backfill_marker', 'story-1-cover-history-2026-04-28'
        ),
        '2026-04-27 16:09:25+00'::timestamptz
      );
  end if;
end $$;
