/**
 * Shared Supabase cookie configuration for cross-domain sessions.
 *
 * Sessions set on access.nosafeword.co.za must be readable on nosafeword.co.za.
 * Using domain ".nosafeword.co.za" (dot-prefixed) makes cookies available
 * on all subdomains.
 *
 * In development, leave domain undefined so cookies work on localhost.
 */

export function getCookieOptions() {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN; // ".nosafeword.co.za" in production

  return {
    ...(domain && { domain }),
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
