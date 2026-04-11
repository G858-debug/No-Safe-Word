-- Add intent_score column to generation_evaluations.
-- Tracks how well the generated image conveys the narrative intent
-- of the original prose description (scored 1-5 by Claude Vision).
ALTER TABLE generation_evaluations
ADD COLUMN intent_score NUMERIC(3,1) DEFAULT NULL;
