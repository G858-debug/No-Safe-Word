// Run with:  npx tsx --test apps/web/lib/server/portrait-cascade.test.ts
//
// Uses Node 20+ built-in test runner + a hand-rolled supabase fake.
// No real DB access. Mirrors the pattern in
// packages/story-engine/src/story-import.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runFaceRevokeCascade } from "./portrait-cascade";

type Row = Record<string, unknown> & { id: string };

interface CharacterRow extends Row {
  approved_image_id: string | null;
  approved_fullbody_image_id: string | null;
  approved_seed: number | null;
  approved_prompt: string | null;
  portrait_prompt_locked: string | null;
  body_invalidated_at: string | null;
}

interface ImageRow extends Row {
  character_id: string;
  settings: Record<string, unknown> | null;
}

// ───────────────────────────────────────────────────────────────────────
// Supabase fake: implements only the surface runFaceRevokeCascade uses:
//   .from("characters").select("...").eq(...).single()
//   .from("characters").update({...}).eq(...)
//   .from("images").select("id").eq(...).filter("settings->>imageType","eq","body").limit(1)
// ───────────────────────────────────────────────────────────────────────

function makeFake(initial: {
  characters: CharacterRow[];
  images: ImageRow[];
}) {
  const characters = [...initial.characters];
  const images = [...initial.images];
  const ops: Array<{
    type: "select" | "update";
    table: string;
    filters: Array<[string, unknown]>;
    values?: Record<string, unknown>;
  }> = [];

  function rowMatches(row: Row, filters: Array<[string, unknown]>) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function getJsonPath(row: Row, path: string): unknown {
    // Supports just the one operator the cascade uses: settings->>imageType
    if (path === "settings->>imageType") {
      const settings = (row as ImageRow).settings;
      return settings?.imageType ?? null;
    }
    return undefined;
  }

  function from(table: string) {
    const collection: Row[] =
      table === "characters" ? (characters as Row[]) : (images as Row[]);

    return {
      select(_cols: string) {
        const filters: Array<[string, unknown]> = [];
        const jsonFilters: Array<[string, string, unknown]> = [];
        let limitN: number | null = null;

        const queryApi: any = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return queryApi;
          },
          filter(col: string, op: string, val: unknown) {
            // Only "eq" implemented — that's all the cascade uses.
            jsonFilters.push([col, op, val]);
            return queryApi;
          },
          limit(n: number) {
            limitN = n;
            return queryApi;
          },
          async single() {
            ops.push({ type: "select", table, filters });
            const hit = collection.find((r) => rowMatches(r, filters));
            return hit
              ? { data: hit, error: null }
              : { data: null, error: { message: "not found" } };
          },
          // The cascade uses .limit(1) without await on the chain; the
          // chain itself must be awaitable to yield { data, error }.
          then(onFulfilled: (val: { data: Row[] | null; error: null }) => unknown) {
            ops.push({ type: "select", table, filters });
            let hits = collection.filter((r) => rowMatches(r, filters));
            for (const [col, op, val] of jsonFilters) {
              if (op === "eq") {
                hits = hits.filter((r) => getJsonPath(r, col) === val);
              }
            }
            if (limitN != null) hits = hits.slice(0, limitN);
            return Promise.resolve({ data: hits, error: null }).then(
              onFulfilled
            );
          },
        };
        return queryApi;
      },
      update(values: Record<string, unknown>) {
        const filters: Array<[string, unknown]> = [];
        return {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            ops.push({ type: "update", table, filters, values });
            const hit = collection.find((r) => rowMatches(r, filters));
            if (hit) Object.assign(hit, values);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }

  return {
    client: { from } as unknown as Parameters<typeof runFaceRevokeCascade>[0],
    characters,
    images,
    ops,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

const CHAR_ID = "00000000-0000-0000-0000-00000000aaaa";
const FACE_ID = "00000000-0000-0000-0000-00000000ff01";
const BODY_ID = "00000000-0000-0000-0000-00000000bb01";

function approvedCharacter(): CharacterRow {
  return {
    id: CHAR_ID,
    approved_image_id: FACE_ID,
    approved_fullbody_image_id: BODY_ID,
    approved_seed: null,
    approved_prompt: "approved face prompt",
    portrait_prompt_locked: "locked face prompt",
    body_invalidated_at: null,
  };
}

function bodyImage(id = BODY_ID): ImageRow {
  return {
    id,
    character_id: CHAR_ID,
    settings: { imageType: "body" },
  };
}

function nonBodyImage(id: string): ImageRow {
  return {
    id,
    character_id: CHAR_ID,
    settings: { imageType: "face" },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

test("Approved face + approved body → cascades, body image preserved", async () => {
  const fake = makeFake({
    characters: [approvedCharacter()],
    images: [bodyImage(), nonBodyImage(FACE_ID)],
  });

  const result = await runFaceRevokeCascade(fake.client, CHAR_ID);

  assert.equal(result.ok, true);
  assert.equal(result.cascaded, true);

  const c = fake.characters[0];
  assert.equal(c.approved_image_id, null);
  assert.equal(c.approved_fullbody_image_id, null);
  assert.equal(c.approved_seed, null);
  assert.equal(c.approved_prompt, null);
  assert.equal(c.portrait_prompt_locked, null);
  assert.notEqual(c.body_invalidated_at, null);
  // Body image row preserved.
  assert.equal(fake.images.some((i) => i.id === BODY_ID), true);
});

test("Approved face + Generated-unapproved body (no approved_fullbody_image_id) → cascades", async () => {
  const char = approvedCharacter();
  char.approved_fullbody_image_id = null; // body never approved
  const fake = makeFake({
    characters: [char],
    images: [bodyImage()], // body image exists in `images` table
  });

  const result = await runFaceRevokeCascade(fake.client, CHAR_ID);

  assert.equal(result.ok, true);
  assert.equal(result.cascaded, true);
  assert.equal(fake.characters[0].approved_image_id, null);
  assert.notEqual(fake.characters[0].body_invalidated_at, null);
});

test("Approved face only, no body anywhere → face cleared, body_invalidated_at stays NULL", async () => {
  const char = approvedCharacter();
  char.approved_fullbody_image_id = null;
  const fake = makeFake({
    characters: [char],
    images: [nonBodyImage(FACE_ID)], // only a face image, no body
  });

  const result = await runFaceRevokeCascade(fake.client, CHAR_ID);

  assert.equal(result.ok, true);
  assert.equal(result.cascaded, false);
  assert.equal(fake.characters[0].approved_image_id, null);
  assert.equal(fake.characters[0].approved_fullbody_image_id, null);
  assert.equal(fake.characters[0].body_invalidated_at, null);
});

test("Idempotent: second call when face is already cleared", async () => {
  const fake = makeFake({
    characters: [approvedCharacter()],
    images: [bodyImage()],
  });

  const r1 = await runFaceRevokeCascade(fake.client, CHAR_ID);
  const firstInvalidatedAt = fake.characters[0].body_invalidated_at;

  const r2 = await runFaceRevokeCascade(fake.client, CHAR_ID);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  // Second call still detects body image and cascades.
  assert.equal(r2.cascaded, true);
  // Face stays cleared (idempotent).
  assert.equal(fake.characters[0].approved_image_id, null);
  // body_invalidated_at may be re-set to a new now() — that's acceptable.
  assert.notEqual(fake.characters[0].body_invalidated_at, null);
  // We don't assert equality with firstInvalidatedAt — re-stamping is fine.
  void firstInvalidatedAt;
});

test("Character not found returns ok:false with error", async () => {
  const fake = makeFake({ characters: [], images: [] });

  const result = await runFaceRevokeCascade(fake.client, CHAR_ID);

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not found/i);
});
