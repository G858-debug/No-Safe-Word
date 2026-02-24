-- Track which stage the pipeline last completed successfully.
-- Enables automatic resume from the correct point after a crash or restart.
ALTER TABLE character_loras
  ADD COLUMN IF NOT EXISTS completed_stage text;
