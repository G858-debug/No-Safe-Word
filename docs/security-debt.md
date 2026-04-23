# Security Debt

Deferred security hardening items. Each entry describes a known gap that
is acceptable for MVP but must be revisited before scale. When you pick
one up, do it as a dedicated hardening pass — don't fix in isolation,
or you'll introduce inconsistency debt that's worse than the status quo.

---

## Storage bucket write protection — rely on service-role key discipline

**Buckets affected:** `lora-anime-images`, `lora-converted-images`,
`lora-training-datasets`, `story-images`, `story-covers`.

**Current state.** Write protection comes from two things:

1. The Supabase bucket-level `public` flag (controls read).
2. Discipline in the codebase: all writes to these buckets are made
   from server-side API routes using the Supabase service-role key.
   Client-side (anon-key) writes are not wired up anywhere.

**What's missing.** There are **no explicit RLS policies on
`storage.objects`** for any of these buckets. If a future code change
accidentally exposes the service-role key to the client, or if someone
adds a client-side upload path using the anon key, Supabase's default
policies would allow writes that the current codebase implicitly
forbids.

**Why this is acceptable now.** Every write path is server-only and
reviewed. The service-role key is not shipped to the client bundle.
Introducing RLS policies on just one bucket (e.g. `story-covers`) while
leaving the others bare creates a two-access-model codebase that future
maintainers have to reason about — worse than a single documented gap.

**Fix scope when revisited.**

- Add `storage.objects` INSERT/UPDATE/DELETE policies that explicitly
  require the service-role JWT claim (or a named role) for every
  bucket listed above.
- Keep public-read policies for the buckets that are intentionally
  public (`lora-training-datasets`, `story-images`, `story-covers`).
- Add a CI check that fails the build if a new bucket is added without
  a corresponding policy migration.
- Rotate the service-role key at the same time as part of the pass.

**Added:** 2026-04-22 (Covers & Blurbs Prompt 1 foundation work).

---

## No shared-secret authentication between internal route calls

**Context.** The `approve-cover` route fires a fire-and-forget POST to
`/api/stories/{seriesId}/composite-cover` after writing the variant
selection (so compositing runs without blocking the UI response). The
internal URL is derived from the incoming request's `host` header and
the request carries an `X-Internal-Call: 1` marker.

**Current state.** `X-Internal-Call` is a hint, not a credential. The
composite-cover endpoint does not verify it. Any caller that can reach
the Story Publisher's Next.js server — which in production is anyone
with network access to the Railway-hosted origin — can trigger
`composite-cover` directly. Cover compositing is an idempotent,
bounded-cost operation (~15–30s of CPU, 4 storage uploads), so the
attack surface is noisy but not structurally dangerous.

**Risk.** A low-effort abuse path exists: an outside actor who has
discovered a `seriesId` can repeatedly POST to `composite-cover` to
churn CPU. Cost is bounded because each pass overwrites
content-hashed filenames idempotently and transitions status through
a guarded state machine (returns 400 if not in `approved`/`complete`).

**Why this is acceptable now.** The Story Publisher is single-tenant
(one admin user) and the `seriesId` UUIDs aren't enumerated publicly.
The standard auth cookie already gates the dashboard surface that
produces the seriesIds. The compositor route itself being
discoverable-but-noisy is a downgrade from "unauthenticated" only in
theory.

**Fix scope when revisited.**

- Introduce an `INTERNAL_CALL_SECRET` env var. Every internal-only
  route reads it at cold start and rejects requests lacking
  `X-Internal-Call-Secret: <value>`.
- Rotate when revisiting the storage-bucket RLS pass above.
- Consider a pattern where internal routes bind to a separate
  loopback-only port in production — obviates the secret but costs
  deployment complexity.

**Added:** 2026-04-22 (Covers & Blurbs Prompt 3 compositing wiring).
