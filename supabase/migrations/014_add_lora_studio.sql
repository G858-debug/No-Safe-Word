-- LoRA Training Studio tables and storage buckets

-- Sessions table: tracks a complete LoRA training run
CREATE TABLE nsw_lora_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'anime_generation'
                           CHECK (status IN (
                             'anime_generation',
                             'anime_approval',
                             'flux_conversion',
                             'flux_approval',
                             'captioning',
                             'training',
                             'complete'
                           )),
  target_approved_count  integer NOT NULL DEFAULT 100,
  replicate_training_id  text,
  replicate_training_url text,
  lora_output_url        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Images table: every image tracked through the pipeline
CREATE TABLE nsw_lora_images (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL REFERENCES nsw_lora_sessions(id) ON DELETE CASCADE,
  stage                 text NOT NULL
                          CHECK (stage IN ('anime', 'converted')),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',
                            'generating',
                            'ready',
                            'approved',
                            'rejected'
                          )),
  anime_prompt          text,
  anime_image_url       text,
  converted_image_url   text,
  caption               text,
  human_approved        boolean,
  ai_approved           boolean,
  ai_rejection_reason   text,
  replicate_prediction_id text,
  pose_category         text,
  lighting_category     text,
  clothing_state        text,
  angle_category        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Index for common query patterns
CREATE INDEX nsw_lora_images_session_id_idx ON nsw_lora_images(session_id);
CREATE INDEX nsw_lora_images_status_idx ON nsw_lora_images(session_id, status);

-- updated_at trigger function (reuse pattern from other tables)
CREATE OR REPLACE FUNCTION nsw_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nsw_lora_sessions_updated_at
  BEFORE UPDATE ON nsw_lora_sessions
  FOR EACH ROW EXECUTE FUNCTION nsw_set_updated_at();

CREATE TRIGGER nsw_lora_images_updated_at
  BEFORE UPDATE ON nsw_lora_images
  FOR EACH ROW EXECUTE FUNCTION nsw_set_updated_at();

-- Storage buckets (private — no public access)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('lora-anime-images',     'lora-anime-images',     false),
  ('lora-converted-images', 'lora-converted-images', false)
ON CONFLICT (id) DO NOTHING;