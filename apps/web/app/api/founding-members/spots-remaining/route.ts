import { NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

const FOUNDING_CAP = 100;

export async function GET() {
  const { count, error } = await supabase
    .from("nsw_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("is_founding_member", true)
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch count" }, { status: 500 });
  }

  const taken = count ?? 0;
  const remaining = Math.max(0, FOUNDING_CAP - taken);

  return NextResponse.json(
    { remaining, cap: FOUNDING_CAP },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    }
  );
}
