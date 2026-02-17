-- Track how many times a portrait has been regenerated.
-- Used by progressive refinement to adjust generation parameters on each retry.
ALTER TABLE public.story_characters ADD COLUMN IF NOT EXISTS regen_count integer NOT NULL DEFAULT 0;
