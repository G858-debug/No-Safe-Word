#!/usr/bin/env npx tsx
/**
 * Phase B.8 smoke test.
 *
 * Read-only verification of the Buffer client + operator-email helper.
 * Never schedules a real Buffer post. Sends one transactional email to
 * the operator inbox to confirm the ops@nosafeword.co.za sender works
 * against the existing Resend domain.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/buffer-smoke-test.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local BEFORE importing buffer-client / operator-email so
// process.env.BUFFER_API_KEY etc. are populated when the modules read
// them. Reads BOTH the workspace-root and apps/web .env.local — the
// root file holds the more recent secrets (BUFFER_API_KEY etc.); the
// apps/web file holds older provider keys still referenced by Next.js.
const envPaths = [
  resolve(__dirname, "../../../.env.local"),
  resolve(__dirname, "../.env.local"),
];
for (const envPath of envPaths) {
  try {
    const envFile = readFileSync(envPath, "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Either file missing is non-fatal; the next one may have the key.
  }
}
if (!process.env.BUFFER_API_KEY) {
  console.error("BUFFER_API_KEY not found in any .env.local");
  process.exit(1);
}

async function main() {
  // Lazy-import after env is loaded.
  const { bufferClient } = await import("../lib/server/buffer-client");
  const { sendOperatorEmail, operatorEmailAddress } = await import(
    "../lib/server/operator-email"
  );

  console.log("=== bufferClient.listChannels() ===");
  const channels = await bufferClient.listChannels();
  for (const c of channels) {
    console.log(
      `  - ${c.displayName ?? c.name} | id=${c.id} | service=${c.service} | type=${c.type} | disconnected=${c.isDisconnected}`
    );
  }

  console.log("\n=== bufferClient.getFacebookPageChannelId() ===");
  const fbChannelId = await bufferClient.getFacebookPageChannelId();
  console.log(`  Facebook page channel id: ${fbChannelId ?? "<none>"}`);

  console.log("\n=== bufferClient.healthCheck() ===");
  const health = await bufferClient.healthCheck();
  console.log(`  result: ${JSON.stringify(health)}`);

  console.log("\n=== operatorEmailAddress() ===");
  const operatorTo = operatorEmailAddress();
  console.log(`  Resolved to: ${operatorTo}`);

  console.log(
    "\n=== sendOperatorEmail (test message to verify from-address) ==="
  );
  const result = await sendOperatorEmail({
    subject: "Buffer integration smoke test (Phase B.8)",
    body: [
      "This is a test email sent by the Phase B.8 verification harness.",
      "",
      "If you see this, the ops@nosafeword.co.za sender is correctly",
      "configured against the existing Resend domain verification.",
      "",
      `Buffer health: ${health.ok ? "ok" : `failed: ${health.error}`}`,
      `Buffer Facebook channel id: ${fbChannelId ?? "<none>"}`,
    ].join("\n"),
  });
  console.log(`  result: ${JSON.stringify(result)}`);
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
