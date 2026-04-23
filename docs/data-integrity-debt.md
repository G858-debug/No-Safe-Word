# Data Integrity Debt

Database-level constraints that should exist to make invariants
structural rather than query-time. Each entry describes a gap that is
currently enforced in application code (or not at all) and what the
structural fix looks like.

When you pick one up, do it as a dedicated data-integrity hardening
pass — batch the constraints into a single migration, run it against
a fresh database copy to catch existing violations, and fix any
orphan rows before applying.

---

## `story_characters.role` has no CHECK constraint

**Current state.** `story_characters.role` is `TEXT NOT NULL` with no
enumeration constraint. Any string can be written. The TypeScript
`CharacterImport.role` union (`protagonist | love_interest |
supporting | antagonist` in [packages/shared/src/story-types.ts](../packages/shared/src/story-types.ts))
is the only gate, and it only fires at import time via
`validateImportPayload()` — a direct DB write would bypass it.

**Risk.** Cover generation and any other role-aware logic must match
on exact strings. A typo (`"Protagonist"`, `"love interest"`,
`"male_lead"`) in a backfill script or a direct SQL insert would
silently produce rows that no query matches, leaving the UI in an
inconsistent state.

**Structural fix.**

```sql
ALTER TABLE story_characters
  ADD CONSTRAINT story_characters_role_check
  CHECK (role IN ('protagonist', 'love_interest', 'supporting', 'antagonist'));
```

Before applying, query for violations:

```sql
SELECT id, series_id, role
FROM story_characters
WHERE role NOT IN ('protagonist', 'love_interest', 'supporting', 'antagonist');
```

Fix any offending rows before the migration lands.

**Added:** 2026-04-22 (Covers & Blurbs Prompt 2 diagnostic).

---

## Multiple `role='protagonist'` rows allowed per series

**Current state.** `story_characters` has `UNIQUE(series_id,
character_id)` but no uniqueness constraint on
`(series_id, role)`, so nothing at the DB level prevents a story from
having two characters tagged as protagonist.

**Application-level enforcement.** The cover-generation endpoint
(`POST /api/stories/[seriesId]/generate-cover`) counts approved
protagonists at query time and fails with a clear error if the count
isn't exactly 1. Similarly enforces ≤1 approved love_interest.

**Risk.** The invariant lives in one endpoint. A future code path
that needs "the protagonist" has to re-derive the same check or risk
picking the wrong row. Stage 7 imports with malformed role data
(two characters labeled protagonist) land successfully and only fail
later when the cover step runs.

**Structural fix.**

```sql
CREATE UNIQUE INDEX story_characters_one_protagonist_per_series
  ON story_characters (series_id)
  WHERE role = 'protagonist';
```

A parallel index for `love_interest` is defensible if we decide
exactly-one love interest should also be structural. Currently the
cover endpoint tolerates zero love interests (cover uses protagonist
only in that case), so the constraint would have to be partial-
optional, which PostgreSQL doesn't express cleanly — a `CHECK` or a
trigger would be needed. Defer until the product behavior is stable.

Before applying the protagonist index, find offenders:

```sql
SELECT series_id, COUNT(*) AS protagonist_count
FROM story_characters
WHERE role = 'protagonist'
GROUP BY series_id
HAVING COUNT(*) > 1;
```

**Added:** 2026-04-22 (Covers & Blurbs Prompt 2 diagnostic).

---

## Orphan composite files accumulate in `story-covers/{slug}/`

**Current state.** Every `composite-cover` run writes JPEGs at paths
that include a content hash in the filename:
`story-covers/{slug}/{size}-{width}x{height}-{contentHash}.jpg`.
`story_series.cover_sizes` is updated to point at the new filenames.
The old composites are **not deleted** — they remain in the bucket
unreferenced.

**Why this design.** OG scrapers (Facebook, Twitter, LinkedIn, iMessage
link previews) cache aggressively by URL. A stable filename with new
content would produce stale previews. Content-hashed filenames
guarantee refetch on regeneration, at the cost of storage churn.

**Risk.** A single slug regenerated 10 times accrues 40 orphan JPEGs.
Per size, hero is ~500KB–1MB, card ~80KB, og/email ~100–200KB. Ten
regens ≈ 20MB. Not a short-term problem; a long-term problem if covers
are iterated heavily across many series.

**Structural fix options (pick one during the cleanup pass).**

1. **Scheduled sweep.** Daily job that lists every file in
   `story-covers/{slug}/` and deletes any not referenced by the
   series' current `cover_sizes` map. Simple and safe. Runs via
   Supabase cron or an external scheduler.
2. **Delete on overwrite.** `composite-cover` reads the prior
   `cover_sizes` before updating, deletes those 4 URLs after the new
   ones are uploaded and the DB is updated. Risk: a composite-cover
   that crashes mid-way can orphan *new* files before the DB update;
   a delete-after-commit strategy handles this cleanly.
3. **Hybrid.** Delete on overwrite for normal flow, plus a weekly
   sweep as a safety net.

Recommend option 1 for the cleanup pass — it handles not just the
overwrite case but also any orphans from manual ops (e.g. a test
import that was later deleted).

**Added:** 2026-04-22 (Covers & Blurbs Prompt 3 compositing).
