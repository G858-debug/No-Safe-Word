-- V4 Pipeline: Add pony_cyberreal engine (Pony V6 / CyberRealistic Pony on RunPod/ComfyUI)

ALTER TABLE story_series
  DROP CONSTRAINT IF EXISTS story_series_image_engine_check;
ALTER TABLE story_series
  ADD CONSTRAINT story_series_image_engine_check
    CHECK (image_engine IN ('kontext', 'nb2_uncanny', 'flux_pulid', 'flux2_pro', 'pony_cyberreal'));
