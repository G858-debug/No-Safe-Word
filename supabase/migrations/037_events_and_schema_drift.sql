-- Phase 0.4: Formalize drifted columns + events foundation
-- Safe to re-run — all operations are idempotent.

-- ─── Schema drift repair ──────────────────────────────────────────
-- These three columns were added out-of-band (dashboard SQL editor or
-- direct psql) and had no migration file. Re-creating them here as
-- IF NOT EXISTS is a no-op against production while making the schema
-- reproducible from source for a fresh database.
ALTER TABLE images
  ADD COLUMN IF NOT EXISTS stored_url TEXT;

ALTER TABLE nsw_subscriptions
  ADD COLUMN IF NOT EXISTS payfast_token TEXT;

ALTER TABLE nsw_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;

-- ─── Events table ─────────────────────────────────────────────────
-- Server-written conversion funnel analytics. Every event captures an
-- event_type (dot-notation identifier), optional user_id (null for
-- anonymous events), arbitrary metadata (JSONB), and a creation timestamp.
--
-- The application's service-role client inserts into this table.
-- Downstream: Phase 0.5 (Loops nurture triggers), Phase 0.6 (reading
-- history), and eventually a BI dashboard.
CREATE TABLE IF NOT EXISTS events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS events_event_type_created_at_idx
  ON events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS events_user_id_created_at_idx
  ON events (user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- Metadata GIN index for future queries filtering by metadata keys
CREATE INDEX IF NOT EXISTS events_metadata_gin_idx
  ON events USING GIN (metadata);

-- ─── RLS on events ────────────────────────────────────────────────
-- Events are server-written only. No client should be able to insert
-- or read events directly. The service role bypasses RLS.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Explicit "deny all" policy so unauthenticated / anon access is
-- impossible. Service role bypasses RLS so server code is unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'events' AND policyname = 'deny_all_by_default'
  ) THEN
    CREATE POLICY deny_all_by_default ON events
      FOR ALL TO authenticated, anon
      USING (false) WITH CHECK (false);
  END IF;
END $$;
