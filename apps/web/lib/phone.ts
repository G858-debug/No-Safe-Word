// Multi-country phone parser for the email-gate WhatsApp number field.
// Returns an E.164-normalised number (`+27821234567`) or a user-facing
// error message. Designed to handle the common SA local form, the
// already-international form, and a small set of other African + NANP +
// UK country codes. Anything else falls back to ambiguous-error so the
// Phase C.3 Gemini fallback can take a swing.

export type PhoneParseResult =
  | { ok: true; e164: string }
  | { ok: false; error: string };

// Country codes the parser will accept WITHOUT a leading + sign. Order
// is irrelevant for storage; the loop below sorts by length descending so
// "234" wins over "27" and "1" for an input that starts with 234.
//
// Each entry locks the *total* digit length (including the country code)
// to the country's documented mobile range. Without this, a 9-digit
// number beginning with "1" would parse as a malformed +1 number; the
// stricter check forces it into the ambiguous-error branch.
const COUNTRY_RULES: Array<{
  cc: string;
  minTotal: number;
  maxTotal: number;
}> = [
  { cc: "1", minTotal: 11, maxTotal: 11 }, // US/Canada (NANP)
  { cc: "27", minTotal: 11, maxTotal: 11 }, // South Africa
  { cc: "44", minTotal: 12, maxTotal: 13 }, // United Kingdom
  { cc: "234", minTotal: 13, maxTotal: 14 }, // Nigeria
  { cc: "254", minTotal: 12, maxTotal: 12 }, // Kenya
  { cc: "263", minTotal: 12, maxTotal: 12 }, // Zimbabwe
  { cc: "267", minTotal: 11, maxTotal: 11 }, // Botswana
  { cc: "880", minTotal: 13, maxTotal: 13 }, // Bangladesh
];

const ERR_TOO_SHORT =
  "That number is too short. Try the full number including country code, e.g. +27 82 123 4567.";
const ERR_TOO_LONG = "That number is too long. Check for extra digits.";
const ERR_HAS_LETTERS =
  "That looks like it has letters in it. Mobile numbers should only contain digits and a country code prefix.";
const ERR_AMBIGUOUS =
  "We can't tell what country this number is from. Please include the country code with a + prefix.";

export function parsePhone(input: string): PhoneParseResult {
  if (typeof input !== "string") {
    return { ok: false, error: ERR_HAS_LETTERS };
  }

  // 1. Strip whitespace, hyphens, parentheses, and dots.
  const stripped = input.replace(/[\s\-().]/g, "");

  if (stripped.length === 0) {
    return { ok: false, error: ERR_TOO_SHORT };
  }

  // Anything other than digits (with an optional leading +) is rejected —
  // catches "abc123" and similar paste mistakes before we trust the
  // input downstream.
  if (!/^\+?\d+$/.test(stripped)) {
    return { ok: false, error: ERR_HAS_LETTERS };
  }

  // 2. Already in E.164 form: validate the digit count and return as-is.
  if (stripped.startsWith("+")) {
    const rest = stripped.slice(1);
    return validateE164(rest);
  }

  // 3. International dial prefix "00" → equivalent to "+".
  if (stripped.startsWith("00")) {
    const rest = stripped.slice(2);
    return validateE164(rest);
  }

  // 4. SA local format: "0" + 9 digits → strip the 0, prepend +27.
  if (stripped.startsWith("0") && stripped.length === 10) {
    return { ok: true, e164: `+27${stripped.slice(1)}` };
  }

  // 4b. Bangladesh local format: "0" + 10 digits -> strip the 0, prepend +880.
  if (stripped.startsWith("0") && stripped.length === 11) {
    return { ok: true, e164: `+880${stripped.slice(1)}` };
  }

  // 5. SA international form without the +: "27" + 9 digits.
  if (/^27\d{9}$/.test(stripped)) {
    return { ok: true, e164: `+${stripped}` };
  }

  // Length sanity gate before per-country probing so the
  // ambiguous-error message is reserved for "valid-looking but
  // unidentifiable" inputs.
  if (stripped.length < 8) {
    return { ok: false, error: ERR_TOO_SHORT };
  }
  if (stripped.length > 15) {
    return { ok: false, error: ERR_TOO_LONG };
  }

  // 6. Per-country prefix probe. Longest prefix first — "234" must beat
  //    "27" and "2" should the latter ever be added.
  const sorted = [...COUNTRY_RULES].sort(
    (a, b) => b.cc.length - a.cc.length
  );
  for (const rule of sorted) {
    if (
      stripped.startsWith(rule.cc) &&
      stripped.length >= rule.minTotal &&
      stripped.length <= rule.maxTotal
    ) {
      return { ok: true, e164: `+${stripped}` };
    }
  }

  return { ok: false, error: ERR_AMBIGUOUS };
}

function validateE164(rest: string): PhoneParseResult {
  if (rest.length < 8) return { ok: false, error: ERR_TOO_SHORT };
  if (rest.length > 15) return { ok: false, error: ERR_TOO_LONG };
  // E.164 disallows a leading zero on the country code.
  if (!/^[1-9]/.test(rest)) return { ok: false, error: ERR_AMBIGUOUS };
  return { ok: true, e164: `+${rest}` };
}
