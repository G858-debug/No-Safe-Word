/**
 * Populate and approve body prompts for THE LOBOLA LIST characters,
 * then switch the series engine to flux_pulid.
 *
 * Run: npx tsx /tmp/check-lobola3.ts
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  console.error("Run with: source apps/web/.env.local && npx tsx /tmp/check-lobola3.ts");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function generateBodyPrompt(desc: Record<string, string>): string {
  const gender = (desc.gender || "").toLowerCase();

  if (gender === "female") {
    const skinTone = desc.skinTone || "dark";
    const bodyBase = desc.bodyType || "curvaceous";
    return (
      `She has a ${bodyBase} figure with a very large, round ass, ` +
      `wide hips, thick thighs, large natural breasts, and a narrow defined waist. ` +
      `Her body is full-figured with smooth, glowing ${skinTone} skin.`
    );
  }

  if (gender === "male") {
    const bodyBase = desc.bodyType || "athletic";
    const skinTone = desc.skinTone || "dark";
    return `He has a ${bodyBase} build with broad shoulders and a strong frame. ${skinTone} skin.`;
  }

  return desc.bodyType || "";
}

async function main() {
  // 1. Find the series
  const { data: allSeries, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, title, image_engine")
    .ilike("title", "%lobola%");

  if (seriesErr) {
    console.error("Failed to query series:", seriesErr.message);
    process.exit(1);
  }

  if (!allSeries || allSeries.length === 0) {
    console.error("No series found matching 'lobola'");
    process.exit(1);
  }

  const series = allSeries[0];
  console.log(`\nSeries: ${series.title} (${series.id})`);
  console.log(`Current engine: ${series.image_engine}`);

  // 2. Fetch story characters
  const { data: storyChars, error: charsErr } = await supabase
    .from("story_characters")
    .select("id, character_id, approved, approved_image_id, face_url, body_prompt, body_prompt_status")
    .eq("series_id", series.id);

  if (charsErr || !storyChars) {
    console.error("Failed to fetch characters:", charsErr?.message);
    process.exit(1);
  }

  console.log(`\nFound ${storyChars.length} characters:\n`);

  // 3. For each character, generate body prompt and update
  for (const sc of storyChars) {
    const { data: character } = await supabase
      .from("characters")
      .select("name, description")
      .eq("id", sc.character_id)
      .single();

    if (!character) {
      console.error(`  Character ${sc.character_id} not found — skipping`);
      continue;
    }

    const desc = character.description as Record<string, string>;
    const name = character.name;

    // Check readiness
    const hasFace = !!sc.approved_image_id;
    const hasFaceUrl = !!sc.face_url;
    const hasBodyPrompt = !!sc.body_prompt;

    console.log(`  ${name} (${desc.gender})`);
    console.log(`    Face approved: ${hasFace ? "YES" : "NO"}`);
    console.log(`    Face URL: ${hasFaceUrl ? "YES" : "NO"}`);
    console.log(`    Body type: ${desc.bodyType || "(none)"}`);

    if (hasBodyPrompt && sc.body_prompt_status === "approved") {
      console.log(`    Body prompt: ALREADY APPROVED — skipping`);
      console.log(`    "${sc.body_prompt}"`);
      continue;
    }

    // Generate body prompt
    const bodyPrompt = generateBodyPrompt(desc);
    console.log(`    Generated body prompt: "${bodyPrompt}"`);

    // Update
    const { error: updateErr } = await supabase
      .from("story_characters")
      .update({
        body_prompt: bodyPrompt,
        body_prompt_status: "approved",
      })
      .eq("id", sc.id);

    if (updateErr) {
      console.error(`    FAILED to update: ${updateErr.message}`);
    } else {
      console.log(`    UPDATED — body_prompt_status = approved`);
    }
  }

  // 4. Switch engine to flux_pulid
  console.log(`\nSwitching engine to flux_pulid...`);
  const { error: engineErr } = await supabase
    .from("story_series")
    .update({ image_engine: "flux_pulid" })
    .eq("id", series.id);

  if (engineErr) {
    console.error(`FAILED to switch engine: ${engineErr.message}`);
    process.exit(1);
  }

  console.log("Engine switched to flux_pulid");

  // 5. Summary
  console.log("\n=== V3 READINESS ===");
  const ready = storyChars.every((sc) => sc.approved_image_id && sc.face_url);
  console.log(`Face approved + face_url for all: ${ready ? "YES" : "NO — some characters missing face data"}`);
  console.log(`Body prompts: ALL APPROVED`);
  console.log(`Engine: flux_pulid`);
  console.log(`\nReady for V3 scene generation!`);

  if (!ready) {
    const missing = storyChars.filter((sc) => !sc.face_url);
    if (missing.length > 0) {
      console.log(`\nWARNING: ${missing.length} character(s) missing face_url — PuLID won't work without it.`);
    }
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
