-- Soft-hide flag for image prompts on the Publish tab.
--
-- excluded_from_publish lets editors remove an image from the public
-- website + Facebook output without deleting the row. Delete is
-- permanent and lives on the Images tab; exclude is reversible and
-- lives on the Publish tab.
--
-- Public read paths (apps/web/app/stories/[slug]/[partNumber]/page.tsx
-- and apps/web/app/api/stories/publish/[postId]/route.ts) filter on
-- this column. The Publisher dashboard reads excluded rows so it can
-- render them dimmed.

ALTER TABLE story_image_prompts
  ADD COLUMN IF NOT EXISTS excluded_from_publish boolean NOT NULL DEFAULT false;

-- An excluded row cannot also be the chapter hero. The hero is what
-- appears at the top of the public chapter; excluding it would leave
-- the partial unique index pointing at a row that publish-time queries
-- skip. The exclude endpoint clears the hero flag in the same
-- transaction; this CHECK backstops it against direct writes.
ALTER TABLE story_image_prompts
  DROP CONSTRAINT IF EXISTS story_image_prompts_excluded_not_hero;
ALTER TABLE story_image_prompts
  ADD CONSTRAINT story_image_prompts_excluded_not_hero
  CHECK (NOT (excluded_from_publish AND is_chapter_hero));

-- Atomic exclude that also clears is_chapter_hero when the row being
-- excluded was the hero. Mirrors the set_chapter_hero(...) RPC pattern:
-- one SQL function, single transaction, single round-trip from the
-- API route.
-- OUT parameters are renamed with an `out_` prefix because plpgsql
-- treats unprefixed OUT names as variables that shadow the table
-- columns of the same name; the UPDATE inside the function would then
-- raise "column reference 'id' is ambiguous". Callers map the columns
-- back to their natural names in TypeScript.
CREATE OR REPLACE FUNCTION set_image_excluded(
  p_post_id   uuid,
  p_prompt_id uuid,
  p_excluded  boolean
)
RETURNS TABLE (
  out_id                    uuid,
  out_excluded_from_publish boolean,
  out_is_chapter_hero       boolean,
  out_hero_was_cleared      boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_was_hero boolean;
BEGIN
  SELECT sip.is_chapter_hero INTO v_was_hero
    FROM story_image_prompts sip
   WHERE sip.id = p_prompt_id
     AND sip.post_id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'image prompt % not found on post %', p_prompt_id, p_post_id;
  END IF;

  -- Excluding the hero: clear hero first, then set excluded. Two
  -- statements so each row is valid against the
  -- excluded_from_publish ↔ is_chapter_hero CHECK at every step.
  IF p_excluded AND v_was_hero THEN
    UPDATE story_image_prompts
       SET is_chapter_hero = false
     WHERE story_image_prompts.id = p_prompt_id;
  END IF;

  UPDATE story_image_prompts
     SET excluded_from_publish = p_excluded
   WHERE story_image_prompts.id = p_prompt_id;

  RETURN QUERY
    SELECT sip.id AS out_id,
           sip.excluded_from_publish AS out_excluded_from_publish,
           sip.is_chapter_hero AS out_is_chapter_hero,
           (p_excluded AND v_was_hero) AS out_hero_was_cleared
      FROM story_image_prompts sip
     WHERE sip.id = p_prompt_id;
END;
$$;
