-- Add human approval step for LoRA training datasets
-- Pipeline pauses after evaluation for human review before training begins.

-- 1. Add human_approved column to lora_dataset_images
ALTER TABLE lora_dataset_images ADD COLUMN human_approved boolean DEFAULT NULL;

-- 2. Update character_loras status constraint to include 'awaiting_dataset_approval'
ALTER TABLE character_loras DROP CONSTRAINT IF EXISTS character_loras_status_check;
ALTER TABLE character_loras ADD CONSTRAINT character_loras_status_check
  CHECK (status IN ('pending', 'generating_dataset', 'evaluating', 'awaiting_dataset_approval', 'captioning', 'training', 'validating', 'deployed', 'failed', 'archived'));
