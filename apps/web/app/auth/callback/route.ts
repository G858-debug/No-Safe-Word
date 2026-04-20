import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import { logEvent } from "@/lib/server/events";

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
        // Upsert nsw_users record using service role client
        const { email, id: authUserId } = data.user;
        if (email) {
          await serviceClient.from("nsw_users").upsert(
            {
              auth_user_id: authUserId,
              email,
              has_email: true,
            },
            { onConflict: "auth_user_id" }
          );
        }

        // Analytics: successful sign-in via magic-link flow.
        await logEvent({
          eventType: "auth.sign_in_verified",
          userId: authUserId,
          metadata: { method: "magic_link" },
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
