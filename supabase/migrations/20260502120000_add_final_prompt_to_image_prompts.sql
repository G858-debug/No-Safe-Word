-- Add final_prompt column to story_image_prompts.
--
-- The final prompt is the exact text sent to Siray for HunyuanImage 3.0
-- generation. It is drafted by Mistral Large (mistral-large-latest) from
-- the structured inputs (character descriptions, scene description,
-- clothing, SFW state, visual signature, brand colours, hunyuan-knowledge.md)
-- and then optionally edited by the user on the image card before
-- generation.
--
-- This replaces the deterministic assembleHunyuanPrompt() string-concat
-- path for the Hunyuan generation flow. Flux 2 Dev still goes through
-- the legacy path for now.

ALTER TABLE story_image_prompts
  ADD COLUMN final_prompt TEXT,
  ADD COLUMN final_prompt_drafted_at TIMESTAMPTZ;

COMMENT ON COLUMN story_image_prompts.final_prompt IS
  'Mistral-drafted (and optionally user-edited) final prompt text sent verbatim to Siray for HunyuanImage 3.0 scene generation. Null until first drafted. Replaces the deterministic assembleHunyuanPrompt() output.';

COMMENT ON COLUMN story_image_prompts.final_prompt_drafted_at IS
  'Timestamp of the most recent Mistral draft of final_prompt. Null if final_prompt has never been drafted.';
