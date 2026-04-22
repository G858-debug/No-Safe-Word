-- payfast_itn_events: idempotency log for the PayFast ITN webhook.
--
-- The handler inserts one row per ITN keyed on pf_payment_id (PayFast's
-- own transaction id) BEFORE running any business logic. A duplicate
-- ITN retry collides on the primary key (Postgres error 23505), the
-- handler catches that and returns 200 OK without re-processing the
-- payment. Any other insert error (including 42P01 "relation does not
-- exist" before this migration is applied) returns 500 so PayFast keeps
-- retrying until the schema catches up.
--
-- raw_payload preserves the full ITN body for forensics on disputes.

create table if not exists public.payfast_itn_events (
  pf_payment_id text primary key,
  m_payment_id text,
  received_at timestamptz not null default now(),
  payment_status text,
  raw_payload jsonb not null
);

create index if not exists payfast_itn_events_m_payment_id_idx
  on public.payfast_itn_events (m_payment_id);
