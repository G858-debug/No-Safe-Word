-- Per-chapter hero image flag.
--
-- The website chapter page renders at most ONE Facebook SFW image at the
-- top of the chapter (the "hero"). Editors pick that image in the
-- Publisher; it is no longer auto-derived from position=1.
--
-- Constraints:
--   - Only facebook_sfw rows may be flagged (CHECK).
--   - At most one flagged row per post (partial unique index).
--   - Default false; existing rows stay unflagged. Editors must opt in.

ALTER TABLE story_image_prompts
  ADD COLUMN IF NOT EXISTS is_chapter_hero boolean NOT NULL DEFAULT false;

ALTER TABLE story_image_prompts
  DROP CONSTRAINT IF EXISTS story_image_prompts_hero_only_on_sfw;
ALTER TABLE story_image_prompts
  ADD CONSTRAINT story_image_prompts_hero_only_on_sfw
  CHECK (NOT is_chapter_hero OR image_type = 'facebook_sfw');

CREATE UNIQUE INDEX IF NOT EXISTS story_image_prompts_one_hero_per_post
  ON story_image_prompts (post_id)
  WHERE is_chapter_hero AND image_type = 'facebook_sfw';

-- Atomic hero swap. The function runs in a single transaction so the
-- caller sees the swap as one operation; the partial unique index
-- guarantees that at any rest point at most one row is flagged.
--
-- We can't do the swap in a single UPDATE (Postgres checks unique
-- indexes per-row, so flipping A=true→false and B=false→true in one
-- statement may transiently violate the index depending on heap scan
-- order). Splitting into clear-then-set keeps each statement valid on
-- its own. When p_prompt_id is NULL the second UPDATE is a no-op via
-- WHERE id = NULL, leaving zero rows flagged.
--
-- Caller must validate that p_prompt_id (when not NULL) is a
-- facebook_sfw row belonging to p_post_id; this function trusts inputs
-- and only touches facebook_sfw rows scoped to p_post_id.
CREATE OR REPLACE FUNCTION set_chapter_hero(
  p_post_id   uuid,
  p_prompt_id uuid
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE story_image_prompts
     SET is_chapter_hero = false
   WHERE post_id = p_post_id
     AND image_type = 'facebook_sfw'
     AND is_chapter_hero = true
     AND (p_prompt_id IS NULL OR id <> p_prompt_id);

  UPDATE story_image_prompts
     SET is_chapter_hero = true
   WHERE id = p_prompt_id
     AND post_id = p_post_id
     AND image_type = 'facebook_sfw'
     AND is_chapter_hero = false;
$$;
