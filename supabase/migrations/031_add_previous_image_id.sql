-- Add previous_image_id to story_image_prompts for single-level undo on regeneration.
-- When a user regenerates an image, the old image_id is saved here instead of being deleted.
-- The user can then revert to the previous image if they prefer it.

ALTER TABLE story_image_prompts
  ADD COLUMN previous_image_id uuid REFERENCES images(id);
