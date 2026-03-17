import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/** Resolve storyCharId → character_id → most recent LoRA id */
async function resolveLoraId(storyCharId: string): Promise<{ loraId: string } | { error: string; status: number }> {
  const { data: storyChar, error: scError } = await (supabase as any)
    .from("story_characters")
    .select("character_id, active_lora_id")
    .eq("id", storyCharId)
    .single();

  if (scError || !storyChar) {
    return { error: "Story character not found", status: 404 };
  }

  let loraQuery = supabase
    .from("character_loras")
    .select("id")
    .eq("character_id", storyChar.character_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (storyChar.active_lora_id) {
    loraQuery = supabase
      .from("character_loras")
      .select("id")
      .eq("id", storyChar.active_lora_id)
      .single();
  }

  const { data: lora, error: loraError } = await loraQuery;
  if (loraError || !lora) {
    return { error: "No LoRA found", status: 404 };
  }

  return { loraId: lora.id };
}

// PATCH /api/stories/characters/[storyCharId]/dataset-images/[imageId]
// Updates fields on a dataset image (caption, human_approved, eval_status).
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const params = await props.params;
  const { storyCharId, imageId } = params;

  try {
    const body = await request.json();

    const result = await resolveLoraId(storyCharId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Build update object from allowed fields
    const updates: Record<string, unknown> = {};
    if (typeof body.caption === "string") updates.caption = body.caption;
    if (typeof body.human_approved === "boolean") updates.human_approved = body.human_approved;
    if (typeof body.eval_status === "string") updates.eval_status = body.eval_status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("lora_dataset_images")
      .update(updates as any)
      .eq("id", imageId)
      .eq("lora_id", result.loraId);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update image: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Dataset Image PATCH] Failed:", err);
    return NextResponse.json({ error: "Failed to update image" }, { status: 500 });
  }
}

// DELETE /api/stories/characters/[storyCharId]/dataset-images/[imageId]
// Deletes a dataset image record and its file from storage.
export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string; imageId: string }> }
) {
  const params = await props.params;
  const { storyCharId, imageId } = params;

  try {
    const result = await resolveLoraId(storyCharId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Fetch the image to get storage_path before deleting
    const { data: image, error: fetchError } = await supabase
      .from("lora_dataset_images")
      .select("id, storage_path")
      .eq("id", imageId)
      .eq("lora_id", result.loraId)
      .single();

    if (fetchError || !image) {
      return NextResponse.json({ error: "Dataset image not found" }, { status: 404 });
    }

    // Delete from storage if path exists
    if (image.storage_path) {
      const { error: storageError } = await supabase.storage
        .from("story-images")
        .remove([image.storage_path]);

      if (storageError) {
        console.warn(`[Dataset Image DELETE] Storage deletion failed for ${image.storage_path}: ${storageError.message}`);
      }
    }

    // Delete the database record
    const { error: deleteError } = await supabase
      .from("lora_dataset_images")
      .delete()
      .eq("id", imageId)
      .eq("lora_id", result.loraId);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete image: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Dataset Image DELETE] Failed:", err);
    return NextResponse.json({ error: "Failed to delete image" }, { status: 500 });
  }
}
