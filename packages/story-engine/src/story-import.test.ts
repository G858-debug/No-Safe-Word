// Run with:  npm test --workspace=@no-safe-word/story-engine
// or directly: npx tsx --test packages/story-engine/src/story-import.test.ts
//
// Uses Node 20+ built-in test runner + a hand-rolled supabase fake
// passed via DI. No real DB access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertCharacter } from "./story-import";
import type { CharacterImport } from "@no-safe-word/shared";

// ───────────────────────────────────────────────────────────────────────
// Minimal supabase fake — implements just the methods upsertCharacter
// uses against the `characters` table:
//   .from("characters")
//     .select(cols).eq(...).eq(...).maybeSingle()
//     .update(values).eq(col, val)
//     .insert(row).select(cols).single()
// ───────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string };

interface Op {
  type: "select" | "update" | "insert";
  table: string;
  filters: Array<[string, unknown]>;
  values?: Record<string, unknown>;
}

function makeFake(initialRows: Row[]) {
  const rows: Row[] = [...initialRows];
  const ops: Op[] = [];
  let idCounter = 1000;

  function rowMatches(row: Row, filters: Array<[string, unknown]>): boolean {
    return filters.every(([col, val]) => row[col] === val);
  }

  function from(table: string) {
    return {
      select(_cols: string) {
        const filters: Array<[string, unknown]> = [];
        const queryApi = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return queryApi;
          },
          async maybeSingle() {
            ops.push({ type: "select", table, filters });
            const hit = rows.find((r) => rowMatches(r, filters));
            return { data: hit ?? null, error: null };
          },
          async single() {
            ops.push({ type: "select", table, filters });
            const hit = rows.find((r) => rowMatches(r, filters));
            return hit
              ? { data: hit, error: null }
              : { data: null, error: { message: "not found" } };
          },
        };
        return queryApi;
      },
      update(values: Record<string, unknown>) {
        const filters: Array<[string, unknown]> = [];
        const updateApi = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            ops.push({ type: "update", table, filters, values });
            const hit = rows.find((r) => rowMatches(r, filters));
            if (hit) Object.assign(hit, values);
            return Promise.resolve({ error: null });
          },
        };
        return updateApi;
      },
      insert(values: Record<string, unknown>) {
        ops.push({ type: "insert", table, filters: [], values });
        const newRow: Row = { id: `gen-${++idCounter}`, ...values };
        rows.push(newRow);
        const insertApi = {
          select(_cols: string) {
            return {
              async single() {
                return { data: newRow, error: null };
              },
            };
          },
        };
        return insertApi;
      },
    };
  }

  return {
    // Cast through unknown to bypass the full SupabaseClient surface;
    // upsertCharacter only ever calls .from("characters").{select|update|insert}.
    client: { from } as unknown as Parameters<typeof upsertCharacter>[2],
    rows,
    ops,
  };
}

const STRUCTURED = {
  gender: "female",
  age: "26",
  ethnicity: "Black South African",
  bodyType: "athletic",
  hairColor: "black",
  hairStyle: "braided",
  eyeColor: "brown",
  skinTone: "deep brown",
  distinguishingFeatures: "—",
  clothing: "shweshwe dress",
  expression: "warm",
  pose: "standing",
};

const AUTHOR_A = "00000000-0000-0000-0000-00000000000a";
const AUTHOR_B = "00000000-0000-0000-0000-00000000000b";

const baseImport: CharacterImport = {
  name: "Lindiwe",
  role: "protagonist",
  prose_description: "—",
  structured: STRUCTURED,
};

