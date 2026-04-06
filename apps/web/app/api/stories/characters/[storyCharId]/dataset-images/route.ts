import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
const MIN_PASSED_IMAGES = 20;

// GET /api/stories/characters/[storyCharId]/dataset-images
// Returns all dataset images for the character's active LoRA with eval scores and approval status.
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Get story character → character_id → active LoRA + character description for prompt resolution
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select(`
        character_id, active_lora_id
      `)
      .eq("id", storyCharId)
      .single() as { data: any; error: any };

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // Find the most recent LoRA for this character (active or most recent by date)
    const loraId = storyChar.active_lora_id;
    let loraQuery = supabase
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraId) {
      loraQuery = supabase
        .from("character_loras")
        .select("id, status")
        .eq("id", loraId)
        .single();
    }

    const { data: lora, error: loraError } = await loraQuery;

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "No LoRA found for this character" },
        { status: 404 }
      );
    }

    // Fetch all dataset images (passed, failed, replaced — not pending)
    const { data: images, error: imgError } = await supabase
      .from("lora_dataset_images")
      .select(
        "id, image_url, category, variation_type, eval_status, eval_score, eval_details, human_approved, caption, prompt_template, source"
      )
      .eq("lora_id", lora.id)
      .in("eval_status", ["passed", "failed", "replaced"])
      .order("category", { ascending: true });

    if (imgError) {
      return NextResponse.json(
        { error: `Failed to fetch images: ${imgError.message}` },
        { status: 500 }
      );
    }

    const allImages = images || [];

    const stats = {
      total: allImages.length,
      passed: allImages.filter((i: any) => i.eval_status === "passed" || i.eval_status === "replaced").length,
      humanApproved: allImages.filter((i: any) => i.human_approved === true).length,
      humanRejected: allImages.filter((i: any) => i.human_approved === false).length,
      humanPending: allImages.filter((i: any) => i.human_approved === null).length,
      minRequired: MIN_PASSED_IMAGES,
    };

    return NextResponse.json({
      loraId: lora.id,
      loraStatus: lora.status,
      images: allImages,
      stats,
    });
  } catch (err) {
    console.error("[Dataset Images API] Failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch dataset images" },
      { status: 500 }
    );
  }
}

// DELETE /api/stories/characters/[storyCharId]/dataset-images
// Bulk-deletes dataset images by ID. Body: { imageIds: string[] }
export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    const body = await request.json();
    const { imageIds } = body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return NextResponse.json(
        { error: "imageIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // Resolve story character → LoRA
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select("character_id, active_lora_id")
      .eq("id", storyCharId)
      .single();

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
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
      return NextResponse.json(
        { error: "No LoRA found" },
        { status: 404 }
      );
    }

    // Fetch storage paths for the images to delete
    const { data: imagesToDelete, error: fetchError } = await supabase
      .from("lora_dataset_images")
      .select("id, storage_path")
      .eq("lora_id", lora.id)
      .in("id", imageIds);

    if (fetchError) {
      return NextResponse.json(
        { error: `Failed to fetch images: ${fetchError.message}` },
        { status: 500 }
      );
    }

    if (!imagesToDelete || imagesToDelete.length === 0) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    // Delete from storage
    const storagePaths = imagesToDelete
      .map((img: any) => img.storage_path)
      .filter(Boolean);

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("story-images")
        .remove(storagePaths);

      if (storageError) {
        console.warn(
          `[Dataset Images DELETE] Storage deletion partially failed: ${storageError.message}`
        );
      }
    }

    // Delete database records
    const idsToDelete = imagesToDelete.map((img: any) => img.id);
    const { error: deleteError } = await supabase
      .from("lora_dataset_images")
      .delete()
      .eq("lora_id", lora.id)
      .in("id", idsToDelete);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete images: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, deleted: idsToDelete.length });
  } catch (err) {
    console.error("[Dataset Images DELETE] Failed:", err);
    return NextResponse.json(
      { error: "Failed to delete images" },
      { status: 500 }
    );
  }
}
