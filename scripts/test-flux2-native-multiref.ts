/**
 * B3 native multi-ref sandbox test
 *
 * Provisions a sandbox RunPod endpoint (idempotent), generates one body
 * portrait for Irene via the new native multi-ref workflow, and outputs a
 * side-by-side HTML comparison with her approved face portrait.
 *
 * Usage:
 *   npx tsx scripts/test-flux2-native-multiref.ts
 *   npx tsx scripts/test-flux2-native-multiref.ts --endpoint-id=<existing-id>
 *   npx tsx scripts/test-flux2-native-multiref.ts --prompt-file=<path>
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@no-safe-word/shared";
import {
  generateFlux2Image,
  getRunPodJobStatus,
  imageUrlToBase64,
  base64ToBuffer,
} from "@no-safe-word/image-gen";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "../.env.local");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cliEndpointId = args.find((a) => a.startsWith("--endpoint-id="))?.split("=")[1];
const promptFile = args.find((a) => a.startsWith("--prompt-file="))?.split("=")[1];
const quickMode = args.includes("--quick");
const cliSteps = args.find((a) => a.startsWith("--steps="))?.split("=")[1];

// ── Config ────────────────────────────────────────────────────────────────────
// --quick: 512×768 @ 4 steps — verifies pipeline works without hitting executionTimeout
const FLUX_BODY_WIDTH  = quickMode ? 512  : 1664;
const FLUX_BODY_HEIGHT = quickMode ? 768  : 2496;
const FLUX_STEPS       = cliSteps ? parseInt(cliSteps, 10) : (quickMode ? 4 : undefined);
const POLL_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 15 * 60 * 1_000;

const RUNPOD_GQL = "https://api.runpod.io/graphql";
const SANDBOX_NAME = "nsw-image-gen-multiref-sandbox";
const SANDBOX_IMAGE = "ghcr.io/g858-debug/nsw-comfyui-worker:multiref-latest";

const FALLBACK_BODY_PROMPT =
  "Black South African woman in her late twenties, oval face with high cheekbones, " +
  "warm dark brown skin, long black box braids loose over her shoulders, full lips, " +
  "two small beauty marks on the right side of her face. Full body shot, voluptuous " +
  "figure with full hips and defined waist, average bust, standing in soft natural " +
  "light against a neutral cream wall, wearing a fitted burgundy wrap dress that " +
  "falls just below the knee, gold hoop earrings. Three-quarter angle, full body in " +
  "frame, 2:3 portrait. Cinematic shallow depth of field. Rich shadows with luminous " +
  "highlights. Soft skin glow. Editorial photography quality. Photorealistic.";

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── RunPod GraphQL helper ─────────────────────────────────────────────────────
async function runpodGql(query: string, variables?: Record<string, unknown>) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY not set");
  const res = await fetch(`${RUNPOD_GQL}?api_key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(`RunPod GQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ── Endpoint provisioning ─────────────────────────────────────────────────────
async function ensureSandboxEndpoint(): Promise<string> {
  if (cliEndpointId) {
    console.log(`[B3] Using CLI-specified endpoint: ${cliEndpointId}`);
    return cliEndpointId;
  }

  console.log("[B3] Querying RunPod for existing sandbox endpoint...");
  let data: any;
  try {
    data = await runpodGql(`query {
      myself {
        endpoints {
          id
          name
        }
      }
    }`);
  } catch (err) {
    console.error("[B3] Failed to query endpoints:", err);
    printManualFallback();
    process.exit(1);
  }

  const existing = data.myself.endpoints.find((e: any) => e.name === SANDBOX_NAME);
  if (existing) {
    console.log(`[B3] Reusing existing sandbox endpoint: ${existing.id}`);
    return existing.id as string;
  }

  console.log("[B3] Sandbox endpoint not found. Creating template + endpoint...");

  // Create template pointing at multiref-latest
  let templateData: any;
  try {
    templateData = await runpodGql(`
      mutation SaveTemplate($input: SaveTemplateInput!) {
        saveTemplate(input: $input) { id name imageName }
      }
    `, {
      input: {
        name: "nsw-multiref-sandbox-template",
        imageName: SANDBOX_IMAGE,
        containerDiskInGb: 50,
        volumeInGb: 0,
        dockerArgs: "",
        env: [
          { key: "REFRESH_WORKER", value: "true" },
          { key: "INSTALL_PREMIUM_MODELS", value: "true" },
        ],
      },
    });
  } catch (err) {
    console.error("[B3] saveTemplate failed:", err);
    printManualFallback();
    process.exit(1);
  }

  const templateId: string = templateData.saveTemplate.id;
  console.log(`[B3] Template created: ${templateId}`);

  // Create serverless endpoint
  const networkVolumeId = process.env.RUNPOD_NETWORK_VOLUME_ID;
  if (!networkVolumeId) {
    console.error("[B3] RUNPOD_NETWORK_VOLUME_ID not set in .env.local");
    process.exit(1);
  }

  let endpointData: any;
  try {
    endpointData = await runpodGql(`
      mutation SaveEndpoint($input: EndpointInput!) {
        saveEndpoint(input: $input) { id name }
      }
    `, {
      input: {
        name: SANDBOX_NAME,
        templateId,
        gpuIds: "AMPERE_48,ADA_24",
        locations: "EU-RO-1",
        networkVolumeId,
        workersMin: 0,
        workersMax: 1,
        idleTimeout: 120,
      },
    });
  } catch (err) {
    console.error("[B3] saveEndpoint failed:", err);
    printManualFallback(templateId);
    process.exit(1);
  }

  const endpointId: string = endpointData.saveEndpoint.id;
  console.log(`[B3] Sandbox endpoint created: ${endpointId}`);
  return endpointId;
}

function printManualFallback(existingTemplateId?: string) {
  console.log(`
[B3 endpoint provisioning failed — manual fallback needed]
Please create the sandbox endpoint in the RunPod console:
  Name:         ${SANDBOX_NAME}
  Image:        ${SANDBOX_IMAGE}
  Region:       EU-RO-1
  Network vol:  ${process.env.RUNPOD_NETWORK_VOLUME_ID ?? "0ibg3mpboj"}
  GPU:          AMPERE_48, ADA_24
  Workers max:  1 / min: 0
  Idle timeout: 120s
  Container disk: 50 GB
${existingTemplateId ? `  Template ID (already created): ${existingTemplateId}` : ""}

Then re-run:
  npx tsx scripts/test-flux2-native-multiref.ts --endpoint-id=<the-new-endpoint-id>
`);
}

// ── Fetch Irene's character data ──────────────────────────────────────────────
async function fetchCharacterData() {
  console.log("[B3] Fetching Irene from Supabase...");

  const { data: chars, error } = await supabase
    .from("characters")
    .select("id, name, approved_image_id, approved_fullbody_image_id, portrait_prompt_locked, description")
    .ilike("name", "%irene%")
    .limit(5);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  if (!chars?.length) throw new Error("No character matching 'irene' found in characters table");

  const char = chars[0];
  console.log(`[B3] Found character: "${char.name}" (id: ${char.id})`);

  if (!char.approved_image_id) {
    throw new Error(`Character "${char.name}" has no approved_image_id — face portrait not approved`);
  }

  // Resolve face image URL
  const { data: faceImg } = await supabase
    .from("images")
    .select("id, stored_url, sfw_url")
    .eq("id", char.approved_image_id)
    .single();

  const faceUrl = faceImg?.stored_url ?? faceImg?.sfw_url ?? null;
  if (!faceUrl) throw new Error(`Face image ${char.approved_image_id} has no stored_url`);
  console.log(`[B3] Face portrait URL: ${faceUrl.slice(0, 80)}...`);

  // Try to find the most recent broken body portrait
  let brokenBodyUrl: string | null = null;
  const { data: bodyImgs } = await supabase
    .from("images")
    .select("id, stored_url, sfw_url, settings, created_at")
    .eq("character_id", char.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const bodyImg = (bodyImgs ?? []).find(
    (img) => (img.settings as any)?.imageType === "body"
  );
  if (bodyImg) {
    brokenBodyUrl = bodyImg.stored_url ?? bodyImg.sfw_url ?? null;
    console.log(`[B3] Found previous body portrait (broken, PuLID): ${brokenBodyUrl?.slice(0, 80)}...`);
  } else {
    console.log("[B3] No previous body portrait found — compare page will show placeholder");
  }

  // Prompt: CLI file override > portrait_prompt_locked > hardcoded fallback
  let bodyPrompt = FALLBACK_BODY_PROMPT;
  if (promptFile) {
    bodyPrompt = fs.readFileSync(path.resolve(promptFile), "utf8").trim();
    console.log("[B3] Using prompt from --prompt-file");
  } else {
    console.log("[B3] Using hardcoded fallback body prompt");
  }

  return { char, faceUrl, brokenBodyUrl, bodyPrompt };
}

// ── Generate body portrait ────────────────────────────────────────────────────
async function runGeneration(endpointId: string, faceUrl: string, bodyPrompt: string) {
  console.log("[B3] Downloading face portrait for base64 encoding...");
  const faceBase64 = await imageUrlToBase64(faceUrl);
  console.log(`[B3] Face image: ${(faceBase64.length / 1024).toFixed(0)} KB base64`);

  // Set env flags so generateFlux2Image uses the native workflow + sandbox endpoint
  process.env.FLUX2_USE_NATIVE_MULTIREF = "true";
  process.env.RUNPOD_FLUX2_SANDBOX_ENDPOINT_ID = endpointId;

  console.log(`[B3] Submitting native multi-ref job to RunPod (${FLUX_BODY_WIDTH}×${FLUX_BODY_HEIGHT}${FLUX_STEPS ? `, ${FLUX_STEPS} steps` : ""})...`);
  const startMs = Date.now();
  const result = await generateFlux2Image({
    scenePrompt: bodyPrompt,
    references: [{ name: "ref_face.jpg", base64: faceBase64 }],
    width: FLUX_BODY_WIDTH,
    height: FLUX_BODY_HEIGHT,
    steps: FLUX_STEPS,
    filenamePrefix: "flux2_native_body",
  });

  const rawJobId = result.jobId.replace("runpod-", "");
  console.log(`[B3] Job submitted: ${result.jobId} (seed: ${result.seed})`);
  console.log(`[B3] Polling every ${POLL_INTERVAL_MS / 1000}s (timeout: ${TIMEOUT_MS / 60000} min)...`);

  // Poll with progress logging
  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const status = await getRunPodJobStatus(rawJobId, endpointId);

    if (status.status !== lastStatus) {
      lastStatus = status.status;
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
      console.log(`[B3] ${elapsed}s — status: ${status.status}${status.delayTime ? ` (queue delay: ${status.delayTime}ms)` : ""}`);
    }

    if (status.status === "COMPLETED") {
      const imageData = status.output?.images?.[0]?.data;
      if (!imageData) throw new Error("Job COMPLETED but output.images is empty");
      const durationMs = Date.now() - startMs;
      console.log(`[B3] Generation complete in ${(durationMs / 1000).toFixed(1)}s`);
      return { bodyBase64: imageData, workflow: result.workflow, prompt: result.prompt, seed: result.seed, durationMs };
    }

    if (status.status === "FAILED") {
      throw new Error(`RunPod job FAILED: ${status.error ?? "no error detail"}`);
    }
    if (status.status === "CANCELLED" || status.status === "TIMED_OUT") {
      throw new Error(`RunPod job ${status.status}`);
    }
  }

  throw new Error(`Timed out waiting for job ${result.jobId} after ${TIMEOUT_MS / 60000} minutes`);
}

// ── Build compare.html ────────────────────────────────────────────────────────
function buildCompareHtml(opts: {
  faceDataUri: string;
  brokenDataUri: string | null;
  newBodyDataUri: string;
  prompt: string;
  workflow: Record<string, unknown>;
  endpointId: string;
  seed: number;
  durationMs: number;
  timestamp: string;
}): string {
  const { faceDataUri, brokenDataUri, newBodyDataUri, prompt, workflow, endpointId, seed, durationMs, timestamp } = opts;

  const brokenCell = brokenDataUri
    ? `<img src="${brokenDataUri}" alt="Previous broken body (PuLID)" />`
    : `<div class="missing">Not found<br><span>Previous body portrait unavailable</span></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>B3 Native Multi-Ref Comparison</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #fff; color: #111; padding: 24px; }
  h1 { font-size: 1.1rem; font-weight: bold; margin-bottom: 6px; }
  .meta { font-size: 0.75rem; color: #555; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
  .col { display: flex; flex-direction: column; }
  .col h2 { font-size: 0.75rem; font-weight: bold; text-transform: uppercase;
             letter-spacing: 0.05em; margin-bottom: 8px; padding: 4px 8px;
             border-left: 3px solid #111; }
  .col h2.new { border-color: #2a7a2a; color: #2a7a2a; }
  .col h2.broken { border-color: #c00; color: #c00; }
  .col img { width: 100%; display: block; border: 1px solid #ddd; }
  .missing { width: 100%; aspect-ratio: 2/3; background: #f5f5f5; border: 1px dashed #bbb;
             display: flex; flex-direction: column; align-items: center;
             justify-content: center; font-size: 0.8rem; color: #999; text-align: center; padding: 12px; }
  .missing span { font-size: 0.7rem; margin-top: 4px; }
  details { margin-bottom: 12px; border: 1px solid #ddd; border-radius: 2px; }
  summary { padding: 6px 10px; cursor: pointer; font-size: 0.78rem;
            background: #f5f5f5; user-select: none; }
  pre { padding: 12px; font-size: 0.7rem; overflow-x: auto; white-space: pre-wrap;
        word-break: break-all; max-height: 300px; overflow-y: auto;
        background: #fafafa; border-top: 1px solid #ddd; }
  .verdicts { display: flex; gap: 12px; margin-top: 20px; }
  .verdict { flex: 1; padding: 14px; font-size: 0.9rem; font-weight: bold;
             border: 2px solid; border-radius: 2px; text-align: center;
             cursor: default; font-family: monospace; }
  .verdict.pass { border-color: #2a7a2a; color: #2a7a2a; background: #f0faf0; }
  .verdict.fail { border-color: #c00; color: #c00; background: #fff5f5; }
  .stats { font-size: 0.75rem; color: #555; margin-bottom: 16px; }
  .stats span { margin-right: 20px; }
</style>
</head>
<body>
<h1>B3 — Native Multi-Reference Flux 2 Dev Comparison</h1>
<div class="meta">Generated: ${timestamp}</div>

<div class="stats">
  <span>Endpoint: <strong>${endpointId}</strong></span>
  <span>Duration: <strong>${(durationMs / 1000).toFixed(1)}s</strong></span>
  <span>Seed: <strong>${seed}</strong></span>
  <span>Size: <strong>${FLUX_BODY_WIDTH}×${FLUX_BODY_HEIGHT}</strong></span>
</div>

<div class="grid">
  <div class="col">
    <h2>Approved face portrait</h2>
    <img src="${faceDataUri}" alt="Approved face portrait" />
  </div>
  <div class="col">
    <h2 class="broken">Previous body (broken — PuLID)</h2>
    ${brokenCell}
  </div>
  <div class="col">
    <h2 class="new">NEW body (native multi-ref)</h2>
    <img src="${newBodyDataUri}" alt="New body portrait — native multi-ref" />
  </div>
</div>

<details>
  <summary>Prompt used</summary>
  <pre>${prompt.replace(/</g, "&lt;")}</pre>
</details>

<details>
  <summary>ComfyUI workflow JSON (native multi-ref)</summary>
  <pre>${JSON.stringify(workflow, null, 2).replace(/</g, "&lt;")}</pre>
</details>

<div class="verdicts">
  <div class="verdict pass">✓ Face identity preserved — proceed to B4</div>
  <div class="verdict fail">✗ Identity wrong / weak — rollback and triage</div>
</div>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("  B3 — Flux 2 Native Multi-Reference Sandbox Test");
  console.log("=".repeat(60));

  const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "RUNPOD_API_KEY"];
  for (const k of requiredEnv) {
    if (!process.env[k]) {
      console.error(`Missing required env var: ${k}`);
      process.exit(1);
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    process.exit(1);
  }

  // 1. Provision / locate sandbox endpoint
  const endpointId = await ensureSandboxEndpoint();

  // 2. Fetch Irene's data
  const { char, faceUrl, brokenBodyUrl, bodyPrompt } = await fetchCharacterData();

  // 3. Generate new body portrait
  const { bodyBase64, workflow, prompt, seed, durationMs } = await runGeneration(endpointId, faceUrl, bodyPrompt);

  // 4. Save outputs
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const outputDir = path.resolve(__dirname, `output/flux2-native-test-${timestamp}`);
  fs.mkdirSync(outputDir, { recursive: true });

  // Save face image
  console.log("[B3] Downloading face image for local save...");
  const faceBase64 = await imageUrlToBase64(faceUrl);
  const faceImgName = "face-approved.jpg";
  fs.writeFileSync(path.join(outputDir, faceImgName), base64ToBuffer(faceBase64));

  // Save new body image
  const newBodyImgName = "body-native.jpg";
  fs.writeFileSync(path.join(outputDir, newBodyImgName), base64ToBuffer(bodyBase64));

  // Save broken body image if found
  let brokenImgName: string | null = null;
  if (brokenBodyUrl) {
    console.log("[B3] Downloading previous broken body portrait...");
    try {
      const brokenBase64 = await imageUrlToBase64(brokenBodyUrl);
      brokenImgName = "body-previous-broken.jpg";
      fs.writeFileSync(path.join(outputDir, brokenImgName), base64ToBuffer(brokenBase64));
    } catch (err) {
      console.warn("[B3] Could not download broken body portrait:", err);
    }
  }

  // Save metadata.json
  const metadata = {
    timestamp,
    character: { id: char.id, name: char.name },
    endpointId,
    seed,
    durationMs,
    durationS: parseFloat((durationMs / 1000).toFixed(1)),
    promptUsed: prompt,
    rawBodyPrompt: bodyPrompt,
    workflow,
  };
  fs.writeFileSync(path.join(outputDir, "metadata.json"), JSON.stringify(metadata, null, 2));

  // Build + save compare.html (images embedded as base64 data URIs)
  const toDataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;
  let brokenDataUri: string | null = null;
  if (brokenImgName) {
    brokenDataUri = toDataUri(
      fs.readFileSync(path.join(outputDir, brokenImgName)).toString("base64")
    );
  }

  const html = buildCompareHtml({
    faceDataUri: toDataUri(faceBase64),
    brokenDataUri,
    newBodyDataUri: toDataUri(bodyBase64),
    prompt,
    workflow,
    endpointId,
    seed,
    durationMs,
    timestamp,
  });
  const htmlPath = path.join(outputDir, "compare.html");
  fs.writeFileSync(htmlPath, html);

  // 5. Summary
  console.log("\n" + "=".repeat(60));
  console.log("  [B3 native multi-ref test complete]");
  console.log("=".repeat(60));
  console.log(`  Sandbox endpoint:  ${endpointId}`);
  console.log(`  Character:         ${char.name} (${char.id})`);
  console.log(`  Generation time:   ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Seed:              ${seed}`);
  console.log(`  Output directory:  ${outputDir}`);
  console.log(`  Compare page:      file://${htmlPath}`);
  console.log(`  Open with:         open "${htmlPath}"`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n[B3 FAILED]", err instanceof Error ? err.message : err);
  process.exit(1);
});
