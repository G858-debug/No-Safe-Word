-- Art Director job tracking.
-- Stores the full orchestration state across the 8-step pipeline,
-- including intent analysis, reference images, generation iterations,
-- and evaluation scores.

CREATE TABLE art_director_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to the story image prompt being art-directed
  prompt_id UUID NOT NULL,
  series_id UUID NOT NULL,

  -- Job lifecycle
  status TEXT NOT NULL DEFAULT 'analyzing'
    CHECK (status IN (
      'analyzing',           -- Steps 1-3: prompt analysis + reference search + ranking
      'awaiting_selection',  -- Step 4: waiting for user to pick a reference
      'generating',          -- Steps 5-8: recipe adaptation + generation + evaluation loop
      'completed',           -- Final image accepted
      'failed',              -- Unrecoverable error
      'cancelled'            -- User cancelled
    )),

  -- Step 1 output: structured intent analysis from Qwen VL
  intent_analysis JSONB,

  -- Steps 2-3 output: reference images with rankings
  reference_images JSONB,

  -- Step 4: user-selected CivitAI image ID
  selected_reference_id INTEGER,

  -- Step 5 output: adapted generation recipe
  adapted_recipe JSONB,

  -- Steps 6-8: generation iterations (array of IterationResult)
  iterations JSONB NOT NULL DEFAULT '[]',
  current_iteration INTEGER NOT NULL DEFAULT 0,
  best_iteration INTEGER,
  best_score DECIMAL,

  -- Final result
  final_image_url TEXT,
  final_image_id UUID REFERENCES images(id),

  -- Error tracking
  error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Find jobs by prompt
CREATE INDEX idx_art_director_prompt ON art_director_jobs(prompt_id);

-- Find active jobs
CREATE INDEX idx_art_director_active ON art_director_jobs(status)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');
