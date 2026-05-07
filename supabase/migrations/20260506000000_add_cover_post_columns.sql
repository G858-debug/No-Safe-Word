-- Cover-reveal Buffer post tracking on story_series.
--
-- The chapter-level Buffer state lives on story_posts (buffer_post_id /
-- buffer_status / buffer_error). The cover-reveal post is a one-off
-- per-series Facebook post that fires the night BEFORE Chapter 1 with
-- the approved cover image, the selected long blurb, and a CTA. It
-- needs equivalent fields on story_series since there's no per-chapter
-- row that owns it.
--
-- Columns:
--   cover_post_buffer_id        Buffer's PostId. Set when we POST
--                                createPost to Buffer. Null otherwise.
--   cover_post_status           Last observed Buffer status, mirrors
--                                Buffer's PostStatus enum verbatim
--                                (pending|scheduled|sending|sent|error).
--   cover_post_error            Human-readable error when status='error'.
--   cover_post_scheduled_for    The scheduledAt we asked Buffer for.
--                                Used by buffer-sync cron's "dueAt has
--                                passed" filter.
--   cover_post_published_at     Buffer's sentAt timestamp (mirrors
--                                story_posts.published_at).
--   cover_post_facebook_id      FB post id parsed out of Buffer's
--                                externalLink, when available.
--   cover_post_cta_line         Operator-edited CTA text. Persisted so
--                                it survives a page reload between
--                                preview and schedule.

alter table public.story_series
  add column if not exists cover_post_buffer_id     text null,
  add column if not exists cover_post_status        text null,
  add column if not exists cover_post_error         text null,
  add column if not exists cover_post_scheduled_for timestamptz null,
  add column if not exists cover_post_published_at  timestamptz null,
  add column if not exists cover_post_facebook_id   text null,
  add column if not exists cover_post_cta_line      text null;

-- Sync-cron lookup path: "all series whose cover post is in flight and
-- whose dueAt has passed."
create index if not exists story_series_cover_post_buffer_id_idx
  on public.story_series (cover_post_buffer_id)
  where cover_post_buffer_id is not null;

comment on column public.story_series.cover_post_buffer_id is
  'Buffer Post.id for the cover-reveal post. Null until scheduled.';
comment on column public.story_series.cover_post_status is
  'Last observed Buffer Post.status for the cover-reveal post. Synced by /api/cron/buffer-sync.';
comment on column public.story_series.cover_post_error is
  'Buffer-side error message when cover_post_status = ''error''.';
comment on column public.story_series.cover_post_scheduled_for is
  'The scheduledAt we asked Buffer for. Used by the sync cron filter.';
comment on column public.story_series.cover_post_published_at is
  'Buffer-reported sentAt for the cover post. Mirrors story_posts.published_at.';
comment on column public.story_series.cover_post_facebook_id is
  'Facebook post id parsed from Buffer.externalLink for the cover post.';
comment on column public.story_series.cover_post_cta_line is
  'Operator-edited CTA line appended to the cover post body. Persisted so the dashboard survives reloads between preview and schedule.';
