/**
 * Integration test for cleanupOrphanedImage. Creates a temporary image
 * row + Storage file + generation_jobs row in the LIVE Supabase project,
 * runs the cleanup, then asserts all three are gone.
 *
 * IMPORTANT: this runs against the production Supabase project. There is
 * no local instance configured for this repo. The test image row is
 * tagged with the prompt
 *   "TEST cleanupOrphanedImage — safe to delete"
 * so anything left behind on a partial failure is identifiable for manual
 * cleanup. The helper itself is the system under test, so we need real
 * Storage + real DB to exercise it.
 *
 * Usage:
 *   npx tsx apps/web/scripts/test-cleanup-orphaned-image.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
 * .env.local at the repo root.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { cleanupOrphanedImage } from "../lib/server/cleanup-orphaned-image";

// Load env from .env.local at the repo root.
const envPath = path.resolve(__dirname, "../../../.env.local");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "story-images";
const TEST_PROMPT_MARKER = "TEST cleanupOrphanedImage — safe to delete";

// Minimal valid JPEG (SOI + APP0 + EOI). Just enough for Storage to accept
// the upload with content-type image/jpeg.
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

async function main() {
  // 1. Create test images row.
  const { data: image, error: insertErr } = await supabase
    .from("images")
    .insert({
      prompt: TEST_PROMPT_MARKER,
      mode: "sfw",
      settings: { test: true },
    })
    .select("id")
    .single();
  if (insertErr || !image) {
    console.error("Failed to create test image row:", insertErr?.message);
    process.exit(1);
  }
  const imageId = image.id as string;
  console.log(`Created test image row: ${imageId}`);

  // 2. Upload a tiny test file to Storage.
  const storagePath = `characters/${imageId}.jpeg`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, TINY_JPEG, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) {
    console.error("Failed to upload test file:", uploadErr.message);
    await supabase.from("images").delete().eq("id", imageId);
    process.exit(1);
  }
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const storedUrl = urlData.publicUrl;
  console.log(`Uploaded test file: ${storedUrl}`);

  // 3. Update images row with stored_url so the cleanup helper can derive
  //    the storage path.
  await supabase.from("images").update({ stored_url: storedUrl }).eq("id", imageId);

  // 4. Create a test generation_jobs row.
  const testJobId = `test-cleanup-${imageId}`;
  // job_type is a CHECK-constrained enum; use a value the live schema
  // accepts. character_portrait matches the rollback path's real intent —
  // the helper is being introduced to clean up failed character-portrait
  // generations under PR-3b's strict mode.
  const { error: jobErr } = await supabase.from("generation_jobs").insert({
    job_id: testJobId,
    image_id: imageId,
    status: "pending",
    cost: 0,
    job_type: "character_portrait",
  });
  if (jobErr) {
    console.error("Failed to create test job row:", jobErr.message);
    await supabase.storage.from(BUCKET).remove([storagePath]);
    await supabase.from("images").delete().eq("id", imageId);
    process.exit(1);
  }
  console.log(`Created test job row: ${testJobId}`);

  // 5. Run cleanup.
  console.log("\nCalling cleanupOrphanedImage…");
  const result = await cleanupOrphanedImage(supabase, imageId);
  console.log(`Result: ok=${result.ok}, errors=${JSON.stringify(result.errors)}`);

  // 6. Verify all three are gone.
  const { data: afterImage } = await supabase
    .from("images")
    .select("id")
    .eq("id", imageId)
    .maybeSingle();
  const { data: afterJob } = await supabase
    .from("generation_jobs")
    .select("job_id")
    .eq("image_id", imageId)
    .maybeSingle();
  const { data: storageList } = await supabase.storage
    .from(BUCKET)
    .list("characters", { search: `${imageId}.jpeg` });
  const storageGone = !storageList || storageList.length === 0;

  const checks: Array<[string, boolean]> = [
    ["images row deleted", !afterImage],
    ["generation_jobs row deleted", !afterJob],
    ["storage file deleted", storageGone],
  ];

  console.log("\nVerification:");
  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "✓" : "✗"} ${label}`);
    if (!passed) allPassed = false;
  }

  if (!allPassed || !result.ok) {
    console.error("\nFAILED");
    process.exit(1);
  }
  console.log("\nPASSED");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
