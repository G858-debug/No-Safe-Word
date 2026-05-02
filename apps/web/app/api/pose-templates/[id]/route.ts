import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * DELETE /api/pose-templates/[id]
 *
 * Removes the pose template, its underlying images row, and the file in
 * storage. Any story_image_prompts that reference it have their
 * pose_template_id set to NULL by the FK ON DELETE SET NULL.
 */
export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;

  const { data: template, error: fetchErr } = await supabase
    .from("pose_templates")
    .select("id, image_id, images:image_id(stored_url, settings)")
    .eq("id", id)
    .single();

  if (fetchErr || !template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const linked = template.images as
    | { stored_url: string | null; settings: Record<string, unknown> | null }
    | { stored_url: string | null; settings: Record<string, unknown> | null }[]
    | null;
  const image = Array.isArray(linked) ? linked[0] : linked;
  const storagePath = (image?.settings as { storage_path?: string } | null)?.storage_path;

  // Drop the template first so the FK constraint on the image is removed.
  const { error: deleteErr } = await supabase
    .from("pose_templates")
    .delete()
    .eq("id", id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  if (template.image_id) {
    await supabase.from("images").delete().eq("id", template.image_id);
  }
  if (storagePath) {
    await supabase.storage.from("story-images").remove([storagePath]);
  }

  return NextResponse.json({ deleted: true });
}
