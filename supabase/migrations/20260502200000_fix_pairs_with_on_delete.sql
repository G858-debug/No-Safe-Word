-- Fix story_image_prompts.pairs_with FK to use ON DELETE SET NULL.
--
-- Migration 002 declared this with `on delete set null`, but the live
-- constraint was created without an ON DELETE action (likely because
-- the table pre-existed when 002 ran with `create table if not exists`).
-- Result: deleting a facebook_sfw prompt that has a website_nsfw_paired
-- pointing at it via pairs_with fails with a FK violation.
--
-- After this migration, deleting an SFW prompt unlinks any paired NSFW
-- (sets pairs_with to null) instead of blocking the delete. The paired
-- NSFW row itself is preserved — it still has a stored image and a
-- position_after_word and remains a valid website-only image.

ALTER TABLE public.story_image_prompts
  DROP CONSTRAINT IF EXISTS story_image_prompts_pairs_with_fkey;

ALTER TABLE public.story_image_prompts
  ADD CONSTRAINT story_image_prompts_pairs_with_fkey
  FOREIGN KEY (pairs_with)
  REFERENCES public.story_image_prompts(id)
  ON DELETE SET NULL;
