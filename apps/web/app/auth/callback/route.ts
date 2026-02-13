import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";

  if (code) {
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
          },
          { onConflict: "auth_user_id" }
        );
      }

      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(new URL("/login", origin));
}
