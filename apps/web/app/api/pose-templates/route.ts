import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

/**
 * GET /api/pose-templates
 *
 * List all pose templates with their reference image URLs. Used by the
 * image card dropdown and the management page.
 */
export async function GET() {
  const { data, error } = await supabase
    .from("pose_templates")
    .select("id, name, pose_description, image_id, send_image_to_model, created_at, updated_at, images:image_id(stored_url)")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    name: string;
    pose_description: string;
    image_id: string;
    send_image_to_model: boolean;
    created_at: string;
    updated_at: string;
    images: { stored_url: string | null } | { stored_url: string | null }[] | null;
  };

  const templates = ((data as Row[] | null) ?? []).map((row) => {
    const linked = row.images;
    const image = Array.isArray(linked) ? linked[0] : linked;
    return {
      id: row.id,
      name: row.name,
      pose_description: row.pose_description,
      image_id: row.image_id,
      send_image_to_model: row.send_image_to_model,
      reference_url: image?.stored_url ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  return NextResponse.json({ templates });
}

/**
 * POST /api/pose-templates
 *
 * Create a new pose template. Accepts multipart/form-data:
 *   - name: string (unique)
 *   - pose_description: string
 *   - image: File (the reference pose image)
 *
 * Uploads the image to the `story-images` bucket under
 * `pose-templates/<uuid>.<ext>`, creates an `images` row, and inserts
 * the template.
 */
export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Multipart form data required" }, { status: 400 });
  }

  const name = (formData.get("name") as string | null)?.trim();
  const poseDescription = (formData.get("pose_description") as string | null)?.trim();
  const imageFile = formData.get("image");

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!poseDescription) {
    return NextResponse.json({ error: "pose_description is required" }, { status: 400 });
  }
  if (!(imageFile instanceof File) || imageFile.size === 0) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }
  if (!imageFile.type.startsWith("image/")) {
    return NextResponse.json({ error: "image must be an image file" }, { status: 400 });
  }

  const ext = imageFile.type.includes("png")
    ? "png"
    : imageFile.type.includes("webp")
      ? "webp"
      : "jpeg";

  const buffer = Buffer.from(await imageFile.arrayBuffer());
  const storagePath = `pose-templates/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("story-images")
    .upload(storagePath, buffer, {
      contentType: imageFile.type,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { data: publicUrl } = supabase.storage
    .from("story-images")
    .getPublicUrl(storagePath);
  const storedUrl = publicUrl.publicUrl;

  const { data: imageRow, error: imageErr } = await supabase
    .from("images")
    .insert({
      prompt: `Pose template reference: ${name}`,
      stored_url: storedUrl,
      mode: "sfw",
      settings: { source: "pose_template_upload", storage_path: storagePath },
    })
    .select("id")
    .single();

  if (imageErr || !imageRow) {
    await supabase.storage.from("story-images").remove([storagePath]);
    return NextResponse.json(
      { error: `Failed to create images row: ${imageErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  const { data: template, error: insertErr } = await supabase
    .from("pose_templates")
    .insert({
      name,
      pose_description: poseDescription,
      image_id: imageRow.id,
    })
    .select("id, name, pose_description, image_id, created_at, updated_at")
    .single();

  if (insertErr || !template) {
    // Roll back the image + storage if the template insert fails
    await supabase.from("images").delete().eq("id", imageRow.id);
    await supabase.storage.from("story-images").remove([storagePath]);
    const message = insertErr?.message ?? "Failed to create pose template";
    const status = /duplicate key|unique/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    template: {
      ...template,
      reference_url: storedUrl,
    },
  });
}
