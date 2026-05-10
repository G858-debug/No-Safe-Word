# Portrait Pipeline — Deprecated Code Cleanup, Phase A Diagnostic

**Date:** 2026-05-10
**Scope:** Read-only audit of deprecated portrait endpoints and the `/in-flight-state` `pending` block, ahead of removal.
**Status:** No code modified. Findings only.

---

## Headline

Every one of the five candidate endpoints is **safe to delete** — no callers anywhere in the repo outside of each route's own self-references. The `/in-flight-state` `pending` block has zero readers; the new `CharacterCard.tsx` declares `pending: unknown` in its type and never accesses it. Only one helper (`concatImagesVertically`) becomes orphaned; the other helpers used by the deprecated routes (`cleanupOrphanedImage`, `imageUrlToBase64`) have multiple non-deprecated callers and must stay.

One additional finding: my own change in the previous PR introduced a latent bug in `latest_face` / `latest_body` derivation that this cleanup is well-positioned to fix in passing — surfaced under "Out of scope" below.

---

## Confirmed safe to delete

### Endpoints (all five)

For each, grep for the route-tail string across `apps/`, `packages/`, excluding `node_modules` and `.next/`:

| Endpoint | Callers found outside its own route file |
|---|---|
| `POST /api/stories/characters/[storyCharId]/approve` | None. Grep for `characters/${...}/approve` returned only `/approve-face` and `/approve-body` (the new endpoints) plus `/approve-card` (Stage 9, different route). The combined `/approve` route is referenced only inside its own file (one comment about `images_pending`). |
| `POST /api/stories/characters/[storyCharId]/reset-portrait` | None. Grep for `reset-portrait` returned only the route file's self-references (header doc + log prefix). |
| `POST /api/stories/characters/[storyCharId]/replace-pair` | None. Grep for `replace-pair` returned only the route file's self-references. |
| `POST /api/stories/characters/[storyCharId]/discard-candidate` | None. Grep for `discard-candidate` returned only the route file's self-references. |
| `POST /api/stories/characters/[storyCharId]/stitch-preview` | None. Grep for `stitch-preview` returned only the route file's self-references. |

The new [CharacterCard.tsx](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx) calls only `/approve-face`, `/approve-body`, `/revoke-face`, `/revoke-body`, `/generate`, `/generate-body`, `/cleanup-image`, `/patch-prompt`, `/default-prompt`, `/in-flight-state`, and `/api/status/{jobId}`. Verified by grep across the file.

### Orphaned helper

| File | Status | Reason |
|---|---|---|
| [apps/web/lib/server/image-concat.ts](apps/web/lib/server/image-concat.ts) (`concatImagesVertically`) | Becomes orphaned when `/stitch-preview` is deleted | The only caller in the repo is `/stitch-preview/route.ts:69`. Safe to delete in the same PR. |

### `pending` block in `/in-flight-state` response

Confirmed unused. The only declaration of `pending: unknown` lives in the new `CharacterCard.tsx`'s `InFlightState` interface ([line 59](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L59)) with the comment "the new UI does not read it." A grep for `\.pending` and `pending:` across `apps/web/app/dashboard/stories/` confirms every other match is unrelated (image-status counts, series-status enum values, CSS style maps).

The producer code in [apps/web/app/api/stories/characters/[storyCharId]/in-flight-state/route.ts](apps/web/app/api/stories/characters/[storyCharId]/in-flight-state/route.ts) at lines 140–162 (`candidateBody`, `candidateFace`, `faceJob`, `bodyJob` derivation) and lines 230–246 (the `pending: ...` response field) exists exclusively to populate this dead field.

`liveCandidates` (line 123) is also orphaned once `pending` is gone — its only consumers are `candidateBody` and `candidateFace`.

---

## Has callers — investigate

Helpers used by the deprecated routes that have non-deprecated callers and **must NOT be deleted**:

### `cleanupOrphanedImage` ([apps/web/lib/server/cleanup-orphaned-image.ts](apps/web/lib/server/cleanup-orphaned-image.ts))

Callers outside the deprecated routes:

