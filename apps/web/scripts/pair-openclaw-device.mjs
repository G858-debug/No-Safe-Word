#!/usr/bin/env node
/**
 * One-shot OpenClaw device pairing script.
 *
 * Pairs this backend as a named operator device against an OpenClaw gateway
 * and prints four credentials the caller should paste into Railway env:
 *
 *   OPENCLAW_DEVICE_ID
 *   OPENCLAW_DEVICE_PUBLIC_KEY
 *   OPENCLAW_DEVICE_PRIVATE_KEY
 *   OPENCLAW_DEVICE_TOKEN
 *
 * ---------------------------------------------------------------------------
 * How pairing approval works (verified against openclaw/openclaw source):
 *
 *   - A new operator device's connect request creates a pending pairing
 *     record on the gateway.
 *   - The gateway auto-approves ("silent local pairing") ONLY when locality
 *     is local (loopback/unix-socket-equivalent) and the connection has no
 *     proxy headers. Remote connections stay pending until approved by an
 *     already-approved operator via the Control UI or `openclaw devices
 *     approve <requestId>` CLI.
 *
 * Run from INSIDE the OpenClaw container against its loopback gateway to
 * skip the approval step:
 *
 *   railway ssh --project "NSW - OpenClaw" --service nsw-openclaw
 *   # in container:
 *   export OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
 *   export OPENCLAW_GATEWAY_TOKEN=<gateway token from env>
 *   node /path/to/this/script
 *
 * Or run remotely from a laptop and separately approve the pending request:
 *
 *   OPENCLAW_GATEWAY_URL=wss://nsw-openclaw-production.up.railway.app \
 *   OPENCLAW_GATEWAY_TOKEN=<token> \
 *     node apps/web/scripts/pair-openclaw-device.mjs
 * ---------------------------------------------------------------------------
 */

import crypto from "node:crypto";
import fs from "node:fs";
import WebSocket from "ws";

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

if (!gatewayUrl) die("OPENCLAW_GATEWAY_URL is required");
if (!gatewayToken) die("OPENCLAW_GATEWAY_TOKEN is required");

const wsUrl = gatewayUrl.replace(/^http(s?):\/\//, "ws$1://");

// ---------------------------------------------------------------------------
// Load or generate Ed25519 keypair. Persisted to a file so repeated runs
// reuse the same deviceId — otherwise each re-run creates a new pending
// pairing request and orphans any previously-approved device.
// ---------------------------------------------------------------------------
const IDENTITY_PATH =
  process.env.OPENCLAW_DEVICE_IDENTITY_PATH ||
  "/tmp/openclaw-device-identity.json";

let publicKey;
let privateKey;
let publicKeyPem;
let privateKeyPem;

if (fs.existsSync(IDENTITY_PATH)) {
  const stored = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  publicKeyPem = stored.publicKeyPem;
  privateKeyPem = stored.privateKeyPem;
  publicKey = crypto.createPublicKey(publicKeyPem);
  privateKey = crypto.createPrivateKey(privateKeyPem);
  console.log(`[pair] loaded existing identity from ${IDENTITY_PATH}`);
} else {
  const kp = crypto.generateKeyPairSync("ed25519");
  publicKey = kp.publicKey;
  privateKey = kp.privateKey;
  publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(
    IDENTITY_PATH,
    JSON.stringify({ publicKeyPem, privateKeyPem, createdAtMs: Date.now() }, null, 2),
    { mode: 0o600 },
  );
  console.log(`[pair] generated new identity, saved to ${IDENTITY_PATH}`);
}

// Raw public key bytes = SPKI minus the 12-byte Ed25519 OID prefix.
const spki = publicKey.export({ type: "spki", format: "der" });
const ED25519_SPKI_PREFIX_LEN = 12;
const rawPublicKey = spki.subarray(ED25519_SPKI_PREFIX_LEN);
const publicKeyBase64Url = base64UrlEncode(rawPublicKey);
// deviceId = SHA-256 hex of raw public key bytes.
const deviceId = crypto.createHash("sha256").update(rawPublicKey).digest("hex");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function signPayload(payload) {
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);
  return base64UrlEncode(sig);
}

function die(msg) {
  console.error(`[pair] FATAL: ${msg}`);
  process.exit(1);
}

function mask(s) {
  if (!s) return "(empty)";
  if (s.length <= 12) return "***";
  return `${s.slice(0, 6)}…${s.slice(-4)} (len=${s.length})`;
}

// ---------------------------------------------------------------------------
// Open WebSocket and drive the handshake.
// ---------------------------------------------------------------------------
console.log(`[pair] gateway: ${wsUrl}`);
console.log(`[pair] deviceId: ${deviceId}`);
console.log(`[pair] publicKey: ${mask(publicKeyBase64Url)}`);

const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
const pending = new Map();

ws.on("message", (data) => {
  let frame;
  try { frame = JSON.parse(data.toString()); } catch { return; }

  if (frame.type === "event" && frame.event === "connect.challenge") {
    handleChallenge(frame.payload);
    return;
  }
  if (frame.type === "event") {
    console.log(`[pair] event ${frame.event}`);
    return;
  }
  if (frame.type === "res" && typeof frame.id === "string") {
    const entry = pending.get(frame.id);
    if (!entry) return;
    pending.delete(frame.id);
    if (frame.ok) entry.resolve(frame);
    else entry.reject(new Error(JSON.stringify(frame.error)));
  }
});

