import { type ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

const COOKIE_NAME = "admin-session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Use Web Crypto API (works in Edge Runtime, unlike Node.js crypto)
export async function generateSessionToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("nsw-admin-session")
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateSessionToken(token: string): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const expected = await generateSessionToken(adminPassword);
  return token === expected;
}

export function getSessionCookieOptions(): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  };
}

export { COOKIE_NAME };
