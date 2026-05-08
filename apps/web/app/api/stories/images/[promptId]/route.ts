import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/stories/images/[promptId] — Fetch full image prompt data
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const { data: imgPrompt, error } = await supabase
      .from("story_image_prompts")
      .select("*")
      .eq("id", promptId)
      .single();

    if (error || !imgPrompt) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(imgPrompt);
  } catch (err) {
    console.error("Failed to fetch image prompt:", err);
    return NextResponse.json(
      {
        error: "Fetch failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// PATCH /api/stories/images/[promptId] — Update prompt text and/or character_block_override
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  try {
    const body = await request.json();
    const {
      prompt,
      character_block_override,
      secondary_character_block_override,
      suppress_character_block,
      clothing_override,
      sfw_constraint_override,
      visual_signature_override,
      final_prompt,
      pose_template_id,
      primary_ref_type,
      secondary_ref_type,
    } = body as {
      prompt?: string;
      character_block_override?: string | null;
      secondary_character_block_override?: string | null;
      suppress_character_block?: boolean | null;
      clothing_override?: string | null;
      sfw_constraint_override?: string | null;
      visual_signature_override?: string | null;
      final_prompt?: string | null;
      pose_template_id?: string | null;
      primary_ref_type?: "face" | "body";
      secondary_ref_type?: "face" | "body" | null;
    };

    const hasPromptUpdate = typeof prompt === "string" && prompt.length > 0;
    const hasOverrideUpdate = character_block_override !== undefined;
    const hasSecondaryOverrideUpdate = secondary_character_block_override !== undefined;
    const hasSuppressUpdate = suppress_character_block !== undefined;
    const hasClothingOverrideUpdate = clothing_override !== undefined;
    const hasSfwConstraintOverrideUpdate = sfw_constraint_override !== undefined;
    const hasVisualSignatureOverrideUpdate = visual_signature_override !== undefined;
    const hasFinalPromptUpdate = final_prompt !== undefined;
    const hasPoseTemplateUpdate = pose_template_id !== undefined;
    const hasPrimaryRefTypeUpdate = primary_ref_type !== undefined;
    const hasSecondaryRefTypeUpdate = secondary_ref_type !== undefined;

    if (hasPrimaryRefTypeUpdate && primary_ref_type !== "face" && primary_ref_type !== "body") {
      return NextResponse.json(
        { error: "primary_ref_type must be 'face' or 'body'" },
        { status: 400 }
      );
    }
    if (
      hasSecondaryRefTypeUpdate &&
      secondary_ref_type !== null &&
      secondary_ref_type !== "face" &&
      secondary_ref_type !== "body"
    ) {
      return NextResponse.json(
        { error: "secondary_ref_type must be 'face', 'body', or null" },
        { status: 400 }
      );
    }

    if (
      !hasPromptUpdate &&
      !hasOverrideUpdate &&
      !hasSecondaryOverrideUpdate &&
      !hasSuppressUpdate &&
      !hasClothingOverrideUpdate &&
      !hasSfwConstraintOverrideUpdate &&
      !hasVisualSignatureOverrideUpdate &&
      !hasFinalPromptUpdate &&
      !hasPoseTemplateUpdate &&
      !hasPrimaryRefTypeUpdate &&
      !hasSecondaryRefTypeUpdate
    ) {
      return NextResponse.json(
        { error: "At least one field to update is required" },
        { status: 400 }
      );
    }

    // Fetch current row to check existing status
    const { data: existing, error: fetchError } = await supabase
      .from("story_image_prompts")
      .select("id, status")
      .eq("id", promptId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Image prompt not found" },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (hasPromptUpdate) updates.prompt = prompt;
    if (hasOverrideUpdate) updates.character_block_override = character_block_override;
    if (hasSecondaryOverrideUpdate) updates.secondary_character_block_override = secondary_character_block_override;
    if (hasSuppressUpdate) updates.suppress_character_block = suppress_character_block;
    if (hasClothingOverrideUpdate) updates.clothing_override = clothing_override;
    if (hasSfwConstraintOverrideUpdate) updates.sfw_constraint_override = sfw_constraint_override;
    if (hasVisualSignatureOverrideUpdate) updates.visual_signature_override = visual_signature_override;
    if (hasFinalPromptUpdate) updates.final_prompt = final_prompt;
    if (hasPoseTemplateUpdate) updates.pose_template_id = pose_template_id;
    if (hasPrimaryRefTypeUpdate) updates.primary_ref_type = primary_ref_type;
    if (hasSecondaryRefTypeUpdate) updates.secondary_ref_type = secondary_ref_type;

    // Reset to pending on any content change EXCEPT a pure final_prompt edit
    // or pure ref-type edit — those don't invalidate an existing approved
    // image (the dropdowns track *next* generation's reference, not the
    // current one).
    const onlyFinalPromptChanged =
      hasFinalPromptUpdate &&
      !hasPromptUpdate &&
      !hasOverrideUpdate &&
      !hasSecondaryOverrideUpdate &&
      !hasSuppressUpdate &&
      !hasClothingOverrideUpdate &&
      !hasSfwConstraintOverrideUpdate &&
      !hasVisualSignatureOverrideUpdate &&
      !hasPrimaryRefTypeUpdate &&
      !hasSecondaryRefTypeUpdate;
    const onlyRefTypeChanged =
      (hasPrimaryRefTypeUpdate || hasSecondaryRefTypeUpdate) &&
      !hasPromptUpdate &&
      !hasOverrideUpdate &&
      !hasSecondaryOverrideUpdate &&
      !hasSuppressUpdate &&
      !hasClothingOverrideUpdate &&
      !hasSfwConstraintOverrideUpdate &&
      !hasVisualSignatureOverrideUpdate &&
      !hasFinalPromptUpdate;

    if (
      !onlyFinalPromptChanged &&
      !onlyRefTypeChanged &&
      (existing.status === "generated" || existing.status === "approved")
    ) {
      updates.status = "pending";
    }

    const { data: updated, error: updateError } = await supabase
      .from("story_image_prompts")
      .update(updates)
      .eq("id", promptId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ image_prompt: updated });
  } catch (err) {
    console.error("Failed to update image prompt:", err);
    return NextResponse.json(
      {
        error: "Update failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// DELETE /api/stories/images/[promptId] — Remove an image prompt from the story
export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ promptId: string }> }
) {
  const params = await props.params;
  const { promptId } = params;

  const { error } = await supabase
    .from("story_image_prompts")
    .delete()
    .eq("id", promptId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
