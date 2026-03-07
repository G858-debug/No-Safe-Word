-- Add lora-training-datasets storage bucket (public — Replicate must download from it)
INSERT INTO storage.buckets (id, name, public)
VALUES ('lora-training-datasets', 'lora-training-datasets', true)
ON CONFLICT (id) DO NOTHING;

-- Track the packaged dataset ZIP URL on the session
ALTER TABLE nsw_lora_sessions
  ADD COLUMN IF NOT EXISTS dataset_zip_url text;