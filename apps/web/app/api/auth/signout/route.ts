import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/server/events";

export async function POST() {
  const supabase = await createClient();

  // Analytics: capture user BEFORE signOut so we can tie the event to them.
  // If there's no session, emit an anonymous sign_out (rare edge case).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logEvent({
    eventType: "auth.sign_out",
    userId: user?.id ?? null,
  });

  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
