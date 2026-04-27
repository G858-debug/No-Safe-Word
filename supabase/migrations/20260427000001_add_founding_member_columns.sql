-- Phase 0.5f: Founding Members — add columns to nsw_subscriptions

alter table public.nsw_subscriptions
  add column if not exists is_founding_member boolean not null default false,
  add column if not exists locked_rate_cents integer,
  add column if not exists rate_locked_until timestamptz;

-- Partial index to make the founding-member count query fast
create index if not exists subscriptions_founding_active_idx
  on public.nsw_subscriptions (is_founding_member)
  where is_founding_member = true and status = 'active';

comment on column public.nsw_subscriptions.is_founding_member is
  'True for the first 100 paying subscribers. Locks rate at signup price.';
comment on column public.nsw_subscriptions.locked_rate_cents is
  'The rate (in cents, ZAR) locked for this subscriber. NULL for non-founding.';
comment on column public.nsw_subscriptions.rate_locked_until is
  'When the locked rate expires and the subscriber moves to market rate.';
