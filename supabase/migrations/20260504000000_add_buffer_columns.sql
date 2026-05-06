-- Track Buffer-managed Facebook scheduling state on story_posts.
--
-- Why a separate set of columns from facebook_post_id / status:
--
-- The existing `facebook_post_id` is the Facebook-side post identifier
-- (set by the legacy direct-Graph-API publish path) and `status` is our
-- own product lifecycle (draft/scheduled/published). Buffer's lifecycle
-- is independent — Buffer holds its own post_id and reports its own
-- send-state — and a Buffer-scheduled post can be in flight (Buffer
-- 'scheduled' or 'sending') while we still want to call it 'scheduled'
-- in our UI. Mixing the two would lose information.
--
-- Columns:
--   buffer_post_id  Buffer's PostId. Set when we successfully POST
--                    createPost to Buffer. Null otherwise.
--   buffer_status   Buffer's last-observed status string ('pending',
--                    'scheduled', 'sending', 'sent', 'error', etc.).
--                    Mirrors Buffer's PostStatus enum verbatim.
--   buffer_error    Human-readable error message when Buffer reports
--                    'error'. Null on success.

alter table public.story_posts
  add column if not exists buffer_post_id text null,
  add column if not exists buffer_status  text null,
  add column if not exists buffer_error   text null;

-- Lookup by buffer_post_id when the sync cron polls Buffer for status.
-- Partial index — only rows with a buffer_post_id are interesting.
create index if not exists story_posts_buffer_post_id_idx
  on public.story_posts (buffer_post_id)
  where buffer_post_id is not null;

-- Sync-cron scan path: "all scheduled posts whose dueAt has passed."
-- Partial index keeps the index small; we never query 'draft' here.
create index if not exists story_posts_scheduled_status_idx
  on public.story_posts (scheduled_for, status)
  where status in ('scheduled', 'sent');

comment on column public.story_posts.buffer_post_id is
  'Buffer Post.id returned from createPost. Null until scheduled via Buffer.';
comment on column public.story_posts.buffer_status is
  'Last observed Buffer Post.status (mirrors Buffer enum: '
  'draft|needs_approval|scheduled|sending|sent|error). Synced by '
  '/api/cron/buffer-sync.';
comment on column public.story_posts.buffer_error is
  'Buffer-side publish error message when buffer_status = ''error''.';
