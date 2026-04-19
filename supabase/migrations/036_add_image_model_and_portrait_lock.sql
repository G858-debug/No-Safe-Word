-- ============================================================
-- Image generation pivot: dual-model architecture
-- ============================================================
-- Pivot from "Art Director + Juggernaut Ragnarok" to per-story
-- model selection between:
--   flux2_dev  -- Flux 2 Dev on RunPod via ComfyUI (reference-image consistency)
--   hunyuan3   -- HunyuanImage 3.0 on Replicate (prompt-injection consistency)
--
-- The legacy story_series.image_engine column is retained for
-- backward compatibility with existing code paths (notably
-- /api/stories/[seriesId]/generate-images-v4) but image_model
-- is the new authoritative field driving the active pipeline.
-- All new code should read image_model; image_engine should be
-- treated as read-only legacy metadata.
-- ============================================================

ALTER TABLE story_series
  ADD COLUMN image_model TEXT NOT NULL DEFAULT 'flux2_dev'
  CHECK (image_model IN ('flux2_dev', 'hunyuan3'));

COMMENT ON COLUMN story_series.image_model IS
  'Active image generation model: flux2_dev (Flux 2 Dev on RunPod) or hunyuan3 (HunyuanImage 3.0 on Replicate). Authoritative; supersedes image_engine.';

COMMENT ON COLUMN story_series.image_engine IS
  'LEGACY. Retained for backward compatibility with older pipelines. image_model is the authoritative field.';

-- Locked portrait prompt — the exact text that generated the
-- approved character portrait. Injected verbatim into every
-- scene prompt under the hunyuan3 model for identity
-- consistency; used as provenance/debug reference under
-- flux2_dev (which uses the image itself for consistency).
-- Null until the character's portrait has been approved.
ALTER TABLE story_characters
  ADD COLUMN portrait_prompt_locked TEXT;

COMMENT ON COLUMN story_characters.portrait_prompt_locked IS
  'Exact prompt text that produced the approved portrait. Injected into scene prompts for hunyuan3; retained for provenance under flux2_dev. Null until portrait approved.';