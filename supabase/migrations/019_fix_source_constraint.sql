-- Fix: Allow 'sdxl-img2img' as a source for female body shots in LoRA datasets.
-- Without this, the SDXL→Flux img2img body generation pipeline fails on INSERT.

ALTER TABLE lora_dataset_images DROP CONSTRAINT IF EXISTS lora_dataset_images_source_check;
ALTER TABLE lora_dataset_images ADD CONSTRAINT lora_dataset_images_source_check
  CHECK (source IN ('nano-banana', 'comfyui', 'sdxl-img2img'));
