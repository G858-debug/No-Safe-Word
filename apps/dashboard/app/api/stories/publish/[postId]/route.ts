import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

const GRAPH_API = "https://graph.facebook.com/v19.0";

interface FacebookPhotoResponse {
  id: string;
  post_id?: string;
}

// POST /api/stories/publish/[postId] — Publish a single post to Facebook
export async function POST(
  request: NextRequest,
  { params }: { params: { postId: string } }
) {
  const { postId } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { platforms = ["facebook"] } = body as { platforms?: string[] };

    if (!platforms.includes("facebook")) {
      return NextResponse.json(
        { error: "Only 'facebook' platform is currently supported" },
        { status: 400 }
      );
    }

    const pageId = process.env.FACEBOOK_PAGE_ID;
    const pageToken = process.env.FACEBOOK_PAGE_TOKEN;

    if (!pageId || !pageToken) {
      return NextResponse.json(
        {
          error: "Facebook publishing is not configured",
          details:
            "Set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN environment variables. " +
            "Get a Page Access Token from Facebook Developer Console → Your App → " +
            "Tools → Graph API Explorer → select your page → generate token.",
        },
        { status: 400 }
      );
    }

    // 1. Fetch the post
    const { data: post, error: postError } = await supabase
      .from("story_posts")
      .select(
        "id, facebook_content, facebook_comment, facebook_post_id, status"
      )
      .eq("id", postId)
      .single();

    if (postError || !post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    if (post.status === "published") {
      return NextResponse.json(
        {
          error: "Post is already published",
          facebook_post_id: post.facebook_post_id,
        },
        { status: 409 }
      );
    }

    // 2. Fetch the approved facebook_sfw image for this post
    const { data: imagePrompts } = await supabase
      .from("story_image_prompts")
      .select("id, image_id, position")
      .eq("post_id", postId)
      .eq("image_type", "facebook_sfw")
      .eq("status", "approved")
      .order("position", { ascending: true })
      .limit(1);

    let imageUrl: string | null = null;

    if (imagePrompts && imagePrompts.length > 0 && imagePrompts[0].image_id) {
      const { data: image } = await supabase
        .from("images")
        .select("stored_url, sfw_url")
        .eq("id", imagePrompts[0].image_id)
        .single();

      imageUrl = image?.stored_url || image?.sfw_url || null;
    }

    // 3. Publish to Facebook
    let facebookPostId: string;

    if (imageUrl) {
      // Photo post with message
      const photoResponse = await fetch(
        `${GRAPH_API}/${pageId}/photos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: imageUrl,
            message: post.facebook_content,
            access_token: pageToken,
          }),
        }
      );

      if (!photoResponse.ok) {
        const fbError = await photoResponse.text();
        return NextResponse.json(
          {
            error: "Facebook API error",
            details: fbError,
            status_code: photoResponse.status,
          },
          { status: 502 }
        );
      }

      const photoData: FacebookPhotoResponse = await photoResponse.json();
      facebookPostId = photoData.post_id || photoData.id;
    } else {
      // Text-only post (fallback if no approved image)
      const feedResponse = await fetch(
        `${GRAPH_API}/${pageId}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: post.facebook_content,
            access_token: pageToken,
          }),
        }
      );

      if (!feedResponse.ok) {
        const fbError = await feedResponse.text();
        return NextResponse.json(
          {
            error: "Facebook API error",
            details: fbError,
            status_code: feedResponse.status,
          },
          { status: 502 }
        );
      }

      const feedData: { id: string } = await feedResponse.json();
      facebookPostId = feedData.id;
    }

    // 4. Post the first comment if facebook_comment exists
    if (post.facebook_comment && facebookPostId) {
      const commentResponse = await fetch(
        `${GRAPH_API}/${facebookPostId}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: post.facebook_comment,
            access_token: pageToken,
          }),
        }
      );

      if (!commentResponse.ok) {
        // Log but don't fail the whole publish
        const commentError = await commentResponse.text();
        console.warn(
          `Failed to post comment on ${facebookPostId}:`,
          commentError
        );
      }
    }

    // 5. Update the post status
    const publishedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("story_posts")
      .update({
        facebook_post_id: facebookPostId,
        published_at: publishedAt,
        status: "published",
      })
      .eq("id", postId);

    if (updateError) {
      console.error("Failed to update post status:", updateError.message);
    }

    return NextResponse.json({
      facebook_post_id: facebookPostId,
      published_at: publishedAt,
    });
  } catch (err) {
    console.error("Publish failed:", err);
    return NextResponse.json(
      {
        error: "Publish failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
