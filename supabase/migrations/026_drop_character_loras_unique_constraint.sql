-- Drop the unique constraint on (character_id, status) that was created directly
-- in Supabase (not via migrations). This constraint prevents characters from having
-- multiple records with the same status (e.g. multiple "failed" or "archived" records),
-- which breaks the training pipeline's retry and reset logic.
ALTER TABLE character_loras DROP CONSTRAINT IF EXISTS character_loras_character_id_status_key;
