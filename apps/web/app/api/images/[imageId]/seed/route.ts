import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/images/[imageId]/seed — Returns the seed from an image's settings
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ imageId: string }> }
) {
  const { imageId } = await props.params;

  const { data, error } = await supabase
    .from("images")
    .select("settings")
    .eq("id", imageId)
    .single();

  if (error || !data) {
    return NextResponse.json({ seed: null }, { status: 404 });
  }

  const settings = data.settings as Record<string, unknown> | null;
  const seed = settings?.seed ?? null;

  return NextResponse.json({ seed });
}
