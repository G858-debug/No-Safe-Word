-- Purpose: Add a marketing-consent subscribers table and extend whatsapp_pins
--          with an email column so PIN codes can be looked up by email address
--          (the new gate keys verification on { email, code }, distinct from
--          the existing /access flow which keys on phone).
--
-- Email columns use the citext extension so equality comparisons and unique
-- constraints are case-insensitive automatically (Foo@x.com == foo@X.com).
-- Regex CHECKs still operate via the standard regex operators; we use the
-- case-insensitive ~* form for the email format check.
--
-- Columns added to whatsapp_pins:
--   email CITEXT NULL                   -- nullable; existing phone-keyed
--                                          rows continue to have NULL here
--
-- Columns in the new subscribers table:
--   id                          uuid PK
--   email                       citext NOT NULL UNIQUE
--   whatsapp_number             text NULL          (E.164)
--   email_marketing_consent     boolean NOT NULL DEFAULT false
--   whatsapp_marketing_consent  boolean NOT NULL DEFAULT false
--   source_series_slug          text NULL          (which story they joined from)
--   source_chapter_number       int  NULL          (which chapter triggered consent)
--   created_at                  timestamptz NOT NULL DEFAULT now()
--   consent_recorded_at         timestamptz NULL   (timestamp of latest consent flip)
--   unsubscribed_at             timestamptz NULL   (set when user unsubscribes;
--                                                    sticky — re-subscribe sets it back to NULL)
--
-- CHECK constraints on subscribers:
--   subscribers_email_valid       — email matches a permissive RFC-ish shape
--                                   (no whitespace, single @, dot in domain).
--                                   Strict address validation lives in app code;
--                                   this is a defence-in-depth guard.
--   subscribers_whatsapp_e164     — whatsapp_number, when present, is strict E.164
--                                   (^\+[1-9]\d{7,14}$). Matches the output of
--                                   the Phase C.2 phone parser.
--
-- RLS policy intent: server-only access, matching the existing
--   whatsapp_pins pattern (migration 033). Neither table enables Row
--   Level Security; both are written and read exclusively by server-side
--   route handlers using the Supabase service-role key (which bypasses
--   RLS regardless). The anon and authenticated roles must never touch
--   these tables — if a future change adds a client-side reader, that
--   change must enable RLS and add explicit policies first.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- 1. whatsapp_pins.email
-- ---------------------------------------------------------------------------
-- Nullable so the existing phone-keyed PIN flow is unaffected. The new
-- email-keyed flow (POST /api/auth/request-access → /api/auth/verify-code,
-- coming in Phase D) will populate this column when delivering a PIN
-- alongside the email magic link.

ALTER TABLE whatsapp_pins
  ADD COLUMN IF NOT EXISTS email CITEXT;

-- Verification lookup for the email-keyed flow: find the latest unverified,
-- unexpired PIN for an email address. Partial — phone-only rows (the
-- existing flow) don't bloat the index. Case-insensitivity is inherited
-- from citext, so 'Foo@x.com' and 'foo@x.com' resolve to the same bucket.
CREATE INDEX IF NOT EXISTS idx_whatsapp_pins_email_created
  ON whatsapp_pins (email, created_at DESC)
  WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. subscribers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subscribers (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       citext NOT NULL,
  whatsapp_number             text NULL,
  email_marketing_consent     boolean NOT NULL DEFAULT false,
  whatsapp_marketing_consent  boolean NOT NULL DEFAULT false,
  source_series_slug          text NULL,
  source_chapter_number       int  NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  consent_recorded_at         timestamptz NULL,
  unsubscribed_at             timestamptz NULL,
  CONSTRAINT subscribers_email_unique UNIQUE (email),
  CONSTRAINT subscribers_email_valid CHECK (
    email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  CONSTRAINT subscribers_whatsapp_e164 CHECK (
    whatsapp_number IS NULL OR whatsapp_number ~ '^\+[1-9]\d{7,14}$'
  )
);

-- WhatsApp lookup for STOP-handling and re-auth — we look up subscribers
-- by phone number when an inbound WhatsApp message arrives. Partial so
-- email-only subscribers don't bloat the index.
CREATE INDEX IF NOT EXISTS subscribers_whatsapp_idx
  ON subscribers (whatsapp_number)
  WHERE whatsapp_number IS NOT NULL;

-- Created-at ordering for admin dashboards / exports.
CREATE INDEX IF NOT EXISTS subscribers_created_at_idx
  ON subscribers (created_at);
