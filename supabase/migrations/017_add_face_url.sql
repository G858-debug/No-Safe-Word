-- Add face_url column to story_characters for storing the approved face image URL
-- separately from the final portrait. Needed for the two-stage face→body pipeline
-- where the face is generated first (Flux Krea for females, Nano Banana for males)
-- and then used as a reference for body generation (ReActor face-swap or Nano Banana ref).
ALTER TABLE story_characters ADD COLUMN IF NOT EXISTS face_url text;
