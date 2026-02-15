-- Add secondary_character_id and secondary_character_name to story_image_prompts
-- so scenes featuring two characters can reference both approved portraits,
-- keeping both characters visually consistent across all story images.
ALTER TABLE public.story_image_prompts
  ADD COLUMN IF NOT EXISTS secondary_character_name text,
  ADD COLUMN IF NOT EXISTS secondary_character_id uuid REFERENCES public.characters(id);
