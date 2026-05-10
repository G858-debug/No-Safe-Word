# Series-Status Gate Fix — Phase A Plan

**Date:** 2026-05-10
**Scope:** Replace the face-only `images_pending` gate with a face+body gate, fired from both `/approve-face` and `/approve-body`.
**Status:** Plan only. No code modified yet.

---

## Headline

Three files touched. One new helper, one new helper test file, two route edits. No DB migration. Helper is idempotent and only advances when current status is `'draft'`, so callers don't need to know whether they're the action that completed the gate.

One honest constraint to surface up front: per the prompt's request to extend `portrait-routes.test.ts` with helper-fires assertions, the existing repo lacks the supabase module-mocking infrastructure required to test route integrations against a fake DB. The helper-level tests in `series-status.test.ts` exhaustively cover the gate logic; the route-level coverage gap is documented in-line and treated as a follow-up alongside the broader "approve-face / approve-body integration tests" gap already noted in `portrait-routes.test.ts`. See "Test plan adjustments" below.

---

## 1. New helper file

**Path:** `apps/web/lib/server/series-status.ts` (new, ~55 lines)

**Full content (proposed):**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Idempotent series-status advancement gate.
 *
 * Advances `story_series.status` from 'draft' to 'images_pending' iff
 * every character linked to this series has BOTH `approved_image_id`
 * AND `approved_fullbody_image_id` set on the base `characters` row.
 *
 * Returns `{ advanced: true }` only on the call that performs the
 * UPDATE. Returns `{ advanced: false }` for: status already past
 * 'draft', any character missing face or body, zero characters in the
 * series, or a DB error.
 *
 * Safe to call from /approve-face (face was the last unmet condition)
 * AND /approve-body (body was the last unmet condition) — whichever
 * action completes the gate triggers the advance; the other becomes
 * a no-op.
 */
export async function checkAndAdvanceToImagesPending(
  supabase: SupabaseClient,
  seriesId: string
): Promise<{ advanced: boolean }> {
  // 1. Status gate — only advance from 'draft'. Reading first lets us
  //    short-circuit before the join query, and surfaces the no-op case
  //    cleanly when the series is already past draft.
  const { data: series } = await supabase
    .from("story_series")
    .select("status")
    .eq("id", seriesId)
    .single();
  if (!series || series.status !== "draft") {
    return { advanced: false };
  }

  // 2. Every character in the series must have both face AND body
  //    approved on the base row.
  const { data: links } = await supabase
    .from("story_characters")
    .select(
      "character_id, characters:character_id ( approved_image_id, approved_fullbody_image_id )"
    )
    .eq("series_id", seriesId);
  if (!links || links.length === 0) {
    return { advanced: false };
  }

  const allReady = links.every((sc) => {
    const base = sc.characters as
      | {
          approved_image_id: string | null;
          approved_fullbody_image_id: string | null;
        }
      | {
          approved_image_id: string | null;
          approved_fullbody_image_id: string | null;
        }[]
      | null;
    const row = Array.isArray(base) ? base[0] : base;
    return (
      Boolean(row?.approved_image_id) &&
      Boolean(row?.approved_fullbody_image_id)
    );
  });
  if (!allReady) {
    return { advanced: false };
  }

  // 3. Advance.
  const { error } = await supabase
    .from("story_series")
    .update({ status: "images_pending" })
    .eq("id", seriesId);
  if (error) {
    return { advanced: false };
  }
  return { advanced: true };
}
```

---

## 2. `/approve-face` edit

**File:** `apps/web/app/api/stories/characters/[storyCharId]/approve-face/route.ts`

**Lines removed (current 143–164):**
```ts
    // 5. Series status advance — face-only gate (intentional, see header).
    const { data: seriesChars } = await supabase
      .from("story_characters")
      .select("character_id, characters:character_id ( approved_image_id )")
      .eq("series_id", storyChar.series_id);

    if (seriesChars && seriesChars.length > 0) {
      const allReady = seriesChars.every((sc) => {
        const base = sc.characters as
          | { approved_image_id: string | null }
          | { approved_image_id: string | null }[]
          | null;
        const row = Array.isArray(base) ? base[0] : base;
        return Boolean(row?.approved_image_id);
      });
      if (allReady) {
        await supabase
          .from("story_series")
          .update({ status: "images_pending" })
          .eq("id", storyChar.series_id);
      }
    }
