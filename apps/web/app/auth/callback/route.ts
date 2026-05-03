import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runPostLoginSideEffects } from "@/lib/server/auth-post-login";

// /auth/callback — Supabase OAuth code-exchange flow.
//
// Reads `?code=`, exchanges it for a session, runs shared post-login
// side effects, redirects to the story deep-link or `next`.
//
// The token_hash flow (Resend-delivered magic-link emails) lives at
// /auth/confirm. Both routes share `runPostLoginSideEffects` so
// instrumentation can't drift.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;

  // Story deep link params (from magic link redirect)
  const storySlug = searchParams.get("story");
  const chapter = searchParams.get("chapter");

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data.user) {
        await runPostLoginSideEffects({
          user: data.user,
          host: request.headers.get("host"),
          method: "magic_link",
        });

        // Deep link to story if params present
        if (storySlug && chapter) {
          return NextResponse.redirect(
            new URL(`/stories/${storySlug}/${chapter}`, siteUrl)
          );
        }

        return NextResponse.redirect(new URL(next, siteUrl));
      }
    } catch (err) {
      console.error("Auth callback failed:", err);
    }
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(new URL("/login?error=auth", siteUrl));
}
