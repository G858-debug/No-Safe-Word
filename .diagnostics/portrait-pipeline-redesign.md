# Portrait Pipeline Redesign — Phase A Diagnostic

**Date:** 2026-05-10
**Scope:** Read-only audit of the current portrait approval pipeline (UI, DB, API, downstream consumers, existing data, concurrency).
**Status:** No code modified. Findings only.

---

## Summary

Today's pipeline treats face + body as **one atomic approval unit**. There is a single `/approve` endpoint that requires both `face_image_id` and `body_image_id`, a single `/reset-portrait` endpoint that clears both at once, and a single 18-state client-side reducer that walks the user from "idle" → "generate face" → "generate body" → "approve pair" in one linear flow. There is **no notion of "face approved, body not yet generated"** — face is implicitly approved at the moment the user clicks "Looks good → Generate body," but only on the client; nothing is persisted to `characters` until both images exist and the combined `/approve` fires.

Concrete consequences relevant to the redesign:

- The DB schema is already a superset of what the new design needs — the `characters` table holds `approved_image_id`, `approved_fullbody_image_id`, and `portrait_prompt_locked` independently. No new columns are required to model "face approved without body." Whether to back-fill an `approved_at` timestamp is a design choice; today there is none for face/body (only `card_approved_at` for the Stage-9 card stage).
- There is **no separate face-approval endpoint** — the only way to persist face approval today is to also approve a body. There is also no revoke-face / revoke-body endpoint distinct from the all-or-nothing `/reset-portrait`.
- There is **no cascade logic anywhere** today (server- or client-side) that invalidates body when face changes. The current UX avoids the question by forbidding face regeneration while body is in flight, and by treating "Replace pair" as the only post-approval mutation.
- There is **no stale flag** on either column today; approval is purely a function of whether the column is null.
- All 6 currently-approved characters have **both** `approved_image_id` AND `approved_fullbody_image_id` populated (paired). None are in any intermediate state. Backfill is therefore trivial — every existing approved character maps cleanly onto "both face and body approved" in any new state model.
- `approved_seed`, `approved_fullbody_seed`, and `approved_fullbody_prompt` are dormant columns in the current code path (the active flow does not write them). The 4 oldest approved characters have `approved_fullbody_prompt` populated (legacy code wrote it); the 2 newest do not (Pass-3 code stopped writing it). `approved_seed` and `approved_fullbody_seed` are universally null.
- There is **no row-level locking, transactional gating, or advisory lock** anywhere in the character routes. Concurrency safety today rests on (a) client-side `submittingRef` double-click guard, (b) `disabled={true}` on every button while a generation is in flight, and (c) a comment in the `/approve` route acknowledging "single-user assumption" for the read-then-write series-status check.

---

## 1. UI

### 1a. Where the Characters tab lives

