-- Generation evaluations table for the intelligent evaluate-and-retry pipeline.
-- Stores per-attempt evaluation scores, failure categories, and correction actions
-- for the prompt learning system to query.

CREATE TABLE generation_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  prompt_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,

  -- Scene classification (two-level grouping)
  composition_type TEXT NOT NULL CHECK (composition_type IN ('solo', '1boy_1girl', '1girl_1girl', '1boy_1boy', 'group')),
  content_mode TEXT NOT NULL CHECK (content_mode IN ('sfw', 'nsfw')),

  -- Prompt data
  original_prose TEXT NOT NULL,
  booru_tags TEXT NOT NULL,

  -- Generation parameters used for this attempt
  generation_params JSONB NOT NULL DEFAULT '{}',

  -- Evaluation scores (1-5, null if not evaluated)
  person_count_expected INTEGER NOT NULL,
  person_count_detected INTEGER,
  setting_score SMALLINT CHECK (setting_score BETWEEN 1 AND 5),
  clothing_score SMALLINT CHECK (clothing_score BETWEEN 1 AND 5),
  pose_score SMALLINT CHECK (pose_score BETWEEN 1 AND 5),
  lighting_score SMALLINT CHECK (lighting_score BETWEEN 1 AND 5),
  composition_score SMALLINT CHECK (composition_score BETWEEN 1 AND 5),
  character_distinction_score SMALLINT CHECK (character_distinction_score BETWEEN 1 AND 5),
  overall_score DECIMAL,

  -- Result
  passed BOOLEAN NOT NULL DEFAULT false,
  failure_categories TEXT[] NOT NULL DEFAULT '{}',

  -- Correction plan applied for the next attempt (null on final attempt or pass)
  corrections_applied JSONB,

  -- Evaluation metadata
  eval_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  raw_eval_response JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query by prompt (get all attempts for an image prompt)
CREATE INDEX idx_gen_evals_prompt ON generation_evaluations(prompt_id);

-- Query by composition type + pass/fail (for learning system)
CREATE INDEX idx_gen_evals_composition ON generation_evaluations(composition_type, passed);

-- Query by composition type + content mode + pass/fail (for mode-specific learnings)
CREATE INDEX idx_gen_evals_mode ON generation_evaluations(composition_type, content_mode, passed);