```

**Lines added (replacement, ~3 lines):**
```ts
    // 5. Maybe advance series status to 'images_pending'. The helper
    //    requires every character in the series to have both face AND
    //    body approved before advancing.
    await checkAndAdvanceToImagesPending(supabase, storyChar.series_id);
```

**Import added (top of file):**
```ts
import { checkAndAdvanceToImagesPending } from "@/lib/server/series-status";
```

**Header docstring update** (replace the "face-only gate is a known issue" paragraph with the now-correct behaviour):
```ts
 * Series-status advancement to 'images_pending' fires via
 * checkAndAdvanceToImagesPending — gated on every character in the
 * series having both face AND body approved. Calling this endpoint when
 * face approval was the last unmet condition triggers the advance;
 * otherwise it's a no-op.
```

---

## 3. `/approve-body` edit

**File:** `apps/web/app/api/stories/characters/[storyCharId]/approve-body/route.ts`

**Two surgical changes:**

**(a) Extend the story_character SELECT** to include `series_id`. Currently selects only `id, character_id` (line 33–35). New:
```ts
    const { data: storyChar, error: scError } = await supabase
      .from("story_characters")
      .select("id, character_id, series_id")
      .eq("id", storyCharId)
      .single();
```

**(b) Add the helper call after the body UPDATE succeeds.** Insert after current line 103 (just before the `return NextResponse.json(...)` at line 105):
```ts
    // Body may have been the last unmet condition for series-status
    // advancement to 'images_pending'. Helper is idempotent — no-op
    // if face is missing on any sibling character or status is already
    // past draft.
    await checkAndAdvanceToImagesPending(supabase, storyChar.series_id);
```

**Import added (top of file):**
```ts
import { checkAndAdvanceToImagesPending } from "@/lib/server/series-status";
```

**Header docstring update** — extend the existing paragraph to mention the gate:
```ts
 * Returns 400 if face is not approved — body cannot be approved before
 * face under the new state model.
 *
 * After the body write, fires checkAndAdvanceToImagesPending — the
 * series advances to 'images_pending' iff every character now has both
 * face AND body approved. No-op otherwise.
