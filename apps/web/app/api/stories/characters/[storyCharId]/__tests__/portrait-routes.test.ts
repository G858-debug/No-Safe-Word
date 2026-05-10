// Run with:  npx tsx --test "apps/web/app/api/stories/characters/[storyCharId]/__tests__/portrait-routes.test.ts"
//
// Scope: route-level input-validation paths that fail BEFORE touching the
// supabase singleton. The cascade-bearing logic for /revoke-face is fully
// covered by lib/server/portrait-cascade.test.ts (the route is a thin
// wrapper). End-to-end route behaviour (approve-face Storage upload,
// approve-body face precondition, etc.) is exercised by the manual test
// plan in the PR description until the repo grows a supabase module-mock
// harness — see note at the bottom of this file.

import { test } from "node:test";
import assert from "node:assert/strict";

import { POST as approveFacePOST } from "../approve-face/route";
import { POST as approveBodyPOST } from "../approve-body/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fakeParams = (id = "00000000-0000-0000-0000-00000000aaaa") => ({
  params: Promise.resolve({ storyCharId: id }),
});

test("/approve-face returns 400 when face_image_id is missing", async () => {
  const req = jsonRequest({}) as unknown as import("next/server").NextRequest;
  const res = await approveFacePOST(req, fakeParams());
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /face_image_id is required/);
});

test("/approve-body returns 400 when body_image_id is missing", async () => {
  const req = jsonRequest({}) as unknown as import("next/server").NextRequest;
  const res = await approveBodyPOST(req, fakeParams());
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /body_image_id is required/);
});

// ──────────────────────────────────────────────────────────────────────────
// Coverage gap (intentional, to be addressed in a follow-up)
// ──────────────────────────────────────────────────────────────────────────
//
// The remaining behaviours below depend on intercepting the module-level
// `supabase` singleton imported by the route handlers from
// `@no-safe-word/story-engine`. Node 20's built-in test runner has no
// supported module-mock primitive (mock.module landed in Node 22.3); the
// repo's existing test files (story-import.test.ts, etc.) work around this
// by writing the production code as pure functions that take the supabase
// client as a parameter. The cascade helper tests follow that pattern.
//
// To bring these under automated coverage, a follow-up PR can either:
//   (a) extract the per-route logic into pure helpers in
//       apps/web/lib/server/portrait-approvals.ts and write tests against
//       those helpers (similar to lib/server/portrait-cascade.test.ts), or
//   (b) introduce a test-only module-resolution shim (custom loader or
//       Node 22 upgrade with mock.module).
//
// Until then, the manual test plan in the PR description is authoritative
// for these cases:
//   - /approve-face happy path (face DB write, sfw_url → Storage upload,
//     series-status advance via checkAndAdvanceToImagesPending)
//   - /approve-face rejects unknown image id (404)
//   - /approve-face rejects image not belonging to this character (403)
//   - /approve-face invokes checkAndAdvanceToImagesPending with the
//     correct series_id (helper logic itself covered by
//     series-status.test.ts)
//   - /approve-body happy path (body DB write, body_invalidated_at cleared,
//     series-status advance via checkAndAdvanceToImagesPending)
//   - /approve-body rejects with 400 when face is not approved
//   - /approve-body rejects body not belonging to character (403)
//   - /approve-body invokes checkAndAdvanceToImagesPending with the
//     correct series_id (helper logic itself covered by
//     series-status.test.ts)
//   - /revoke-face cascades correctly across the four body states
//     (already covered transitively by portrait-cascade.test.ts)
//   - /revoke-body clears approved_fullbody_image_id only and never
//     touches body_invalidated_at or any face column
