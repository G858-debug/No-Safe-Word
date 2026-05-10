// Run with:  npx tsx --test apps/web/lib/server/series-status.test.ts
//
// Uses Node 20+ built-in test runner + a hand-rolled supabase fake.
// No real DB access. Mirrors the pattern in
// apps/web/lib/server/portrait-cascade.test.ts, with one extension:
// the fake supports a tiny PostgREST-style join resolver so
// `select("character_id, characters:character_id ( ... )")` returns
// embedded `characters` objects on each link row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAndAdvanceToImagesPending } from "./series-status";

type Row = Record<string, unknown> & { id: string };

interface SeriesRow extends Row {
  status: string;
}

interface CharacterRow extends Row {
  approved_image_id: string | null;
  approved_fullbody_image_id: string | null;
}

interface LinkRow extends Row {
  series_id: string;
  character_id: string;
}

// ─────────────────────────────────────────────────────────────────────
// Supabase fake
// Surface used by the helper:
//   .from("story_series").select("status").eq("id", ...).single()
//   .from("story_series").update({status: ...}).eq("id", ...)
//   .from("story_characters")
//     .select("character_id, characters:character_id ( ... )")
//     .eq("series_id", ...)   -- terminal await on the chain
// ─────────────────────────────────────────────────────────────────────

function makeFake(initial: {
  series: SeriesRow[];
  characters: CharacterRow[];
  links: LinkRow[];
}) {
  const series = [...initial.series];
  const characters = [...initial.characters];
  const links = [...initial.links];
  const ops: Array<{
    type: "select" | "update";
    table: string;
    cols?: string;
    filters: Array<[string, unknown]>;
    values?: Record<string, unknown>;
  }> = [];

  function rowMatches(row: Row, filters: Array<[string, unknown]>) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function from(table: string) {
    const collection: Row[] =
      table === "story_series"
        ? (series as Row[])
        : table === "story_characters"
          ? (links as Row[])
          : (characters as Row[]);

    return {
      select(cols: string) {
        const filters: Array<[string, unknown]> = [];
        const queryApi: Record<string, unknown> = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return queryApi;
          },
          async single() {
            ops.push({ type: "select", table, cols, filters });
            const hit = collection.find((r) => rowMatches(r, filters));
            return hit
              ? { data: hit, error: null }
              : { data: null, error: { message: "not found" } };
          },
          // Terminal await on the chain — used for the join SELECT.
          then(
            onFulfilled: (val: {
              data: Row[] | null;
              error: null;
            }) => unknown
          ) {
            ops.push({ type: "select", table, cols, filters });
            let hits = collection.filter((r) => rowMatches(r, filters));

            // Tiny join resolver: if cols include
            // "characters:character_id ( ... )", embed the matching
            // characters row on each result, mirroring PostgREST's
            // shape (single object, not array, when the FK is
            // single-valued).
            const joinMatch = /characters:character_id\s*\(([^)]*)\)/.exec(
              cols
            );
            if (joinMatch) {
              hits = hits.map((r) => {
                const linkRow = r as LinkRow & { characters?: unknown };
                const charId = linkRow.character_id;
                const charRow =
                  characters.find((c) => c.id === charId) ?? null;
                return { ...linkRow, characters: charRow };
              });
            }

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
    client: { from } as unknown as Parameters<
      typeof checkAndAdvanceToImagesPending
    >[0],
    series,
    characters,
    links,
    ops,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SERIES_ID = "00000000-0000-0000-0000-0000000000a1";
const CHAR_A = "00000000-0000-0000-0000-0000000000c1";
const CHAR_B = "00000000-0000-0000-0000-0000000000c2";
const FACE_A = "00000000-0000-0000-0000-0000000000f1";
const BODY_A = "00000000-0000-0000-0000-0000000000b1";
const FACE_B = "00000000-0000-0000-0000-0000000000f2";
const BODY_B = "00000000-0000-0000-0000-0000000000b2";

function draftSeries(): SeriesRow {
  return { id: SERIES_ID, status: "draft" };
}

function approvedSeries(): SeriesRow {
  return { id: SERIES_ID, status: "images_pending" };
}

function fullyApprovedChar(id: string, faceId: string, bodyId: string): CharacterRow {
  return {
    id,
    approved_image_id: faceId,
    approved_fullbody_image_id: bodyId,
  };
}

function faceOnlyChar(id: string, faceId: string): CharacterRow {
  return {
    id,
    approved_image_id: faceId,
    approved_fullbody_image_id: null,
  };
}

function unapprovedChar(id: string): CharacterRow {
  return {
    id,
    approved_image_id: null,
    approved_fullbody_image_id: null,
  };
}

function link(linkId: string, charId: string): LinkRow {
  return { id: linkId, series_id: SERIES_ID, character_id: charId };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

test("All face+body approved → advances to images_pending", async () => {
  const fake = makeFake({
    series: [draftSeries()],
    characters: [
      fullyApprovedChar(CHAR_A, FACE_A, BODY_A),
      fullyApprovedChar(CHAR_B, FACE_B, BODY_B),
    ],
    links: [link("l1", CHAR_A), link("l2", CHAR_B)],
  });

  const result = await checkAndAdvanceToImagesPending(fake.client, SERIES_ID);

  assert.equal(result.advanced, true);
  assert.equal(fake.series[0].status, "images_pending");
});

test("All faces approved, one body missing → does NOT advance", async () => {
  const fake = makeFake({
    series: [draftSeries()],
    characters: [
      fullyApprovedChar(CHAR_A, FACE_A, BODY_A),
      faceOnlyChar(CHAR_B, FACE_B), // body missing
    ],
    links: [link("l1", CHAR_A), link("l2", CHAR_B)],
  });

  const result = await checkAndAdvanceToImagesPending(fake.client, SERIES_ID);

  assert.equal(result.advanced, false);
  assert.equal(fake.series[0].status, "draft");
});

test("One face missing → does NOT advance", async () => {
  const fake = makeFake({
    series: [draftSeries()],
    characters: [
      fullyApprovedChar(CHAR_A, FACE_A, BODY_A),
      unapprovedChar(CHAR_B), // neither face nor body
    ],
    links: [link("l1", CHAR_A), link("l2", CHAR_B)],
  });

  const result = await checkAndAdvanceToImagesPending(fake.client, SERIES_ID);

  assert.equal(result.advanced, false);
  assert.equal(fake.series[0].status, "draft");
});

test("Series already in images_pending → no-op (advanced:false)", async () => {
  const fake = makeFake({
    series: [approvedSeries()],
    characters: [
      fullyApprovedChar(CHAR_A, FACE_A, BODY_A),
      fullyApprovedChar(CHAR_B, FACE_B, BODY_B),
    ],
    links: [link("l1", CHAR_A), link("l2", CHAR_B)],
  });

  const result = await checkAndAdvanceToImagesPending(fake.client, SERIES_ID);

  assert.equal(result.advanced, false);
  // Status unchanged; helper short-circuited before reading characters.
  assert.equal(fake.series[0].status, "images_pending");
});

test("Zero characters in series → does NOT advance", async () => {
  const fake = makeFake({
    series: [draftSeries()],
    characters: [],
    links: [], // no story_characters rows
  });

  const result = await checkAndAdvanceToImagesPending(fake.client, SERIES_ID);

  assert.equal(result.advanced, false);
  assert.equal(fake.series[0].status, "draft");
});
