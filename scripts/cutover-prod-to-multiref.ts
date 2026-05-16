/**
 * B3 prod cutover: flip RunPod prod endpoint to :multiref-latest image.
 *
 * Railway flag (FLUX2_USE_NATIVE_MULTIREF=true) is ALREADY SET — no Railway
 * change needed. The only mutation here is updating RunPod template b31bthjn1k
 * to point at ghcr.io/g858-debug/nsw-comfyui-worker:multiref-latest.
 *
 * Usage:
 *   npx tsx scripts/cutover-prod-to-multiref.ts
 *   npx tsx scripts/cutover-prod-to-multiref.ts --skip-endpoint  (if already done)
 */

import * as fs from "fs";
import * as path from "path";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "../.env.local");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipEndpoint = args.includes("--skip-endpoint");

// ── Constants ─────────────────────────────────────────────────────────────────
const PROD_ENDPOINT_ID   = "vj6jc0gd61l9ov";
const PROD_TEMPLATE_ID   = "b31bthjn1k";
const PROD_TEMPLATE_NAME = "nsw-image-gen__template__0mllfo";
const NEW_IMAGE          = "ghcr.io/g858-debug/nsw-comfyui-worker:multiref-latest";
const OLD_IMAGE          = "ghcr.io/g858-debug/nsw-comfyui-worker:latest";
const APP_URL            = "https://nosafeword.co.za";
const RUNPOD_GQL         = "https://api.runpod.io/graphql";

// ── Helpers ───────────────────────────────────────────────────────────────────
function printRollback(label: string) {
  const civitaiKey = process.env.CIVITAI_API_KEY ?? "<your-civitai-api-key>";
  console.log(`
================================================================
ROLLBACK COMMANDS [${label}]
================================================================
If the test fails or produces wrong output, restore prod with:

  1. Revert RunPod endpoint to PuLID image:

     DOCKER_IMAGE=${OLD_IMAGE} \\
     RUNPOD_API_KEY=$RUNPOD_API_KEY \\
     RUNPOD_ENDPOINT_ID=${PROD_ENDPOINT_ID} \\
     RUNPOD_TEMPLATE_ID=${PROD_TEMPLATE_ID} \\
     bash infra/runpod/update-endpoint.sh

  2. FLUX2_USE_NATIVE_MULTIREF was already true before this cutover
     (set by you manually). If you want to remove it:
     Railway dashboard → No-Safe-Word → Variables →
     delete FLUX2_USE_NATIVE_MULTIREF → Save → wait ~90s redeploy.
     Or: railway variables --service No-Safe-Word unset FLUX2_USE_NATIVE_MULTIREF

Snapshot: scripts/output/cutover-snapshot-<timestamp>.json
================================================================`);
}

