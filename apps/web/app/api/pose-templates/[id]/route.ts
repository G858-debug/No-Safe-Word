import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * PATCH /api/pose-templates/[id]
 *
 * Update editable fields on a pose template. Currently:
 *   - send_image_to_model (boolean)
 *   - pose_description (string)
 *   - name (string)
 */
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  let body: {
    send_image_to_model?: boolean;
    pose_description?: string;
    name?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.send_image_to_model === "boolean") {
    updates.send_image_to_model = body.send_image_to_model;
  }
  if (typeof body.pose_description === "string" && body.pose_description.trim()) {
    updates.pose_description = body.pose_description.trim();
  }
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("pose_templates")
    .update(updates)
    .eq("id", id)
    .select("id, name, pose_description, image_id, send_image_to_model, created_at, updated_at")
    .single();

  if (error) {
    const status = /duplicate key|unique/i.test(error.message) ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ template: data });
}

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
