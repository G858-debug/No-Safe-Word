ALTER TABLE story_image_prompts
  ADD COLUMN suppress_character_block boolean NOT NULL DEFAULT false;
