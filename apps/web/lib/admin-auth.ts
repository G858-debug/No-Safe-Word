import { createHmac } from "crypto";
import { type ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

const COOKIE_NAME = "admin-session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function generateSessionToken(password: string): string {
  return createHmac("sha256", password)
    .update("nsw-admin-session")
    .digest("hex");
}

export function validateSessionToken(token: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const expected = generateSessionToken(adminPassword);
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