```

---

## 4. New test file

**Path:** `apps/web/lib/server/series-status.test.ts` (new)

**Pattern:** `node:test` + hand-rolled supabase fake, mirroring [`portrait-cascade.test.ts`](apps/web/lib/server/portrait-cascade.test.ts).

**Cases (5, matching the prompt):**

1. **All face + body approved → advances.** Setup: 2 story_characters, both with linked characters that have `approved_image_id` AND `approved_fullbody_image_id` set. Series status `'draft'`. Assert `{ advanced: true }`, and the series row's status is now `'images_pending'`.

2. **All faces approved, one body missing → does NOT advance.** Setup: 2 story_characters; first character has both, second has face only (`approved_fullbody_image_id` is null). Series status `'draft'`. Assert `{ advanced: false }`, status unchanged.

3. **One face missing → does NOT advance.** Setup: 2 story_characters; first character has both, second has neither. Series status `'draft'`. Assert `{ advanced: false }`, status unchanged.

4. **Already in `'images_pending'` → no-op.** Setup: same as case 1, but series status is already `'images_pending'`. Assert `{ advanced: false }` (only the very first call advances; subsequent calls return false even with the same DB state). Status unchanged.

5. **Zero characters in series → does NOT advance.** Setup: series with no `story_characters` rows. Assert `{ advanced: false }`. Status unchanged.

The fake will need to support these surface methods (already used by `portrait-cascade.test.ts`):
- `from('story_series').select('status').eq('id', ...).single()`
- `from('story_series').update({status: ...}).eq('id', ...)`
- `from('story_characters').select('character_id, characters:character_id ( approved_image_id, approved_fullbody_image_id )').eq('series_id', ...)` — the join syntax needs the fake to return embedded `characters` objects for each row, mimicking PostgREST's nested-object response.

I'll extend the cascade-test fake pattern with a tiny join-resolver: when the SELECT cols string contains `characters:character_id ( ... )`, the fake resolves the join in-memory by looking up the matching `characters` row by `character_id` and embedding it as `.characters` on each result row.

---

## 5. Test plan adjustments to `portrait-routes.test.ts`

**Honest constraint:** the existing `portrait-routes.test.ts` only exercises input-validation paths that fail before touching `supabase`. Adding "confirm helper fires when face approval completes the gate" requires either (a) Node 22 `mock.module` (not available — repo on Node 20) or (b) a route refactor extracting a DI-friendly helper for the route body. Both are larger than this PR.

**What I'll do instead:**
- Leave the existing two validation tests in `portrait-routes.test.ts` unchanged.
- Update the in-file "Coverage gap" comment to add two new bullet points covering the new helper integration:
  - `/approve-face` calls `checkAndAdvanceToImagesPending` with the correct `series_id`
  - `/approve-body` calls `checkAndAdvanceToImagesPending` with the correct `series_id`
- The helper itself is exhaustively tested in `series-status.test.ts`, so the only un-covered behaviour is "the route handler actually invokes the helper" — a simple reachability assertion that's high-coverage / low-value compared to the helper logic itself.

If you want stronger guarantees, the right move is the route-DI-refactor follow-up that's already flagged elsewhere — at which point all the deferred portrait-route integration cases (approve-face happy path, approve-body face-precondition, revoke-face cascades, revoke-body non-touches) move from manual to automated together.

---

## 6. Verification sequence (Phase B)

In order:

1. Type-check via the existing temp tsconfig (extended to include the new helper + new test file):
   ```
   npx tsc --project /tmp/tsconfig-check.json
   ```
   Expected: clean.

2. New helper unit tests (5 cases):
   ```
   cd /Users/Howard/Projects/No-Safe-Word && \
     npx tsx --test apps/web/lib/server/series-status.test.ts
   ```
   Expected: 5/5 pass.

3. Cascade helper tests (regression check, 5 cases):
   ```
   npx tsx --test apps/web/lib/server/portrait-cascade.test.ts
   ```
   Expected: 5/5 pass.

4. Route-validation tests (regression check, 2 cases):
   ```
   cd "apps/web/app/api/stories/characters/[storyCharId]/__tests__" && \
     node --import=tsx --test portrait-routes.test.ts
   ```
   Expected: 2/2 pass.

5. Pre-existing tests (regression check, 23 cases):
   ```
   npx tsx --test apps/web/lib/phone.test.ts
   npm test --workspace=@no-safe-word/story-engine
   npm test --workspace=@no-safe-word/image-gen
   ```
   Expected: 23/23 pass.

6. Lint touched files:
   ```
   cd apps/web && npx next lint \
     --file 'app/api/stories/characters/[storyCharId]/approve-face/route.ts' \
     --file 'app/api/stories/characters/[storyCharId]/approve-body/route.ts'
   ```
   Expected: no new warnings.

7. Final `git status` should show:
   - `M apps/web/app/api/stories/characters/[storyCharId]/approve-face/route.ts`
   - `M apps/web/app/api/stories/characters/[storyCharId]/approve-body/route.ts`
   - `?? apps/web/lib/server/series-status.ts`
   - `?? apps/web/lib/server/series-status.test.ts`
   - (Plus any pre-existing uncommitted state from prior PRs.)

If any verification fails, stop and surface — do not auto-fix.

---

## 7. Files touched (Phase B preview)

| File | Action |
|---|---|
| `apps/web/lib/server/series-status.ts` | NEW — `checkAndAdvanceToImagesPending` helper (~55 lines) |
| `apps/web/lib/server/series-status.test.ts` | NEW — 5 unit tests against supabase fake |
| `apps/web/app/api/stories/characters/[storyCharId]/approve-face/route.ts` | EDIT — replace 22-line inline gate with one helper call; update header docstring |
| `apps/web/app/api/stories/characters/[storyCharId]/approve-body/route.ts` | EDIT — extend storyChar SELECT to include `series_id`; add post-update helper call; update header docstring |

**Net change:** approximately −22 lines (the inline gate in `/approve-face`) + ~6 lines added across both routes (imports + helper calls + docstring text) + 55 lines new helper + ~150 lines new test file. Net ~+190 lines, of which ~150 is new test coverage.

---

## 8. Backwards compatibility (sanity check, unchanged from prompt)

All 7 production characters are either fully-approved (face + body) or fully-unapproved. No existing series will see a status change as a result of this fix — series with all-face-approved-but-no-bodies don't exist today. The helper is idempotent.

If, after deployment, a manual SQL session creates an all-face-no-body state (improbable, but possible), the next `/approve-body` invocation that completes the gate will advance the series correctly, and the next `/approve-face` invocation will be a no-op (correct behaviour).

---

Stopping. Reply `yes, apply` to execute Phase B.
