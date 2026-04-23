# Deployment Notes

Operational follow-ups and CDN/infrastructure items that live outside
the codebase. Not tech debt — these are things to do in the admin
consoles (Cloudflare, Supabase dashboard, Railway) rather than in
pull requests.

---

## Cloudflare Page Rule / Transform Rule for `/story-covers/*`

**Status:** Recommended, not applied.

Cover composite JPEGs (`story-covers/{slug}/{size}-{w}x{h}-{hash}.jpg`)
are uploaded to Supabase Storage with
`Cache-Control: public, max-age=31536000, immutable`. Filenames are
content-hashed, so any regeneration produces a new URL. This makes
them safe to cache forever.

For best edge performance, configure a Cloudflare Page Rule (or
Transform Rule) on the production zone:

- **Match:** URLs matching `*/storage/v1/object/public/story-covers/*`
- **Edge cache TTL:** 1 year
- **Browser cache TTL:** Respect origin (honors the immutable header
  we already set) — OR explicitly set to 1 year
- **Cache level:** Cache everything

Variant files (`story-covers/{slug}/variants/variant-{0..3}.png`)
carry a short `max-age=60` header because their filenames are NOT
content-hashed and they're overwritten on retry. The Page Rule should
either exclude `/variants/` or cover it acceptably via the short
upstream Cache-Control — Cloudflare will honor our 60s by default if
"Respect origin" is used for browser TTL.

If you want a single rule that does the right thing for both, use a
**Transform Rule** that sets `Cache-Control` based on path:
- `story-covers/*/variants/*` → `public, max-age=60`
- `story-covers/*` (everything else) → `public, max-age=31536000, immutable`

**Why this matters.** Covers appear on every story-detail page load,
every library render, every OG scraper fetch, and every email that
embeds one. Without CDN caching, every request hits Supabase's origin
over the public internet — cheap per-request but slow and rate-
limited under load.

---

## Supabase storage bucket tier

**Status:** Informational.

The `story-covers` bucket is public-read, backed by Supabase's
default storage tier. If bucket egress exceeds the bundled quota on
our Supabase plan, bill surfaces as a line item at ~$0.09/GB. Cover
sizes:

- hero ~500KB–1MB
- card ~80KB
- og ~150KB
- email ~120KB

Heavy traffic → hero is the expensive one. CDN caching (above) shifts
egress from Supabase to Cloudflare, where bandwidth is free on the
business plan.

---

## Railway instance memory (compositing)

**Status:** Informational.

`composite-cover` runs satori + resvg + sharp sequentially across 4
sizes. The largest (hero, 1600×2400) holds ~15MB of PNG buffer during
resvg rasterization plus the JPEG encode step. Peak memory during a
hero composite is ~60–80MB.

Sequential-not-parallel compositing (see
[apps/web/app/api/stories/[seriesId]/composite-cover/route.ts](../apps/web/app/api/stories/[seriesId]/composite-cover/route.ts))
keeps peak memory bounded; parallel would 4× it and risk OOM on the
Hobby plan. Keep the loop sequential unless Railway's instance size
changes materially.

---

## Deploying covers + blurbs to prod

Order matters: 20260422210001 references columns added by
20260422210000.

1. Confirm prod is at migration
   `20260422190421_payfast_itn_idempotency` (latest applied). Check via
   `supabase migration list` against the production project.
2. Apply
   [supabase/migrations/20260423212844_story_covers_and_blurbs.sql](../supabase/migrations/20260423212844_story_covers_and_blurbs.sql).
   Adds cover/blurb columns to `story_series`; creates the
   `story-covers` storage bucket.
3. Apply
   [supabase/migrations/20260423212918_generation_jobs_cover_fields.sql](../supabase/migrations/20260423212918_generation_jobs_cover_fields.sql).
   Adds `job_type`, `variant_index`, `series_id` to `generation_jobs`;
   adds `cover_error` to `story_series`.
4. Deploy `apps/web` with the Prompts 1–4 changes and the Piece 2
   regenerate endpoints (`regenerate-blurbs`,
   `regenerate-cover-prompt`) from Prompt 5.
5. Optionally run `npm run backfill-cache-headers` from `apps/web`
   (see "Cache-Header Backfill" section below). Not required for
   functionality; only for CDN efficiency on pre-convention uploads.

Migration `20260421203854_nsw_users_drift_repair.sql` is **already
applied** on prod (it was pushed via the Supabase dashboard under that
timestamp during Phase 0.5b). The local file exists for parity and
will be skipped by `supabase db push` based on ledger version match —
no functional effect. Do NOT delete it locally; parity matters for
future branch-deploy flows.

---

## Migration naming convention (future cleanup)

**Status:** Known inconsistency, deferred cleanup.

Local files `038_nurture_started_at.sql` and
`040_payfast_itn_idempotency.sql` retain numeric prefixes while prod's
ledger has them under timestamped names
(`20260421203911_nurture_started_at`,
`20260422190421_payfast_itn_idempotency`). Both are idempotent DDL
with ledger entries already in place, so no functional problem — a
re-push would recreate the ledger entry under the numeric name and
the underlying DDL's `IF NOT EXISTS` guards prevent any data loss.

Consider a future housekeeping pass to rename both files to match
their existing prod ledger timestamps, bringing the local filesystem
and the remote ledger into full parity across the whole migration
history. Out of scope for the Covers & Blurbs work; logged here so the
next person touching migrations knows the state.

---

## Cache-Header Backfill

**Status:** Script built, not run. One-shot optional task.

The `story-images` bucket contains objects uploaded before Prompt 3's
cache-control convention was established. Those objects were saved
with Supabase Storage's default TTL (~1 hour) rather than the
`public, max-age=31536000, immutable` header we now apply.

`apps/web/scripts/backfill-cache-headers.ts` iterates every object in
`story-images`, downloads the current bytes, and re-uploads with the
long-TTL header and `upsert: true`. Content is preserved — only the
response headers change.

**Scope.** `story-images` only (scene images). Does NOT touch
`story-covers`: composite uploads already carry the correct headers
from Prompt 3, and variant uploads intentionally use a 60-second TTL
because their filenames are not content-hashed.

**Cost.** Has non-zero bandwidth cost (download + re-upload per
object). Run once when you've decided you want to pay it. Not
required for functionality; only for CDN efficiency.

**Run:** `cd apps/web && npm run backfill-cache-headers`
