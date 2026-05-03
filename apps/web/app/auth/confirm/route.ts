import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runPostLoginSideEffects } from "@/lib/server/auth-post-login";

// /auth/confirm — token_hash flow for magic-link emails delivered via
// Resend. Companion to /auth/callback (which handles ?code=).
//
// Email link shape:
//   /auth/confirm?token_hash=<hash>&type=magiclink&next=<absolute or path>
//
// On success: verifyOtp sets the Supabase session cookie via the SSR
// client, the shared post-login helper runs (nsw_users upsert + sign-in
// telemetry + first-time nurture dispatch), then we 302 to `next`
// (or "/" if missing or invalid).
//
// On failure: 302 to /login?error=link_expired so the user gets a
// recoverable surface rather than a stack trace.
//
// POST is supported in case a future channel POSTs the token (the
// payload shape is identical — we read from the URL).

async function handle(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const nextRaw = searchParams.get("next");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;

  if (!tokenHash || type !== "magiclink") {
    return NextResponse.redirect(new URL("/login?error=link_expired", siteUrl));
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

    if (error || !data.user) {
      console.warn("[auth/confirm] verifyOtp failed:", error?.message);
      return NextResponse.redirect(
        new URL("/login?error=link_expired", siteUrl)
      );
    }

    await runPostLoginSideEffects({
      user: data.user,
      host: request.headers.get("host"),
      method: "magic_link",
    });

    return NextResponse.redirect(resolveNext(nextRaw, siteUrl));
  } catch (err) {
    console.error("[auth/confirm] threw:", err);
    return NextResponse.redirect(new URL("/login?error=link_expired", siteUrl));
  }
}

// Resolve the `next` param against the site origin. Accepts either an
// absolute URL on this site or a path. Anything else (off-site URL,
// protocol-relative, malformed) falls back to "/" so a malicious
// email can't redirect users away from us after auth.
function resolveNext(nextRaw: string | null, siteUrl: string): URL {
  if (!nextRaw) return new URL("/", siteUrl);

  // Path-relative
  if (nextRaw.startsWith("/") && !nextRaw.startsWith("//")) {
    return new URL(nextRaw, siteUrl);
  }

  // Absolute — must be same origin as siteUrl
  try {
    const candidate = new URL(nextRaw);
    const site = new URL(siteUrl);
    if (candidate.origin === site.origin) {
      return candidate;
    }
  } catch {
    // fall through
  }
  return new URL("/", siteUrl);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
