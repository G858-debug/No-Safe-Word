-- WhatsApp PIN authentication for story access.
-- Ephemeral PINs sent via WhatsApp, with rate limiting and lockout via DB queries.

CREATE TABLE whatsapp_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,                -- E.164 format (+27...)
  pin TEXT NOT NULL,                  -- 4-digit, stored plain (9000 possibilities = unhashable)
  story_slug TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,            -- NULL until successfully verified
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,           -- set after 5 failed attempts
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rate limit lookups: how many PINs sent to this phone in the last hour?
CREATE INDEX idx_whatsapp_pins_phone_created
  ON whatsapp_pins(phone, created_at DESC);

-- Verification lookups: find the latest unexpired, unverified PIN for a phone
CREATE INDEX idx_whatsapp_pins_verify
  ON whatsapp_pins(phone, expires_at DESC)
  WHERE verified_at IS NULL;
