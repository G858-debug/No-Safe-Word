-- Add image_engine column to story_series to support multiple generation engines.
-- 'sdxl' = existing RunPod/ComfyUI pipeline (IPAdapter, FaceDetailer, LoRAs)
-- 'kontext' = Flux Kontext [dev] pipeline (reference image-based, no LoRAs)
ALTER TABLE story_series
ADD COLUMN image_engine TEXT NOT NULL DEFAULT 'sdxl'
CHECK (image_engine IN ('sdxl', 'kontext'));

COMMENT ON COLUMN story_series.image_engine IS 'Image generation engine: sdxl (existing RunPod/ComfyUI pipeline) or kontext (Flux Kontext dev)';