// ───────────────────────────────────────────────────────────────────────
// Case 1: slug match → reuse same row
// ───────────────────────────────────────────────────────────────────────
test("slug match reuses existing row and refreshes profile fields", async () => {
  const existing: Row = {
    id: "char-1",
    name: "Lindiwe",
    author_id: AUTHOR_A,
    character_slug: "lindiwe",
    approved_image_id: "img-face-1",
    approved_fullbody_image_id: "img-body-1",
    archetype_tag: "the rival",
  };
  const fake = makeFake([existing]);

  const result = await upsertCharacter(
    {
      ...baseImport,
      character_slug: "lindiwe",
      archetype_tag: "the survivor",
      vibe_line: "evolved",
    },
    AUTHOR_A,
    fake.client
  );

  assert.equal(result.id, "char-1", "reused the existing row");
  assert.equal(result.action, "reused");
  // Approved FKs untouched
  assert.equal(existing.approved_image_id, "img-face-1");
  assert.equal(existing.approved_fullbody_image_id, "img-body-1");
  // Profile fields refreshed
  assert.equal(existing.archetype_tag, "the survivor");
  assert.equal(existing.vibe_line, "evolved");
  // No insert
  assert.equal(
    fake.ops.some((o) => o.type === "insert"),
    false
  );
});

// ───────────────────────────────────────────────────────────────────────
// Case 2: slug absent + name match → reuse + slug attachment
// ───────────────────────────────────────────────────────────────────────
test("slug absent + name match reuses row and opportunistically attaches slug", async () => {
  const existing: Row = {
    id: "char-2",
    name: "Sibusiso",
    author_id: AUTHOR_A,
    character_slug: null,
    approved_image_id: "img-face-2",
  };
  const fake = makeFake([existing]);

  const result = await upsertCharacter(
    { ...baseImport, name: "Sibusiso", character_slug: "sibusiso" },
    AUTHOR_A,
    fake.client
  );

  assert.equal(result.id, "char-2");
  assert.equal(result.action, "name_matched");
  // Slug now attached
  assert.equal(existing.character_slug, "sibusiso");
  // FK untouched
  assert.equal(existing.approved_image_id, "img-face-2");
});

test("slug absent + name match without slug in payload leaves slug null", async () => {
  const existing: Row = {
    id: "char-2b",
    name: "Sibusiso",
    author_id: AUTHOR_A,
    character_slug: null,
  };
  const fake = makeFake([existing]);

  const result = await upsertCharacter(
    { ...baseImport, name: "Sibusiso" },
    AUTHOR_A,
    fake.client
  );

  assert.equal(result.action, "name_matched");
  assert.equal(existing.character_slug, null);
});

// ───────────────────────────────────────────────────────────────────────
// Case 3: slug absent + name miss → fresh insert
// ───────────────────────────────────────────────────────────────────────
test("slug absent + name miss inserts a fresh character row", async () => {
  const fake = makeFake([]);

  const result = await upsertCharacter(
    { ...baseImport, name: "Themba" },
    AUTHOR_A,
    fake.client
  );

  assert.equal(result.action, "created");
  assert.ok(result.id, "got an id");
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.rows[0].name, "Themba");
  assert.equal(fake.rows[0].author_id, AUTHOR_A);
});

// ───────────────────────────────────────────────────────────────────────
// Case 4: slug present + author mismatch → fresh insert (per-author scope)
// ───────────────────────────────────────────────────────────────────────
test("slug present but belongs to different author inserts new row", async () => {
  const otherAuthorRow: Row = {
    id: "char-other",
    name: "Lindiwe",
    author_id: AUTHOR_A,
    character_slug: "lindiwe",
    approved_image_id: "img-face-A",
  };
  const fake = makeFake([otherAuthorRow]);

  // Same slug, different author → must NOT reuse author A's row.
  const result = await upsertCharacter(
    { ...baseImport, character_slug: "lindiwe" },
    AUTHOR_B,
    fake.client
  );

  assert.equal(result.action, "created");
  assert.notEqual(result.id, "char-other");
  // Author A's row untouched
  assert.equal(otherAuthorRow.id, "char-other");
  assert.equal(otherAuthorRow.approved_image_id, "img-face-A");
  // New row exists for author B
  const authorBRow = fake.rows.find((r) => r.author_id === AUTHOR_B);
  assert.ok(authorBRow);
  assert.equal(authorBRow!.character_slug, "lindiwe");
});
