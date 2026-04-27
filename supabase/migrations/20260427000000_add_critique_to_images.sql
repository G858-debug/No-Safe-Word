-- Add AI critique column to images table.
-- Populated by POST /api/stories/images/[promptId]/critique after generation.
ALTER TABLE images ADD COLUMN IF NOT EXISTS critique text;
