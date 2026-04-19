-- IMPORTED from remote migration 20260406050132 on 2026-04-19
-- Original applied date: 2026-04-06 05:01:32 UTC
-- This file documents an out-of-band schema change.
-- The migration tracker already considers this applied in production.
-- Re-applying this locally against a fresh database should produce the same result.


-- Add juggernaut_ragnarok to the allowed image_engine values
ALTER TABLE story_series DROP CONSTRAINT story_series_image_engine_check;
ALTER TABLE story_series ADD CONSTRAINT story_series_image_engine_check
  CHECK (image_engine = ANY (ARRAY['kontext', 'nb2_uncanny', 'flux_pulid', 'pony_cyberreal', 'juggernaut_ragnarok']));
