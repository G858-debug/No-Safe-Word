-- V4 Pipeline: Flux 2 Pro engine (Replicate, multi-reference, no LoRAs/PuLID)

ALTER TABLE story_series
  DROP CONSTRAINT IF EXISTS story_series_image_engine_check;
ALTER TABLE story_series
  ADD CONSTRAINT story_series_image_engine_check
    CHECK (image_engine IN ('kontext', 'nb2_uncanny', 'flux_pulid', 'flux2_pro'));