- [apps/web/app/api/stories/characters/[storyCharId]/in-flight-state/route.ts:111](apps/web/app/api/stories/characters/[storyCharId]/in-flight-state/route.ts#L111) — eager orphan cleanup on hydration. Active in the new flow.
- [apps/web/app/api/stories/characters/[storyCharId]/cleanup-image/route.ts:57](apps/web/app/api/stories/characters/[storyCharId]/cleanup-image/route.ts#L57) — auth-scoped one-shot cleanup. Active in the new flow (called from `CharacterCard.tsx`'s `cleanupImage` callback for cancel/rollback paths — though I should note the new CharacterCard rewrite may have dropped that callback; verify in Phase B).
- [apps/web/scripts/test-cleanup-orphaned-image.ts:24](apps/web/scripts/test-cleanup-orphaned-image.ts#L24) — manual integration test script.

→ **Keep.**

### `imageUrlToBase64` (exported from `@no-safe-word/image-gen`, defined in [packages/image-gen/src/runpod.ts:302](packages/image-gen/src/runpod.ts#L302))

Callers outside `/stitch-preview`:

- [apps/web/app/api/stories/[seriesId]/generate-cover/route.ts](apps/web/app/api/stories/[seriesId]/generate-cover/route.ts) (lines 6, 406, 412)
- [apps/web/app/api/stories/[seriesId]/generate-image/route.ts](apps/web/app/api/stories/[seriesId]/generate-image/route.ts) (lines 6, 367, 373)
- [apps/web/app/api/stories/characters/[storyCharId]/generate-body/route.ts](apps/web/app/api/stories/characters/[storyCharId]/generate-body/route.ts) (lines 6, 185)
- [apps/web/app/api/characters/[characterId]/generate-card-image/route.ts](apps/web/app/api/characters/[characterId]/generate-card-image/route.ts) (lines 6, 246)

→ **Keep.** Package-level export, widely used across the active scene/cover/body/card pipelines.

### Tests

Grep across `apps/`, `packages/` for `*.test.ts`/`*.test.tsx` files that import the deprecated routes: zero matches. The only test files that touch character routes are:

- [apps/web/lib/server/portrait-cascade.test.ts](apps/web/lib/server/portrait-cascade.test.ts) — tests `runFaceRevokeCascade`. Untouched.
- [apps/web/app/api/stories/characters/[storyCharId]/__tests__/portrait-routes.test.ts](apps/web/app/api/stories/characters/[storyCharId]/__tests__/portrait-routes.test.ts) — tests `/approve-face` and `/approve-body` validation. Untouched.

→ **No test files need deletion.**

### Helper-script verification

Searched `apps/web/scripts/`, `apps/web/app/`, `packages/` for any stitch/preview/composite helper functions that wrap the deprecated routes — none found. The deprecated routes were only invoked from the prior `CharacterCard.tsx` (now rewritten) and from each other (none cross-call).

---

## Out of scope

### Latent bug in `latest_face` / `latest_body` derivation (introduced in the previous PR)

While auditing `/in-flight-state/route.ts` for this cleanup I noticed that my own previous change populates `latest_face` and `latest_body` from `imagesForChar` (all rows for the character) rather than the post-cleanup `liveImages` set. The orphan-cleanup pass (lines 104–119) DELETES rows from the DB for orphans, but `imagesForChar` was loaded BEFORE that delete, so it still references the now-deleted IDs.

Concrete failure mode: if a generation job is in `failed` status when the user mounts the card, the orphan cleanup deletes its `images` row, but `latestFaceRow` or `latestBodyRow` may still point at the deleted ID. The client then renders the body panel pointing at a stale image_id and a possibly-still-resolvable storage URL.

The fix is one line — derive `latestFaceRow`/`latestBodyRow` from a `liveImages = imagesForChar.filter(r => !orphanIds.includes(r.id))` array. This is idiomatic to do in the same edit pass as removing the `pending` block, since I'm already touching that derivation logic.

**Recommendation:** include this one-liner in the Phase B plan as a drive-by fix. If you'd rather keep the cleanup PR strictly mechanical (no bug fixes), flag it as a separate follow-up and I'll skip it. Out of strict scope per prompt; surfacing because it's load-bearing once the pending block is gone (today the orphan path is partly masked by the user not actually using `latest_*` if `pending.body_*` happens to be non-orphan).

### `apps/web/scripts/test-cleanup-orphaned-image.ts`

This script's docstring says "Run with: npx tsx apps/web/scripts/test-cleanup-orphaned-image.ts" and creates a real DB row before tearing it down. It's a manual integration test, not part of CI. Not affected by this cleanup, but worth noting as the only place that exercises `cleanupOrphanedImage` end-to-end. No changes proposed.

### Server-side comments still referencing `/approve`

The new [/approve-face/route.ts](apps/web/app/api/stories/characters/[storyCharId]/approve-face/route.ts) header docstring contains the phrase "Mirrors the face half of the legacy /approve route." Once `/approve` is deleted, that phrase becomes a dangling reference. Phase B should update the comment to remove the back-reference (one-line edit).

### Series-status face-only-advancement bug

Per the prompt's out-of-scope list, **not touching**. The new `/approve-face` route still preserves the legacy face-only gate. This cleanup PR does not change that behaviour.

### Dormant DB columns

Per the prompt's out-of-scope list, **not touching**. `approved_seed`, `approved_fullbody_seed`, `approved_fullbody_prompt` remain in the schema; the deprecated `/approve` route's writes to them disappear with the route, but the columns themselves are dropped in a separate PR per existing roadmap.

---

## Summary table for Phase B planning

| Item | Action | Notes |
|---|---|---|
| `apps/web/app/api/stories/characters/[storyCharId]/approve/route.ts` | Delete | No callers |
| `apps/web/app/api/stories/characters/[storyCharId]/reset-portrait/route.ts` | Delete | No callers |
| `apps/web/app/api/stories/characters/[storyCharId]/replace-pair/route.ts` | Delete | No callers |
| `apps/web/app/api/stories/characters/[storyCharId]/discard-candidate/route.ts` | Delete | No callers |
| `apps/web/app/api/stories/characters/[storyCharId]/stitch-preview/route.ts` | Delete | No callers |
| `apps/web/lib/server/image-concat.ts` | Delete | Only caller is `/stitch-preview` |
| `apps/web/app/api/stories/characters/[storyCharId]/in-flight-state/route.ts` | Edit | Remove `pending: ...` response field, the `candidateBody`/`candidateFace`/`faceJob`/`bodyJob` derivations, and `liveCandidates`. (Optional: fix the `latest_*` orphan-row bug.) |
| `apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx` | Edit | Remove `pending: unknown` from the `InFlightState` interface and the comment above it. |
| `apps/web/app/api/stories/characters/[storyCharId]/approve-face/route.ts` | Edit | Update header docstring "legacy /approve route" reference. |
| `cleanupOrphanedImage` helper | Keep | Used by `/in-flight-state` and `/cleanup-image` and a manual test script. |
| `imageUrlToBase64` helper | Keep | Used by 4+ active scene/cover/body/card routes. |
| Test files | Untouched | None reference deprecated routes. |
| DB schema | Untouched | No schema changes proposed. |

---

Stopping here. Reply `yes, dry-run` to proceed to Phase B planning, or send feedback to refine.
