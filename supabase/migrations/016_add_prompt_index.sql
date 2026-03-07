-- Add prompt_index column to nsw_lora_images for index-based slot matching.
-- Previously images were matched to UI grid slots by exact prompt text,
-- which breaks when users edit prompts. Index-based matching is stable.

ALTER TABLE nsw_lora_images ADD COLUMN prompt_index integer;

-- One image per slot per session. NULL-filtered so old records coexist.
CREATE UNIQUE INDEX nsw_lora_images_session_prompt_idx
  ON nsw_lora_images(session_id, prompt_index) WHERE prompt_index IS NOT NULL;