ws.on("error", (err) => die(`ws error: ${err.message}`));
ws.on("close", (code, reason) => {
  const r = reason?.toString() || "n/a";
  console.log(`[pair] ws closed code=${code} reason=${r}`);
});

function send(frame) {
  ws.send(JSON.stringify(frame));
}

async function handleChallenge(payload) {
  const nonce = payload.nonce;
  const signedAtMs = Date.now();
  const clientId = "gateway-client";
  const clientMode = "backend";
  const role = "operator";
  const scopes = ["operator.write"];
  const platform = "linux";
  const deviceFamily = "";

  // v3 payload format per OpenClaw src/gateway/device-auth.ts
  const payloadV3 = [
    "v3",
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(","),
    String(signedAtMs),
    gatewayToken,
    nonce,
    platform,
    deviceFamily,
  ].join("|");
  const signature = signPayload(payloadV3);

  const id = crypto.randomUUID();
  const req = {
    type: "req",
    id,
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: "1.0.0",
        platform,
        mode: clientMode,
      },
      scopes,
      auth: { token: gatewayToken },
      device: {
        id: deviceId,
        publicKey: publicKeyBase64Url,
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    },
  };

  const p = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("connect response timeout after 30s"));
      }
    }, 30_000);
  });

  console.log(`[pair] >>> connect (deviceId=${deviceId.slice(0, 12)}…)`);
  send(req);

  try {
    const result = await p;
    onConnectOk(result);
  } catch (err) {
    onConnectFail(err);
  }
}

function onConnectOk(frame) {
  const payload = frame.payload ?? {};
  const auth = payload.auth ?? {};
  const deviceToken = auth.deviceToken;
  const grantedScopes = auth.scopes;
  const role = auth.role;

  console.log("");
  console.log("=".repeat(70));
  console.log("[pair] ✓ CONNECT ACCEPTED");
  console.log("=".repeat(70));
  console.log(`role:           ${role ?? "(none)"}`);
  console.log(`grantedScopes:  ${Array.isArray(grantedScopes) ? grantedScopes.join(", ") : "(none)"}`);
  console.log(`deviceToken:    ${deviceToken ? "present" : "absent"}`);
  console.log("");

  if (!deviceToken) {
    console.log("[pair] No deviceToken returned — pairing is likely pending approval.");
    console.log("[pair] Approve this device from inside the OpenClaw container:");
    console.log("");
    console.log(`  openclaw devices approve   # list and approve pending requests`);
    console.log("");
    console.log("Then re-run this script.");
    process.exit(2);
  }

  if (!Array.isArray(grantedScopes) || !grantedScopes.includes("operator.write")) {
    console.log("[pair] WARNING: operator.write scope not granted. The deviceToken will not be usable for send().");
    console.log("[pair] Scopes approved:", grantedScopes);
  }

  console.log("=".repeat(70));
  console.log("[pair] COPY THESE INTO RAILWAY ENV VARS on No-Safe-Word:");
  console.log("=".repeat(70));
  console.log("");
  console.log(`OPENCLAW_DEVICE_ID=${deviceId}`);
  console.log(`OPENCLAW_DEVICE_PUBLIC_KEY=${publicKeyBase64Url}`);
  // Private key is a multi-line PEM — base64-encode to make it a safe env var value.
  const privateKeyB64 = Buffer.from(privateKeyPem, "utf8").toString("base64");
  console.log(`OPENCLAW_DEVICE_PRIVATE_KEY_B64=${privateKeyB64}`);
  console.log(`OPENCLAW_DEVICE_TOKEN=${deviceToken}`);
  console.log("");
  console.log("=".repeat(70));
  console.log("[pair] Set them with:");
  console.log("=".repeat(70));
  console.log("");
  console.log(`railway link --project "No Safe Word" --service No-Safe-Word`);
  console.log(`railway variables \\`);
  console.log(`  --set OPENCLAW_DEVICE_ID=${deviceId} \\`);
  console.log(`  --set OPENCLAW_DEVICE_PUBLIC_KEY=${publicKeyBase64Url} \\`);
  console.log(`  --set OPENCLAW_DEVICE_PRIVATE_KEY_B64=${privateKeyB64} \\`);
  console.log(`  --set OPENCLAW_DEVICE_TOKEN=${deviceToken} \\`);
  console.log(`  --skip-deploys`);
  console.log("");

  ws.close();
  process.exit(0);
}

function onConnectFail(err) {
  console.error("");
  console.error("=".repeat(70));
  console.error("[pair] ✗ CONNECT REJECTED");
  console.error("=".repeat(70));
  console.error(err.message);
  console.error("");
  console.error("Likely causes:");
  console.error("  - Pairing is pending approval (remote connection, locality != local).");
  console.error("    → Run `openclaw devices approve <requestId>` in the OpenClaw container.");
  console.error("  - Gateway token mismatch (check OPENCLAW_GATEWAY_TOKEN).");
  console.error("  - Signature/payload mismatch (v3 format or Ed25519).");
  console.error(`  - deviceId we tried: ${deviceId}`);
  console.error("");
  ws.close();
  process.exit(3);
}
