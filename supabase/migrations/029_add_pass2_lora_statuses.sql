-- Add Pass 2 pipeline statuses to the character_loras status check constraint.
-- The code already uses these statuses but the DB constraint was missing them,
-- causing silent status update failures during Pass 2 pipeline execution.

ALTER TABLE character_loras DROP CONSTRAINT character_loras_status_check;

ALTER TABLE character_loras ADD CONSTRAINT character_loras_status_check
  CHECK (status = ANY (ARRAY[
    'pending',
    'generating_dataset',
    'evaluating',
    'awaiting_dataset_approval',
    'captioning',
    'training',
    'validating',
    -- Pass 2 statuses
    'generating_pass2_dataset',
    'evaluating_pass2',
    'awaiting_pass2_approval',
    'captioning_pass2',
    'training_pass2',
    'validating_pass2',
    -- Terminal
    'deployed',
    'failed',
    'archived'
  ]));
