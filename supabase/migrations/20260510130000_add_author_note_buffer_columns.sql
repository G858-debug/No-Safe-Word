-- Author-note Buffer scheduling columns on story_series.
--
-- The author note is scheduled as a single Facebook Buffer post on the
-- day AFTER the last chapter in the series. These four columns mirror
-- the per-chapter buffer_post_id / buffer_status / buffer_error /
-- scheduled_for set on story_posts; we keep them on story_series
-- because there is exactly one author note per series.
--
-- All nullable. NULL means "not yet scheduled" (or "cancelled and
-- cleared", same as the chapter pattern after DELETE).

ALTER TABLE story_series
  ADD COLUMN author_note_buffer_post_id text,
  ADD COLUMN author_note_buffer_status  text,
  ADD COLUMN author_note_buffer_error   text,
  ADD COLUMN author_note_scheduled_for  timestamptz;
