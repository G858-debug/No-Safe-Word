-- Replace set_image_excluded(uuid, uuid, boolean) to fix an ambiguous
-- column reference. The previous version (in
-- 20260503100000_add_excluded_from_publish.sql, since corrected in
-- place) used unprefixed OUT parameter names that plpgsql treated as
-- shadowing variables — the UPDATE statements inside then raised
-- ERROR 42702 ("column reference 'id' is ambiguous").
--
-- DROP-then-CREATE is required because the OUT signature changed
-- (rename id → out_id, etc.); CREATE OR REPLACE rejects return-type
-- changes. Callers reading this RPC's result map the out_ columns
-- back to their natural names in TypeScript.

DROP FUNCTION IF EXISTS set_image_excluded(uuid, uuid, boolean);

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