**Parent route / tab host:**
- [apps/web/app/dashboard/stories/[seriesId]/page.tsx](apps/web/app/dashboard/stories/[seriesId]/page.tsx) — the Story Publisher page; contains a 7-tab `<Tabs>` UI (Overview, Characters, Cards, Cover, Blurbs, Images, Publish).
- The Characters tab is rendered at [page.tsx:744-751](apps/web/app/dashboard/stories/[seriesId]/page.tsx#L744-L751) by mounting `<CharacterApproval>` when `activeTab === "characters"`.

**Wrapper component:**
- [apps/web/app/dashboard/stories/[seriesId]/components/CharacterApproval.tsx](apps/web/app/dashboard/stories/[seriesId]/components/CharacterApproval.tsx#L85-L149) — fetches `/api/stories/{seriesId}/characters` and maps each character to a `<CharacterCard>` in a `space-y-6` vertical stack.

**Per-character component (the actual UI under audit):**
- [apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx) — 2,137 lines.
  - State type definitions: lines 49–192
  - Reducer: lines 235–574
  - Render switch (`renderStateBody`): lines 1664–2074
  - Card frame JSX: lines 2076–2136

### 1b. Visual structure today

Each character is rendered as **one `<Card>`** containing a header strip (demographics) plus a single body region whose content depends entirely on the reducer state's `kind` field. There are NOT two stacked panels; the same region is used to render Step 1 (face), Step 2 (body), or the approved-state view. Step labels at [CharacterCard.tsx:1723, 1759, 1800](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx) ("Step 1 of 2 — Face portrait", "Step 2 of 2 — Body portrait") are the only persistent visual cue distinguishing the two stages.

Text areas:
- **Face prompt** (`Textarea`, [lines 1673-1681](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1673-L1681)) — visible only in the `idle` state.
- **Body prompt** (`Textarea`, [lines 1683-1692](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1683-L1692)) — also visible in `idle` and **submitted at the same time** as the face prompt. The body prompt is captured up front; it is not entered later when the user advances to Step 2.
- **Locked portrait prompt editor** (collapsible, [lines 1888-1952](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1888-L1952)) — appears only in the `approved` state; lets the user edit `portrait_prompt_locked` without regenerating.

Image thumbnails are rendered side-by-side via the local `Thumb` helper ([lines 1609-1656](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1609-L1656)). Approved images render with `opacity-50` (greyed) when a candidate is being shown alongside.

### 1c. Buttons that exist today, by state

State labels match the reducer's `kind` field.

| State | Buttons (and what they do) | Source |
|---|---|---|
| `idle` | "Generate face" (submits both face + body prompt fields, kicks off face generation) | [1699-1707](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1699-L1707) |
| `generating_face` | (all disabled; spinner) | — |
| `face_ready` | "Regenerate face", "Looks good → Generate body" (advances UI to Step 2 — does **not** persist anything to DB), "Reset portrait" (link) | [1742-1752](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1742-L1752) |
| `body_prompt_editing` | "Generate body", "Reset portrait" (link) | [1773-1780](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1773-L1780) |
| `generating_body` | (all disabled; spinner) | — |
| `body_ready` | "Approve" (POSTs `/approve` with both IDs), "Regenerate body", "Cancel" (returns to `body_prompt_editing` and tears down body image), "Reset portrait" (link) | [1823-1835](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1823-L1835) |
| `approved` | "Reset portrait" (link, POSTs `/reset-portrait`), "Regenerate full character", "Regenerate body only", "Edit" (opens locked-prompt editor), "Save" / "Cancel" inside editor | [1863-1913](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1863-L1913) |
| `regenerating_full_face` / `regenerating_full_body` / `regenerating_body_only` | (in-flight; all disabled) | [1957-1994](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1957-L1994) |
| `candidate_ready` | "Replace with candidate" (POSTs `/replace-pair`), "Discard candidate" (POSTs `/discard-candidate`) | [2024-2041](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L2024-L2041) |
| `error` | "Dismiss" | [2057-2072](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L2057-L2072) |

**Context-dependence:**
- "Looks good → Generate body" exists only on a face-only screen, but it does **not** persist face approval — it is purely a UI state transition (move to `body_prompt_editing`). Face is "approved" only client-side, in the reducer state, until the eventual `/approve` call writes both IDs.
- "Regenerate body only" vs "Regenerate full character" branch on whether the user wants to retain the approved face. Both run from the `approved` state.

### 1d. How the UI distinguishes face vs body editing

Not by tabs or toggles. The reducer's `kind` field is the only signal — the render switch at [CharacterCard.tsx:1664](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1664) renders different JSX per state. Step labels at lines 1723/1759/1800 give the user a textual hint of which sub-stage they're on.

The current stage (face vs body) is implicit in `state.kind` and is not exposed as a separate slot of state.

### 1e. State machine signals (approval, in-flight, stale)

- **Approved indicator** — a derived boolean `portraitApproved` ([1547-1564](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1547-L1564)) checks for any `kind` from `approved` onwards. Also surfaced as a "✓ Approved" / "Pending" badge in the card header ([2092-2094](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L2092-L2094)).
- **In-flight indicator** — encoded directly in `state.kind` (`generating_face`, `generating_body`, `regenerating_*`, `candidate_ready`).
- **Stale indicator** — does NOT exist today. There is no UI element labeled "stale" or "needs regen" and no DB column behind one. The reducer's `candidate_ready` state is the closest analogue, but it represents "a new image is sitting next to the approved one awaiting Replace/Discard," not "an existing approval has been invalidated."

State is hydrated from `/api/stories/characters/{id}/in-flight-state` on mount ([CharacterCard.tsx:1426-1498](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L1426-L1498)) which reconstructs the reducer state purely from DB column population (approved IDs + in-flight job rows).

### 1f. Confirmation modals

There are **zero** confirmation dialogs in `CharacterCard` today. Every action — Regenerate, Reset, Replace, Discard, Cancel — fires immediately on click. The only modal-like surface is the `error` state's red box with a "Dismiss" button.

There IS a `window.confirm()` at the parent-page level ([page.tsx:325](apps/web/app/dashboard/stories/[seriesId]/page.tsx#L325)) when the user changes the series-level image model, but that warning is on the model dropdown, not on the character card.

### 1g. Concurrency / button disabling (UI-side)

- All action buttons accept a `disabled` prop and are set `disabled={true}` during in-flight states. Replace/Discard buttons additionally guard on a local `busy` flag ([2028, 2040](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx)).
- Double-click protection via a `submittingRef = useRef(false)` ([604-607](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L604-L607)). Each handler checks `submittingRef.current` and returns early if set.
- Polling: completion polled every 3s via `/api/status/{jobId}` ([623-654](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L623-L654)).
- No optimistic UI; the component waits for the API to confirm before transitioning.

### 1h. API endpoints called from the UI

| Endpoint | Method | Caller | Purpose |
|---|---|---|---|
| `/api/stories/{seriesId}/characters` | GET | `CharacterApproval` mount | List characters in series |
| `/api/stories/characters/{storyCharId}/generate` | POST | `handleGenerate` | Start face generation |
| `/api/stories/characters/{storyCharId}/generate-body` | POST | `driveGenerateBodyFlow` | Start body generation (with `face_image_id`) |
| `/api/stories/characters/{storyCharId}/approve` | POST | `handleApprove` | Persist face + body approval atomically |
| `/api/stories/characters/{storyCharId}/replace-pair` | POST | `handleReplace` | Promote candidate pair, tear down old |
| `/api/stories/characters/{storyCharId}/discard-candidate` | POST | `handleDiscard` | Tear down a non-promoted candidate pair |
| `/api/stories/characters/{storyCharId}/reset-portrait` | POST | `handleReset` | Null all approval columns at once |
| `/api/stories/characters/{storyCharId}/cleanup-image` | POST | `cleanupImage` | Auth-scoped delete of an orphan image |
| `/api/stories/characters/{storyCharId}/patch-prompt` | PATCH | `handleSavePrompt` | Edit `portrait_prompt_locked` post-approval |
| `/api/stories/characters/{storyCharId}/default-prompt` | GET | `buildHydratedState` | Auto-build initial face/body prompt |
| `/api/stories/characters/{storyCharId}/in-flight-state` | GET | mount | Hydrate reducer from DB |
| `/api/stories/characters/{storyCharId}/stitch-preview` | POST | preview | Composite face atop body for preview |
| `/api/status/{jobId}` | GET | poll | Poll Siray / RunPod job to completion |

---

## 2. Database schema

### 2a. Live `characters` columns (queried from production)

```
id                          uuid          NOT NULL  default uuid_generate_v4()
name                        text          NOT NULL
description                 jsonb         NOT NULL  default '{}'::jsonb
created_at                  timestamptz   NOT NULL  default now()
updated_at                  timestamptz   NOT NULL  default now()
approved_image_id           uuid          NULL       -- FK images(id)              [face]
approved_fullbody_image_id  uuid          NULL       -- FK images(id)              [body]
approved_seed               integer       NULL                                     [face — DORMANT]
approved_fullbody_seed      integer       NULL                                     [body — DORMANT]
approved_prompt             text          NULL                                     [face]
approved_fullbody_prompt    text          NULL                                     [body — DORMANT in current code]
portrait_prompt_locked      text          NULL                                     [face/canonical for both pipelines]
archetype_tag               text          NULL                                     [Phase 1 card]
vibe_line                   text          NULL                                     [Phase 1 card]
wants                       text          NULL                                     [Phase 1 card]
needs                       text          NULL                                     [Phase 1 card]
defining_quote              text          NULL                                     [Phase 1 card]
watch_out_for               text          NULL                                     [Phase 1 card]
bio_short                   text          NULL                                     [Phase 1 card]
card_image_prompt           text          NULL                                     [Phase 1 card]
card_image_url              text          NULL                                     [Phase 1 card cached URL]
card_image_id               uuid          NULL       -- FK images(id) ON DELETE SET NULL  [Phase 2 card]
card_approved_at            timestamptz   NULL                                     [Phase 3a card]
author_id                   uuid          NOT NULL   -- FK authors(id)
character_slug              text          NULL
```

### 2b. Live `story_characters` columns

```
id                  uuid    NOT NULL  default uuid_generate_v4()
series_id           uuid    NOT NULL
character_id        uuid    NOT NULL
role                text    NULL      default 'supporting'::text
prose_description   text    NULL
```

`story_characters` is now a pure link table — no portrait state.

### 2c. Migration trail for portrait approval state

| Migration | Effect |
|---|---|
| [002_add_user_tables.sql](supabase/migrations/002_add_user_tables.sql) | Initial `story_characters`: `approved boolean`, `approved_image_id uuid`, `approved_seed integer`. (All later dropped.) |
| [005_add_approved_prompt.sql](supabase/migrations/005_add_approved_prompt.sql) | Adds `approved_prompt text` to `story_characters`. (Later dropped.) |
| [008_add_fullbody_approval.sql](supabase/migrations/008_add_fullbody_approval.sql) | Adds `approved_fullbody`, `approved_fullbody_image_id`, `approved_fullbody_seed`, `approved_fullbody_prompt` to `story_characters`. (Later dropped.) |
| [036_add_image_model_and_portrait_lock.sql](supabase/migrations/036_add_image_model_and_portrait_lock.sql) | Adds `story_series.image_model` (`flux2_dev` / `hunyuan3`) and `story_characters.portrait_prompt_locked`. (The latter later dropped.) |
| [20260424180000_canonicalize_portraits_drop_loras.sql](supabase/migrations/20260424180000_canonicalize_portraits_drop_loras.sql) | **The big move.** Adds `approved_image_id`, `approved_fullbody_image_id`, `approved_seed`, `approved_fullbody_seed`, `approved_prompt`, `approved_fullbody_prompt`, `portrait_prompt_locked` to base `characters`. Drops every per-series portrait + LoRA column from `story_characters`. Drops LoRA tables. |
| [20260508000000_add_ref_type_columns.sql](supabase/migrations/20260508000000_add_ref_type_columns.sql) | Adds `primary_ref_type`/`secondary_ref_type` ('face'\|'body') to `story_image_prompts`, plus `cover_primary_ref_type`/`cover_secondary_ref_type` to `story_series`. |
| [20260509000100_extend_story_series_and_characters_for_phase1.sql](supabase/migrations/20260509000100_extend_story_series_and_characters_for_phase1.sql) | Adds the 8 profile-card text fields + `card_image_url` to `characters`. |
| [20260509100000_phase2_image_fk_columns.sql](supabase/migrations/20260509100000_phase2_image_fk_columns.sql) | Adds `card_image_id uuid` FK on `characters`. |
| [20260509200000_phase3a_card_approved_at.sql](supabase/migrations/20260509200000_phase3a_card_approved_at.sql) | Adds `card_approved_at timestamptz` (Stage 9 — card approval). |
| [20260510000000_add_character_slug.sql](supabase/migrations/20260510000000_add_character_slug.sql) | Adds `author_id` (NOT NULL) and `character_slug` to `characters`. |

### 2d. Approval-tracking columns vs the current code

Mapped to the API-route writes (see Section 3):

| Column | Written by | Read by | Notes |
|---|---|---|---|
| `characters.approved_image_id` | `/approve` (face), `/replace-pair`, `/reset-portrait` (NULL) | scene gen, cover gen, series-status gate, publish gate, in-flight-state | The canonical face approval signal. |
| `characters.approved_fullbody_image_id` | `/approve` (body), `/replace-pair`, `/reset-portrait` (NULL) | scene gen (when ref_type=body), cover gen (when ref_type=body), card-image gen | Body approval signal. |
| `characters.portrait_prompt_locked` | `/approve`, `/replace-pair`, `/patch-prompt`, `/reset-portrait` (NULL) | scene gen (Hunyuan injection), cover gen (Hunyuan verbatim) | Canonical character text for Hunyuan. |
| `characters.approved_prompt` | `/approve`, `/replace-pair`, `/reset-portrait` (NULL) | (debug/provenance) | Snapshot of the prompt that produced the approved face. |
| `characters.approved_seed` | `/approve` (extracts from `images.settings.seed`), `/replace-pair` | (debug/provenance) | Universally null today — Nano Banana 2 face jobs do not write `settings.seed`. |
| `characters.approved_fullbody_seed` | (none — dormant) | (none) | Was written by pre-canonicalization Pass-2 code; current pipeline does not write it. All NULL in production. |
| `characters.approved_fullbody_prompt` | (none in current code — dormant) | (none) | Older characters have it populated from legacy code; characters approved by current Pass-3 code do not. |

### 2e. Stale flag

There is **no `*_stale`, `*_invalidated_at`, or similar column** anywhere in the schema. Approval is determined purely by null vs. non-null on the two image-ID columns.

### 2f. Approval-timestamp columns

There is **no `approved_at` (face) or `approved_fullbody_at` (body) column** today. The only approval timestamp on `characters` is `card_approved_at` (Stage 9 — character profile-card approval, separate from portrait approval).

---

## 3. API endpoints

### 3a. Endpoint inventory (all under `/apps/web/app/api/stories/characters/[storyCharId]/`)

| Endpoint | Method | File |
|---|---|---|
| `generate` (face) | POST | [generate/route.ts](apps/web/app/api/stories/characters/[storyCharId]/generate/route.ts) |
| `generate-body` | POST | [generate-body/route.ts](apps/web/app/api/stories/characters/[storyCharId]/generate-body/route.ts) |
| `approve` (combined) | POST | [approve/route.ts](apps/web/app/api/stories/characters/[storyCharId]/approve/route.ts) |
| `replace-pair` | POST | [replace-pair/route.ts](apps/web/app/api/stories/characters/[storyCharId]/replace-pair/route.ts) |
| `discard-candidate` | POST | [discard-candidate/route.ts](apps/web/app/api/stories/characters/[storyCharId]/discard-candidate/route.ts) |
| `reset-portrait` | POST | [reset-portrait/route.ts](apps/web/app/api/stories/characters/[storyCharId]/reset-portrait/route.ts) |
| `cleanup-image` | POST | [cleanup-image/route.ts](apps/web/app/api/stories/characters/[storyCharId]/cleanup-image/route.ts) |
| `patch-prompt` | PATCH | [patch-prompt/route.ts](apps/web/app/api/stories/characters/[storyCharId]/patch-prompt/route.ts) |
| `default-prompt` | GET | [default-prompt/route.ts](apps/web/app/api/stories/characters/[storyCharId]/default-prompt/route.ts) |
| `in-flight-state` | GET | [in-flight-state/route.ts](apps/web/app/api/stories/characters/[storyCharId]/in-flight-state/route.ts) |
| `stitch-preview` | POST | [stitch-preview/route.ts](apps/web/app/api/stories/characters/[storyCharId]/stitch-preview/route.ts) |

Plus the shared async-job poller:
- `/api/status/[jobId]` GET — [apps/web/app/api/status/[jobId]/route.ts](apps/web/app/api/status/[jobId]/route.ts) (handles both `siray-{taskId}` Siray jobs and `runpod-{jobId}` RunPod jobs).

### 3b. `POST /generate` (face portrait)

- File: [generate/route.ts](apps/web/app/api/stories/characters/[storyCharId]/generate/route.ts) (lines 1–144)
- Request: `{ customPrompt?: string }` (≥20 chars if supplied)
- Reads: `story_characters.id, character_id`; `characters.id, name, description`
- Writes:
  - new `images` row: `character_id, prompt, settings.model='nano_banana_2', settings.imageType='face', settings.siray_task_id`, dimensions 2048×2048
  - new `generation_jobs` row: `job_id='siray-{taskId}', image_id, status='pending', job_type='character_portrait'`
- Response: `{ jobId, imageId, model, promptUsed }`
- **Model:** Always Nano Banana 2 via Siray, regardless of `story_series.image_model`. Faces ignore the dispatcher.

### 3c. `POST /generate-body`

- File: [generate-body/route.ts](apps/web/app/api/stories/characters/[storyCharId]/generate-body/route.ts) (lines 1–264)
- Request: `{ face_image_id: string, prompt?: string }` — face_image_id REQUIRED.
- Reads: `story_characters.id, character_id, series_id`; `story_series.image_model` (branches); `characters.id, name, description`; `images.id, character_id, stored_url` (face)
- **Branches on `story_series.image_model`:**
  - `hunyuan3` (Siray i2i): try 1024×1536, fall back to 1024×1280 on size rejection; `referenceImageUrls: [face.stored_url]`; job_id = `siray-{taskId}`
  - `flux2_dev` (RunPod): fixed 1664×2496; face → base64 reference; job_id = `runpod-{jobId}`
- Writes: new `images` row (`settings.imageType='body', settings.face_image_id=<face_id>`), new `generation_jobs` row.
- 400 if face image not yet uploaded (no `stored_url`).
- **Body generation requires a face image to exist** in `images`, but does NOT require `characters.approved_image_id` to be set. The face it depends on may still be a candidate.

### 3d. `POST /approve` — the combined approval

- File: [approve/route.ts](apps/web/app/api/stories/characters/[storyCharId]/approve/route.ts) (lines 1–256)
- Request: `{ face_image_id: string, body_image_id: string, prompt?: string }` — **both IDs required.**
- Reads: `story_characters.id, character_id, series_id`; `images` for face (id, sfw_url, stored_url, settings, prompt) and body (id, stored_url, sfw_url); `characters` (current state for rollback); all sibling `story_characters` in series with their linked `characters.approved_image_id` (for the series-status gate).
- Writes (sequential, with face-rollback if body write fails):
  - `characters.approved_image_id = face_image_id`
  - `characters.approved_fullbody_image_id = body_image_id`
  - `characters.approved_seed = settings.seed ?? null` (almost always null today)
  - `characters.approved_prompt = prompt ?? null`
  - `characters.portrait_prompt_locked = prompt ?? face.prompt ?? null`
  - `images` (face): downloads `sfw_url` to Supabase Storage at `characters/{face_id}.{ext}` if `stored_url` not yet persisted
  - `story_series.status = 'images_pending'` IFF every linked character in the series has `approved_image_id` set
- Response: `{ story_character_id, character_id, stored_url, approved_face_image_id, approved_body_image_id }`
- Comments at the head of the file explicitly note "read/write race acknowledged, acceptable under single-user assumption."

### 3e. `POST /replace-pair`

- File: [replace-pair/route.ts](apps/web/app/api/stories/characters/[storyCharId]/replace-pair/route.ts) (lines 1–170)
- Request: `{ new_face_image_id, new_body_image_id, new_prompt? }`
- Reads: `story_characters`, `characters` (current approved IDs for cleanup), `images` (validate ownership)
- Writes the same five `characters` columns as `/approve`, then best-effort cleans up the previous approved face + body via `cleanupOrphanedImage()`.
- **Regenerate-body-only path:** if `new_face_image_id === oldFaceId`, the old face is reused and not torn down.
- Cleanup errors are non-fatal and surfaced in the response (`cleanup_errors: [...]`).

### 3f. `POST /reset-portrait`

- File: [reset-portrait/route.ts](apps/web/app/api/stories/characters/[storyCharId]/reset-portrait/route.ts) (lines 1–63)
- Request: no body
- Reads: `story_characters.id, character_id`
- Writes: a single UPDATE on `characters` setting all five columns to NULL — `approved_image_id`, `approved_seed`, `approved_prompt`, `portrait_prompt_locked`, `approved_fullbody_image_id`.
- Does NOT clean up the orphaned image rows that previously backed the approval; does NOT touch `generation_jobs`.

### 3g. `POST /discard-candidate`

- File: [discard-candidate/route.ts](apps/web/app/api/stories/characters/[storyCharId]/discard-candidate/route.ts) (lines 1–100)
- Request: `{ candidate_face_image_id?: string|null, candidate_body_image_id: string }`
- Tears down candidate `images`/`generation_jobs` after authorizing each ID belongs to the character. `candidate_face_image_id` is optional to support the regenerate-body-only flow.

### 3h. Other character endpoints

- `POST /cleanup-image` — auth-scoped delete of one orphan image.
- `PATCH /patch-prompt` — updates `characters.portrait_prompt_locked` only (max 2000 chars after trim). Does NOT touch `approved_prompt`.
- `GET /default-prompt?stage=face|body` — calls `buildCharacterPortraitPrompt(description, stage)` from the image-gen library; client uses this to populate textareas.
- `GET /in-flight-state` — partitions a character's images into `approved` (matches IDs) and `pending` (everything else, with linked job status). Eagerly cleans up orphans (no `generation_jobs` row OR job status `failed`) on every call.
- `POST /stitch-preview` — composites approved face on top of a body URL (768px wide) and returns a base64 preview; read-only (no DB writes).

### 3i. Endpoints that do NOT exist today

| Endpoint that a separated state model would require | Today's reality |
|---|---|
| `POST /approve-face` (face only) | Not present. Face is only persisted to `characters` as part of `/approve` which requires a body too. |
| `POST /approve-body` (body only, given face already approved) | Not present. |
| `POST /revoke-face` (clear face approval, optionally cascade to body) | Not present. Closest is `/reset-portrait`, which is all-or-nothing. |
| `POST /revoke-body` (clear body only, keep face) | Not present. |
| Any endpoint that sets a "stale" flag without nulling the image FK | Not present (no stale column exists). |

Body generation has no precondition on face *approval*, only on the existence of a `images` row with a `stored_url` belonging to the same character. Therefore today's design technically allows generating a body before the face is approved — the UI just doesn't expose that path.

### 3j. Cascade logic

Searched for any cross-column logic that ties face approval changes to body approval changes:

- `/approve` writes both columns in one transaction-scoped sequence with a face rollback if the body write fails. This is "tied approval" but not a cascade in the redesign sense — it never invalidates an existing body when face changes; it only refuses to commit if both can't be set.
- `/reset-portrait` clears both atomically, but indiscriminately — there is no "clear face only" path.
- `/replace-pair` either replaces both (when new face ID differs) or keeps the old face and replaces only the body (when new face ID matches old). It does not invalidate; it overwrites.

There is **no logic anywhere — server- or client-side — that, given an existing approved face + body, regenerates the face and marks the body stale.** The current UX prevents the question by routing all post-approval changes through `/replace-pair`, which atomically swaps both at once. The reducer's "Regenerate full character" button always replaces both face and body in a single new candidate pair.

---

## 4. Downstream consumers

### 4a. Scene image generation

- Entrypoint: [apps/web/app/api/stories/[seriesId]/generate-image/route.ts](apps/web/app/api/stories/[seriesId]/generate-image/route.ts)
- Shared draft helper: [apps/web/lib/server/draft-scene-prompt-from-db.ts](apps/web/lib/server/draft-scene-prompt-from-db.ts) — `draftAndPersistScenePrompt()` at lines 30–193

**Shared validation (Hunyuan3 path, draft step):** lines 130–134 of `draft-scene-prompt-from-db.ts` throw if any linked character has `approved_image_id IS NULL`:
> `Character ${c.name ?? c.id} has no approved portrait yet — approve the portrait before drafting scene prompts.`

**Flux 2 Dev specific check** (lines 296–353 of `generate-image/route.ts`): selects `id, approved_image_id, approved_fullbody_image_id`, resolves the relevant URL via `getPortraitUrlsForScene()`, and throws if the selected ref-type's URL is missing:
> `Character "${c.name}" has no approved ${primaryRefType} portrait yet — approve the ${primaryRefType} portrait before generating scenes under flux2_dev.`

**Hunyuan3 specific path** (lines 72–252 of `generate-image/route.ts`): uses `getPortraitUrlsForScene()` (helper at [apps/web/lib/server/get-portrait-urls.ts](apps/web/lib/server/get-portrait-urls.ts) lines 24–76). This helper returns a possibly-empty array if the requested ref-type's portrait is missing — it does NOT throw. The Hunyuan route does not validate the result before submitting to Siray. **Silent-degrade path:** if a scene specifies `secondary_ref_type='body'` and that character has body unapproved, Siray receives one fewer i2i reference image than expected.

### 4b. What scene gen actually checks

- Default scene `primary_ref_type` is **`'body'`** (per the [20260508000000_add_ref_type_columns.sql](supabase/migrations/20260508000000_add_ref_type_columns.sql) `DEFAULT 'body'`).
- Flux 2 Dev: enforces presence of the requested ref-type — face if `ref_type='face'`, body if `ref_type='body'`. Throws explicit error if missing.
- Hunyuan3: silently passes fewer refs to Siray when ref-type is missing.
- Neither path checks `portrait_prompt_locked` for scene generation, but the draft step (which runs before generation) requires either `portrait_prompt_locked` or `description` to exist on each linked character.

### 4c. Cover generation

- Entrypoint: [apps/web/app/api/stories/[seriesId]/generate-cover/route.ts](apps/web/app/api/stories/[seriesId]/generate-cover/route.ts)
- Precondition (lines 201–239): protagonist must exist with `approved_image_id IS NOT NULL` (face approved). Optional secondary supports either a love interest (also face-approved) or a `cover_secondary_character_id` override (also face-approved).
- Errors:
  - line 226: `Cover generation requires an approved protagonist portrait. Complete character approval first.`
  - line 263: `Selected cover character has no approved portrait or is not linked to this series. Re-approve their portrait or clear the cover-character override and try again.`
- **Has a fallback** (lines 354–355 / 357–358): if `cover_*_ref_type='body'` is requested but the character has only face approved (or vice versa), falls back to the other ref-type. Errors only when neither face nor body exists (lines 386–392).
- Both flux2_dev and hunyuan3 cover paths use the same precondition logic; no model-specific differences in readiness.

### 4d. Series status advancement

- File: [apps/web/app/api/stories/characters/[storyCharId]/approve/route.ts](apps/web/app/api/stories/characters/[storyCharId]/approve/route.ts) lines 211–236
- Initial status: `'draft'` (set in [apps/web/app/api/stories/create/route.ts](apps/web/app/api/stories/create/route.ts) lines 61, 88)
- Gate (lines 220–229):
  ```ts
  const allReady = seriesChars.every((sc) => {
    const row = Array.isArray(sc.characters) ? sc.characters[0] : sc.characters;
    return Boolean(row?.approved_image_id);
  });
  if (allReady) {
    await supabase.from('story_series').update({ status: 'images_pending' }).eq('id', seriesId);
  }
  ```
- **The gate checks face approval only.** A series with all faces approved but zero bodies approved still advances to `images_pending`.

### 4e. Other consumers

- [apps/web/app/api/stories/[seriesId]/cover-character/route.ts](apps/web/app/api/stories/[seriesId]/cover-character/route.ts) lines 70–101: requires `approved_image_id !== null` for the selected character.
- [apps/web/app/api/stories/[seriesId]/publish-website/route.ts](apps/web/app/api/stories/[seriesId]/publish-website/route.ts) lines 134–164: requires at least one protagonist with `approved_image_id !== null`. No body check.
- Card image generation (Stage 9) requires `approved_fullbody_image_id` — see helper in [apps/web/app/api/characters/[characterId]/generate-card-image/route.ts](apps/web/app/api/characters/[characterId]/generate-card-image/route.ts) and the UI helper text in [CharacterCardPanel.tsx:189-195](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCardPanel.tsx#L189-L195) (`Approve the body portrait in the Characters tab before generating a card image.`).
- [apps/web/app/api/stories/[seriesId]/regenerate-cover-prompt/route.ts](apps/web/app/api/stories/[seriesId]/regenerate-cover-prompt/route.ts) line 97: face approval only.

### 4f. Today's behaviour matrix

| Feature | Field checked | Gate type | Body required? |
|---|---|---|---|
| Series → `images_pending` | `approved_image_id` (face) for ALL characters | Throw on miss (implicit — no advance) | No |
| Scene gen, Flux 2 Dev | `approved_image_id` OR `approved_fullbody_image_id` based on `ref_type` | Throw on miss | Only if `ref_type='body'` |
| Scene gen, Hunyuan3 | Same | Silent degrade on miss | Only if `ref_type='body'` (silent) |
| Scene drafting (both paths) | `approved_image_id` | Throw on miss | No |
| Cover gen (both) | `approved_image_id` for protagonist; falls back on missing `ref_type` | Throw on neither | No (face-only sufficient) |
| Cover character override | `approved_image_id` | Throw on miss | No |
| Website publish | `approved_image_id` | Throw on miss | No |
| Card image gen | `approved_fullbody_image_id` | Throw on miss | Yes |

Body approval today gates only: scene gen with `ref_type='body'` (the default), and Stage-9 card image generation. Body approval does NOT gate series-status advance, cover gen, website publish, or cover-character selection.

---

## 5. Existing characters

Queried 2026-05-10 from project `mqemiteirxwscxtamdtj` (Refiloe Radebe — production).

7 characters total. Author = `50722538-0e83-43c6-a71b-f6fd6d6426b0` (Nontsikelelo Mabaso) for all.

| Name | Face approved | Body approved | Locked prompt | seed | fullbody_seed | fullbody_prompt | Card image | card_approved_at |
|---|---|---|---|---|---|---|---|---|
| Themba Nkosi | ✓ | ✓ | 532 chars | NULL | NULL | NULL | — | NULL |
| Refilwe Moloi | ✓ | ✓ | 624 chars | NULL | NULL | NULL | — | NULL |
| Esther Mutombo | — | — | — | — | — | — | — | NULL |
| Zanele | ✓ | ✓ | 576 chars | NULL | NULL | ✓ | ✓ | 2026-05-08 |
| Sibusiso Ndlovu | ✓ | ✓ | 663 chars | NULL | NULL | ✓ | ✓ | 2026-05-08 |
| Langa Mkhize | ✓ | ✓ | 144 chars | NULL | NULL | ✓ | ✓ | 2026-05-08 |
| Lindiwe Dlamini | ✓ | ✓ | 790 chars | NULL | NULL | ✓ | ✓ | 2026-05-08 |

Observations:

1. **Every approved character has both face AND body approved.** No row is in any "face approved, body unapproved" intermediate state. This means a redesign that introduces such an intermediate state needs no data migration for existing rows — they all map onto "both approved" terminally.
2. **`approved_seed` and `approved_fullbody_seed` are universally NULL.** The Nano Banana 2 face pipeline does not write `settings.seed` to images, so the `/approve` route's seed extraction has nothing to record. These columns are effectively dead today.
3. **`approved_fullbody_prompt` is mixed.** The 4 oldest approved characters (2026-05-01) have it populated; the 2 newest (2026-05-09) do not. The current Pass-3 `/approve` route does not write it. Confirms the API agent's finding that this column is dormant in the current code path.
4. **`portrait_prompt_locked` is populated for every approved character.** Lengths range 144–790 chars.
5. **Esther Mutombo** is the only never-approved character — newly imported, no portrait yet. Useful for Phase B testing.
6. **4 of 6 approved characters have card_image + card_approved_at populated** (Stage 9 card-approval has run for them). 2 newest have card stage incomplete.
7. **No character has approval timestamps for face/body** — only `card_approved_at` exists at the schema level, and it pertains to Stage 9 (card), not portrait approval.

### Backwards-compatibility migration assessment

If the redesign introduces any of:
- An `approved_face_at` / `approved_body_at` timestamp
- A `body_stale` boolean (or `body_invalidated_at` timestamp)
- A separation of "face approved" from "body approved" in the schema beyond what already exists

…then for the 6 currently-approved characters, the migration is straightforward:
- Backfill `approved_face_at` / `approved_body_at` with `updated_at` (or NULL if a "approval was atomic" semantics is preferred — there is no historical timestamp to recover).
- `body_stale = false` for all rows (none are stale).
- The schema split already exists (`approved_image_id` vs `approved_fullbody_image_id` are independent columns), so no data movement is needed; the only change would be in code paths that currently assume they are written together.

---

## 6. Concurrency

### 6a. Database-level

- No `FOR UPDATE` or `pg_advisory_lock` calls anywhere under [apps/web/app/api/stories/](apps/web/app/api/stories/) (verified by `grep -rln "FOR UPDATE\|for update\|advisory_lock\|pg_advisory"`).
- No transaction wrappers around the `/approve` write sequence — Supabase JS client does not expose them and the route does not call a `pg.rpc()` that would. The face / body / status writes are three separate UPDATEs. The route mitigates with explicit rollback logic that re-issues a face write to the prior state if the body write fails.
- One trigger on `characters`: `characters_updated_at` (auto-updates `updated_at`). No portrait-related trigger.

### 6b. Application-level

- Client-side `submittingRef = useRef(false)` ([CharacterCard.tsx:604-607](apps/web/app/dashboard/stories/[seriesId]/components/CharacterCard.tsx#L604-L607)) prevents double-firing of the same handler. Each handler short-circuits if `submittingRef.current` is set.
- All action buttons take `disabled` from a parent prop and are set `disabled={true}` while `state.kind` is in any in-flight variant. Cross-panel button disabling — e.g. preventing a user from clicking "Reset portrait" while a body generation is in flight — is currently done by gating on a single boolean `disabled` for the whole card, so this works as a side effect of the card-wide disable.
- The `/approve` route's source comments at the head of [approve/route.ts](apps/web/app/api/stories/characters/[storyCharId]/approve/route.ts) explicitly state the read/write race on the series-status check is "acceptable under single-user assumption." There is no other concurrency mitigation in the route.

### 6c. What would be exposed in a multi-actor redesign

Today the system is safe under single-user assumption because (a) one tab + one reducer + one `submittingRef` prevents double-clicks, and (b) the dashboard is single-tenant. If the redesign keeps the single-user assumption, no DB-level locks need to be added. If the redesign introduces parallel approve/regenerate operations across tabs or clients, the read-then-write series-status gate and the face-then-body sequential write in `/approve` would both need conversion to a single transactional or `FOR UPDATE`-guarded path.
