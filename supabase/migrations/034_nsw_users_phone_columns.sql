-- Add phone and channel tracking columns to nsw_users for WhatsApp PIN auth.

ALTER TABLE nsw_users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS both_channels_bonus BOOLEAN NOT NULL DEFAULT false;

-- Allow looking up users by phone
CREATE INDEX IF NOT EXISTS idx_nsw_users_phone ON nsw_users(phone) WHERE phone IS NOT NULL;
