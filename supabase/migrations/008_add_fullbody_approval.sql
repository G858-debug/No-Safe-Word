-- Add full-body image approval columns to story_characters
-- Allows characters to have both a portrait AND full-body image approved independently

ALTER TABLE story_characters
  ADD COLUMN approved_fullbody boolean NOT NULL DEFAULT false,
  ADD COLUMN approved_fullbody_image_id uuid REFERENCES images(id),
  ADD COLUMN approved_fullbody_seed integer,
  ADD COLUMN approved_fullbody_prompt text;
