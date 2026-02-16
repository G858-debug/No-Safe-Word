import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// PATCH /api/stories/posts/[postId] — Update individual post content
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ postId: string }> }
) {
  const params = await props.params;
  const { postId } = params;
  const body = await request.json();

  const allowedFields = [
    "title",
    "facebook_content",
    "website_content",
    "facebook_teaser",
    "facebook_comment",
    "hashtags",
    "status",
    "scheduled_for",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("story_posts")
    .update(updates)
    .eq("id", postId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ post: data });
}
