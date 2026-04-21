-- Phase 0.5b: nurture sequence first-time dispatch guard.
-- Non-null ⇒ user_created event has been dispatched to Resend Automations.
-- Null ⇒ either a brand-new user or a pre-0.5b user who hasn't triggered the guard yet.
--
-- Set atomically via:
--   UPDATE nsw_users SET nurture_started_at = now()
--   WHERE auth_user_id = $1 AND nurture_started_at IS NULL
--   RETURNING id;
--
-- Returns the row only on the first matching call, so the dispatch fires exactly once.

alter table public.nsw_users
  add column if not exists nurture_started_at timestamptz;

comment on column public.nsw_users.nurture_started_at is
  'Timestamp when user_created event was dispatched to Resend nurture automation. '
  'Null = not yet dispatched. Set atomically via UPDATE ... WHERE nurture_started_at IS NULL RETURNING id.';