async function runpodGql(query: string, variables?: Record<string, unknown>) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY not set");
  const res = await fetch(`${RUNPOD_GQL}?api_key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(`RunPod GQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ── 1. Snapshot current state ─────────────────────────────────────────────────
async function snapshotCurrentState(): Promise<{ snapshotPath: string; currentImage: string }> {
  console.log("[cutover] Snapshotting current RunPod state...");

  const data = await runpodGql(`{
    myself {
      endpoints {
        id name gpuIds locations workersMin workersMax idleTimeout networkVolumeId
        template { id name imageName containerDiskInGb }
      }
    }
  }`);

  const endpoint = data.myself.endpoints.find((e: any) => e.id === PROD_ENDPOINT_ID);
  if (!endpoint) throw new Error(`Endpoint ${PROD_ENDPOINT_ID} not found in account`);

  const currentImage: string = endpoint.template?.imageName ?? "unknown";
  console.log(`[cutover] Current prod image: ${currentImage}`);

  const snapshot = {
    timestamp: new Date().toISOString(),
    endpoint,
    railway: {
      note: "FLUX2_USE_NATIVE_MULTIREF=true was already set before this cutover — no Railway change made here",
      flux2UseNativeMultiref: "true (pre-existing)",
    },
    cutover: {
      from: currentImage,
      to: NEW_IMAGE,
    },
  };

  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const outputDir = path.resolve(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const snapshotPath = path.join(outputDir, `cutover-snapshot-${ts}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`[cutover] Snapshot saved: ${snapshotPath}`);

  return { snapshotPath, currentImage };
}

// ── 2. Update RunPod template ─────────────────────────────────────────────────
async function updateProdEndpoint() {
  console.log(`[cutover] Updating template ${PROD_TEMPLATE_ID} → ${NEW_IMAGE} ...`);

  const civitaiKey = process.env.CIVITAI_API_KEY ?? "";
  const data = await runpodGql(`
    mutation {
      saveTemplate(input: {
        id: "${PROD_TEMPLATE_ID}",
        name: "${PROD_TEMPLATE_NAME}",
        imageName: "${NEW_IMAGE}",
        containerDiskInGb: 48,
        volumeInGb: 0,
        dockerArgs: "",
        env: [
          { key: "REFRESH_WORKER", value: "true" },
          { key: "INSTALL_PREMIUM_MODELS", value: "true" },
          { key: "CIVITAI_API_KEY", value: "${civitaiKey}" }
        ]
      }) { id imageName }
    }
  `);

  const updated = data.saveTemplate;
  if (updated.imageName !== NEW_IMAGE) {
    throw new Error(`Template update returned unexpected imageName: ${updated.imageName}`);
  }
  console.log(`[cutover] ✓ Template ${updated.id} now points at: ${updated.imageName}`);

  // Verify via endpoint query
  const verify = await runpodGql(`{
    myself {
      endpoints { id name template { id imageName } }
    }
  }`);
  const ep = verify.myself.endpoints.find((e: any) => e.id === PROD_ENDPOINT_ID);
  const confirmedImage = ep?.template?.imageName;
  if (confirmedImage !== NEW_IMAGE) {
    throw new Error(`Verification mismatch: endpoint shows ${confirmedImage}, expected ${NEW_IMAGE}`);
  }
  console.log(`[cutover] ✓ Verified: endpoint ${PROD_ENDPOINT_ID} confirmed → ${confirmedImage}`);
}

// ── 3. Health check ───────────────────────────────────────────────────────────
async function verifyHealth() {
  console.log(`[cutover] Health check: ${APP_URL} ...`);
  try {
    const res = await fetch(APP_URL, { method: "GET", signal: AbortSignal.timeout(10_000) });
    if (res.ok || res.status === 302 || res.status === 200) {
      console.log(`[cutover] ✓ App responding: HTTP ${res.status}`);
    } else {
      console.warn(`[cutover] App returned HTTP ${res.status} — may be fine, continuing`);
    }
  } catch (err) {
    console.warn(`[cutover] Health check failed (non-blocking): ${err}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("  B3 Prod Cutover — RunPod :latest → :multiref-latest");
  console.log("=".repeat(60));

  if (!process.env.RUNPOD_API_KEY) {
    console.error("RUNPOD_API_KEY not set in .env.local");
    process.exit(1);
  }

  // Always print rollback commands first
  printRollback("BEFORE CUTOVER");

  let snapshotPath = "not yet written";
  try {
    const { snapshotPath: sp, currentImage } = await snapshotCurrentState();
    snapshotPath = sp;

    if (currentImage === NEW_IMAGE) {
      console.log(`[cutover] Template already points at ${NEW_IMAGE} — nothing to do.`);
      console.log(`[cutover] Run the test directly:\n  npx tsx scripts/test-flux2-native-multiref.ts --endpoint-id=${PROD_ENDPOINT_ID}`);
      return;
    }

    if (skipEndpoint) {
      console.log("[cutover] --skip-endpoint passed — skipping RunPod template update.");
    } else {
      printRollback("IMMEDIATELY BEFORE MUTATION");
      await updateProdEndpoint();
    }

    await verifyHealth();

    console.log(`
================================================================
CUTOVER COMPLETE
================================================================
RunPod endpoint: ${PROD_ENDPOINT_ID}
Template image:  ${NEW_IMAGE}
Railway flag:    FLUX2_USE_NATIVE_MULTIREF=true (was already set)
Snapshot:        ${snapshotPath}

New workers will use :multiref-latest on next cold start.
Run the test now:

  npx tsx scripts/test-flux2-native-multiref.ts --endpoint-id=${PROD_ENDPOINT_ID}

================================================================`);

    printRollback("AFTER CUTOVER — save these if test fails");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[cutover FAILED] ${msg}`);
    printRollback("FAILURE — run these to restore");
    console.log(`Snapshot (if written): ${snapshotPath}`);
    process.exit(1);
  }
}

main();
