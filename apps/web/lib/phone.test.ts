// Run with:  npx tsx --test apps/web/lib/phone.test.ts
//
// Uses Node 20+ built-in test runner. No new dev deps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhone } from "./phone";

function expectOk(input: string, expected: string) {
  const result = parsePhone(input);
  assert.deepEqual(
    result,
    { ok: true, e164: expected },
    `expected ${input} → ${expected}, got ${JSON.stringify(result)}`
  );
}

function expectErr(input: string, errorIncludes: string) {
  const result = parsePhone(input);
  assert.equal(result.ok, false, `expected ${input} to fail, got ${JSON.stringify(result)}`);
  if (result.ok === false) {
    assert.match(result.error, new RegExp(errorIncludes));
  }
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test("SA local 10-digit form → E.164", () => {
  expectOk("0821234567", "+27821234567");
});

test("SA international with + and spaces → E.164", () => {
  expectOk("+27 82 123 4567", "+27821234567");
});

test("SA local with spaces → E.164", () => {
  expectOk("082 123 4567", "+27821234567");
});

test("SA international without + → E.164", () => {
  expectOk("27821234567", "+27821234567");
});

test("US NANP with + and spaces → E.164", () => {
  expectOk("+1 555 123 4567", "+15551234567");
});

test("UK already in E.164 → unchanged", () => {
  expectOk("+447911123456", "+447911123456");
});

test("00 international prefix → +", () => {
  expectOk("0027821234567", "+27821234567");
});

test("hyphens and parens are stripped", () => {
  expectOk("(082) 123-4567", "+27821234567");
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

test("too short → too-short error", () => {
  expectErr("123", "too short");
});

test("non-numeric → letters error", () => {
  expectErr("abc123", "letters");
});

test("too long → too-long error", () => {
  expectErr("01234567890123456", "too long");
});

test("ambiguous (1 + 8 digits) → ambiguous error", () => {
  // 9 digits starting with 1 is not a valid +1 (NANP requires 11 total).
  expectErr("123456789", "country");
});

test("empty string → too-short error", () => {
  expectErr("", "too short");
});

test("E.164 with leading zero on country code → ambiguous", () => {
  // "+0..." is invalid per E.164 — country codes can't start with 0.
  expectErr("+0821234567", "country");
});
