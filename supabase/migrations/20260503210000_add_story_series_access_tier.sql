-- Add access_tier to story_series.
--
-- Why now:
--   `checkSeriesAccess` (apps/web/lib/access.ts) currently requires
--   either a row in nsw_purchases or an active nsw_subscriptions row
--   for any chapter >= 2 of any story. That's correct for the upcoming
--   paid catalogue, but wrong for "the-wrong-one" which is published
--   as free-with-email-signup. Authenticated readers were being
--   dropped onto the gate for chapter 2+ even though their session
--   was healthy.
--
-- Why an enum-shaped column instead of a boolean is_free:
--   Story #2 launches paid in a few weeks, and we'll likely add a
--   subscription-only tier after that. Keeping the column as TEXT with
--   a CHECK constraint costs nothing today and avoids re-migrating in
--   two weeks. Two values for now; extend the CHECK list when more
--   tiers exist.
--
-- Default 'paid' so any new story_series row inherits the gated
-- behaviour by default — accidentally-free stories are worse than
-- accidentally-gated ones (a misconfigured paid story still works,
-- a misconfigured free story leaks paid content).

alter table public.story_series
  add column access_tier text not null default 'paid'
  check (access_tier in ('free_authenticated', 'paid'));

-- Seed the only currently-free story.
update public.story_series
  set access_tier = 'free_authenticated'
  where slug = 'the-wrong-one';

comment on column public.story_series.access_tier is
  'Access model for chapters >= 2 of this series. '
  '''free_authenticated'' = any signed-in user gets full access. '
  '''paid'' = requires nsw_purchases row OR active nsw_subscriptions row. '
  'Chapter 1 of every series is free regardless of tier.';
