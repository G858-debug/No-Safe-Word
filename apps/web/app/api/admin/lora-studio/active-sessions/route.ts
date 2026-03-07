import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("nsw_lora_sessions")
      .select("id", { count: "exact", head: true })
      .neq("status", "complete");

    return NextResponse.json({ hasActive: (count ?? 0) > 0 });
  } catch {
    return NextResponse.json({ hasActive: false });
  }
}
