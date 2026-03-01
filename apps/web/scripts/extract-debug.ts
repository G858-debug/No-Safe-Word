#!/usr/bin/env npx tsx
/**
 * Extract Debug Data for a Story Image Prompt
 *
 * Usage: npx tsx apps/web/scripts/extract-debug.ts <promptId>
 *
 * Fetches the debug_data JSONB and prompt record from Supabase,
 * then prints a comprehensive diagnostic report to stdout.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ──────────────────────────────────────────────
const envPath = resolve(__dirname, "../.env.local");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
} catch {
  console.error(`Could not read ${envPath}`);
  process.exit(1);
}

// ── Supabase client ──────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

// ── Helpers ──────────────────────────────────────────────────────
function section(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

function field(label: string, value: unknown) {
  if (value === null || value === undefined) {
    console.log(`  ${label}: (none)`);
  } else if (typeof value === "object") {
    console.log(`  ${label}:`);
    const lines = JSON.stringify(value, null, 2).split("\n");
    for (const line of lines) {
      console.log(`    ${line}`);
    }
  } else {
    console.log(`  ${label}: ${value}`);
  }
}

function promptBlock(label: string, text: string | null | undefined) {
  if (!text) {
    console.log(`  ${label}: (none)`);
    return;
  }
  console.log(`  ${label}:`);
  console.log(`    ┌${"─".repeat(70)}`);
  for (const line of text.split("\n")) {
    console.log(`    │ ${line}`);
  }
  console.log(`    └${"─".repeat(70)}`);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const promptId = process.argv[2];
  if (!promptId) {
    console.error("Usage: npx tsx apps/web/scripts/extract-debug.ts <promptId>");
    process.exit(1);
  }

  // Fetch the prompt record
  const { data: row, error } = await supabase
    .from("story_image_prompts")
    .select("*")
    .eq("id", promptId)
    .single();

  if (error || !row) {
    console.error(`Failed to fetch prompt ${promptId}:`, error?.message || "not found");
    process.exit(1);
  }

  const debug = (row as any).debug_data as Record<string, any> | null;

  // ── PROMPT RECORD ──
  section("PROMPT RECORD");
  field("Prompt ID", row.id);
  field("Image Type", row.image_type);
  field("Status", row.status);
  field("Character", row.character_name);
  field("Secondary Character", row.secondary_character_name);
  field("Character ID", row.character_id);
  field("Secondary Character ID", row.secondary_character_id);
  field("Created", row.created_at);
  field("Updated", row.updated_at);
  promptBlock("Raw Prompt (from story JSON)", row.prompt);

  if (!debug) {
    console.log("\n  ⚠ No debug_data found. Run a debug generation first.");
    console.log("    POST /api/stories/images/<promptId>/debug-generate");
    process.exit(0);
  }

  // ── AI OPTIMIZER OUTPUT ──
  section("AI OPTIMIZER OUTPUT");
  field("Optimization Applied", debug.optimization?.wasOptimized);
  field("Duration (ms)", debug.optimization?.durationMs);
  if (debug.optimization?.notes?.length) {
    console.log("  Notes:");
    for (const note of debug.optimization.notes) {
      console.log(`    - ${note}`);
    }
  }
  console.log("");
  promptBlock("Assembled Prompt (pre-optimization)", debug.prompts?.assembled);
  promptBlock("Optimized Full Prompt (Phase 1)", debug.prompts?.optimizedFull);
  console.log("");
  console.log("  --- Decomposed (Original) ---");
  promptBlock("Scene Prompt", debug.prompts?.decomposed?.original?.scenePrompt);
  promptBlock("Primary Identity", debug.prompts?.decomposed?.original?.primaryIdentityPrompt);
  promptBlock("Secondary Identity", debug.prompts?.decomposed?.original?.secondaryIdentityPrompt);
  console.log("");
  console.log("  --- Decomposed (Optimized / Phase 2) ---");
  promptBlock("Scene Prompt", debug.prompts?.decomposed?.optimized?.scenePrompt);
  promptBlock("Primary Identity", debug.prompts?.decomposed?.optimized?.primaryIdentityPrompt);
  promptBlock("Secondary Identity", debug.prompts?.decomposed?.optimized?.secondaryIdentityPrompt);
  console.log("");
  console.log("  --- Regional Prompts (Attention Couple) ---");
  promptBlock("Shared Scene (base_cond)", debug.prompts?.regional?.shared);
  promptBlock("Primary Region (left)", debug.prompts?.regional?.primaryRegion);
  promptBlock("Secondary Region (right)", debug.prompts?.regional?.secondaryRegion);
  console.log("");
  console.log("  --- Face Prompts (FaceDetailer) ---");
  promptBlock("Primary Face", debug.prompts?.facePrompts?.primary);
  promptBlock("Secondary Face", debug.prompts?.facePrompts?.secondary);
  console.log("");
  console.log("  --- Negative Prompt ---");
  promptBlock("Original Additions", debug.negativePrompt?.originalAdditions);
  promptBlock("Optimized Additions", debug.negativePrompt?.optimizedAdditions);

  // ── SCENE CLASSIFICATION ──
  section("SCENE CLASSIFICATION");
  field("Full Classification", debug.classification);

  // ── LORA SELECTION ──
  section("LORA SELECTION");
  if (debug.resources?.characterLoras?.length) {
    console.log("  Character LoRAs:");
    for (const l of debug.resources.characterLoras) {
      console.log(`    - ${l}`);
    }
  } else {
    console.log("  Character LoRAs: (none)");
  }
  if (debug.resources?.loras?.length) {
    console.log("  Neutral LoRAs:");
    for (const l of debug.resources.loras) {
      console.log(`    - ${l}`);
    }
  }
  field("Negative Additions", debug.resources?.negativeAdditions);

  // ── WORKFLOW CONFIG ──
  section("WORKFLOW CONFIG");
  field("Job ID", debug.jobId);
  field("Seed", debug.seed);
  field("Mode", debug.mode);
  field("Image Type", debug.imageType);
  field("Dimensions", debug.dimensions ? `${debug.dimensions.width}x${debug.dimensions.height} (${debug.dimensions.name})` : null);
  if (debug.characters?.length) {
    console.log("  Characters:");
    for (const c of debug.characters) {
      console.log(`    - ${c.name} (${c.role}, ${c.gender})`);
    }
  }

  // ── PASS PROMPTS ──
  section("PASS PROMPTS (what each pass received)");
  if (debug.passes?.length) {
    for (const pass of debug.passes) {
      console.log(`  ── Pass ${pass.pass}: ${pass.name} ──`);
      console.log(`  ${pass.description}`);
      promptBlock("Prompt", pass.prompt);
      if (pass.loras?.length) {
        console.log(`  LoRAs: ${pass.loras.join(", ")}`);
      }
      const p = pass.params || {};
      const dims = p.width && p.height ? `, ${p.width}x${p.height}` : "";
      console.log(`  KSampler: seed=${p.seed}, cfg=${p.cfg}, steps=${p.steps}, denoise=${p.denoise}${dims}`);
      console.log(`  Filename Prefix: ${pass.filenamePrefix || "(none)"}`);
      console.log("");
    }
  } else {
    console.log("  (no pass data available)");
  }

  // ── INTERMEDIATE IMAGES ──
  if (debug.intermediateImages && Object.keys(debug.intermediateImages).length) {
    section("INTERMEDIATE IMAGES");
    for (const [key, url] of Object.entries(debug.intermediateImages)) {
      console.log(`  ${key}: ${url}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
