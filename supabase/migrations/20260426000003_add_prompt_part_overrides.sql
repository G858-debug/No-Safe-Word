ALTER TABLE story_image_prompts
  ADD COLUMN clothing_override text,
  ADD COLUMN sfw_constraint_override text,
  ADD COLUMN visual_signature_override text;
