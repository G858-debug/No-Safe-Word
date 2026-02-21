-- Character LoRA training pipeline tables
-- Stores trained LoRA files and dataset images for character identity preservation

-- Character LoRAs — trained model files
CREATE TABLE IF NOT EXISTS character_loras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL DEFAULT '',
  storage_url TEXT,
  file_size_bytes INTEGER,
  trigger_word TEXT NOT NULL DEFAULT 'tok',
  base_model TEXT NOT NULL DEFAULT 'sdxl',
  training_provider TEXT NOT NULL DEFAULT 'replicate',
  training_id TEXT,
  training_params JSONB NOT NULL DEFAULT '{}',
  dataset_size INTEGER NOT NULL DEFAULT 0,
  validation_score DECIMAL,
  training_attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating_dataset', 'evaluating', 'captioning', 'training', 'validating', 'deployed', 'failed', 'archived')),
  error TEXT,
  pipeline_type TEXT NOT NULL DEFAULT 'story_character'
    CHECK (pipeline_type IN ('story_character', 'author_persona')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deployed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_character_loras_character ON character_loras(character_id);
CREATE INDEX IF NOT EXISTS idx_character_loras_status ON character_loras(status);

-- Dataset images — individual training images for a LoRA
CREATE TABLE IF NOT EXISTS lora_dataset_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lora_id UUID NOT NULL REFERENCES character_loras(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  variation_type TEXT NOT NULL
    CHECK (variation_type IN ('angle', 'expression', 'lighting', 'clothing', 'framing')),
  source TEXT NOT NULL DEFAULT 'nano-banana'
    CHECK (source IN ('nano-banana', 'comfyui')),
  category TEXT NOT NULL DEFAULT 'face-closeup'
    CHECK (category IN ('face-closeup', 'head-shoulders', 'waist-up', 'full-body', 'body-detail')),
  eval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (eval_status IN ('pending', 'passed', 'failed', 'replaced')),
  eval_score DECIMAL,
  eval_details JSONB,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lora_dataset_images_lora ON lora_dataset_images(lora_id);
CREATE INDEX IF NOT EXISTS idx_lora_dataset_images_status ON lora_dataset_images(eval_status);

-- Link story_characters to their active LoRA
ALTER TABLE story_characters
  ADD COLUMN IF NOT EXISTS active_lora_id UUID REFERENCES character_loras(id);

-- Auto-update timestamps on character_loras
DROP TRIGGER IF EXISTS character_loras_updated_at ON character_loras;
CREATE TRIGGER character_loras_updated_at
  BEFORE UPDATE ON character_loras
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
