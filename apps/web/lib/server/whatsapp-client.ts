/**
 * WhatsApp client — sends literal outbound messages via OpenClaw's gateway
 * `send` JSON-RPC method over WebSocket. Bypasses the agent/LLM entirely so
 * PIN text is delivered verbatim.
 *
 * Authenticates as a paired operator device. OpenClaw's gateway requires
 * an Ed25519 device signature over the per-connect challenge nonce — the
 * deviceToken alone is not sufficient. Pairing is done once via
 * scripts/pair-openclaw-device.mjs; the identity credentials are stored
 * in env and presented (signed) on every connect.
 *
 * Environment variables (set in Railway dashboard):
 *   OPENCLAW_GATEWAY_URL           — e.g. https://nsw-openclaw-production.up.railway.app
 *   OPENCLAW_DEVICE_ID             — SHA-256(publicKeyRaw) hex, from pairing
 *   OPENCLAW_DEVICE_PUBLIC_KEY     — base64url of raw Ed25519 public key bytes
 *   OPENCLAW_DEVICE_PRIVATE_KEY_B64 — base64 of the PKCS8 PEM private key
 *   OPENCLAW_DEVICE_TOKEN          — persistent device token returned by pairing
 */

import WebSocket from "ws";
import crypto, { randomUUID, type KeyObject } from "crypto";

const PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface WhatsAppMessage {
  /** Phone number in international format, e.g. "+27821234567". */
  to: string;
  /** Literal text to send. Delivered verbatim — no agent/LLM pass. */
  message: string;
}

export interface SendResult {
  runId?: string;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

interface GatewayFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
  event?: string;
  payload?: unknown;
}

interface ChallengePayload {
  nonce: string;
  ts: number;
}

interface DeviceIdentity {
  id: string;
  publicKeyBase64Url: string;
  privateKey: KeyObject;
}

let cachedIdentity: DeviceIdentity | null = null;

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function loadDeviceIdentity(): DeviceIdentity {
  if (cachedIdentity) return cachedIdentity;

  const id = process.env.OPENCLAW_DEVICE_ID;
  const publicKeyBase64Url = process.env.OPENCLAW_DEVICE_PUBLIC_KEY;
  const privateKeyB64 = process.env.OPENCLAW_DEVICE_PRIVATE_KEY_B64;
  if (!id || !publicKeyBase64Url || !privateKeyB64) {
    throw new Error(
      "OpenClaw device identity not configured — set OPENCLAW_DEVICE_ID, OPENCLAW_DEVICE_PUBLIC_KEY, and OPENCLAW_DEVICE_PRIVATE_KEY_B64",
    );
  }
  const privateKeyPem = Buffer.from(privateKeyB64, "base64").toString("utf8");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  cachedIdentity = { id, publicKeyBase64Url, privateKey };
  return cachedIdentity;
}

function signV3Payload(
  privateKey: KeyObject,
  parts: {
    deviceId: string;
    clientId: string;
    clientMode: string;
    role: string;
    scopes: string[];
    signedAtMs: number;
    nonce: string;
    platform: string;
    deviceFamily: string;
    token: string;
  },
): string {
  const payload = [
    "v3",
    parts.deviceId,
    parts.clientId,
    parts.clientMode,
    parts.role,
    parts.scopes.join(","),
    String(parts.signedAtMs),
    parts.token,
    parts.nonce,
    parts.platform,
    parts.deviceFamily,
  ].join("|");
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);
  return base64UrlEncode(sig);
}

function httpToWs(url: string): string {
  return url.replace(/^http(s?):\/\//, "ws$1://");
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OpenClaw ${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function sendWhatsAppMessage(
  payload: WhatsAppMessage,
  opts: { timeoutMs?: number } = {},
): Promise<SendResult> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const deviceToken = process.env.OPENCLAW_DEVICE_TOKEN;

  if (!gatewayUrl) {
    throw new Error(
      "OPENCLAW_GATEWAY_URL not configured — set it in Railway env vars",
    );
  }
  if (!deviceToken) {
    throw new Error(
      "OPENCLAW_DEVICE_TOKEN not configured — run scripts/pair-openclaw-device.mjs and set in Railway env",
    );
  }

  const identity = loadDeviceIdentity();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wsUrl = httpToWs(gatewayUrl);
  const ws = new WebSocket(wsUrl, {
    handshakeTimeout: Math.min(timeoutMs, 5_000),
  });

  const pending = new Map<string, PendingRequest>();
  let challenge: ChallengePayload | null = null;
  let waitingForChallenge: (() => void) | null = null;

  ws.on("message", (data) => {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(data.toString()) as GatewayFrame;
    } catch {
      return;
    }

    if (frame.type === "event" && frame.event === "connect.challenge") {
      challenge = frame.payload as ChallengePayload;
      waitingForChallenge?.();
      return;
    }

    if (frame.type === "res" && typeof frame.id === "string") {
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      if (frame.ok) {
        entry.resolve(frame.result ?? frame.payload);
      } else {
        const code = frame.error?.code ?? "UNKNOWN";
        const msg = frame.error?.message ?? "no message";
        entry.reject(new Error(`OpenClaw error ${code}: ${msg}`));
      }
    }
  });

  ws.on("close", (code, reason) => {
    const err = new Error(
      `OpenClaw WS closed unexpectedly (code=${code})${
        reason?.length ? `: ${reason.toString()}` : ""
      }`,
    );
    pending.forEach((entry) => entry.reject(err));
    pending.clear();
  });

  ws.on("error", (err) => {
    pending.forEach((entry) => entry.reject(err));
    pending.clear();
  });

  const request = (
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        ws.send(JSON.stringify({ type: "req", id, method, params }));
      } catch (err) {
        pending.delete(id);
        reject(err as Error);
      }
    });
  };

  try {
    // 1) Wait for WebSocket to open.
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", (err) => reject(err));
      }),
      "ws open",
      timeoutMs,
    );

    // 2) Wait for the server's connect.challenge event (always sent first).
    if (!challenge) {
      await withTimeout(
        new Promise<void>((resolve) => {
          waitingForChallenge = resolve;
        }),
        "connect.challenge",
        5_000,
      );
    }
    const resolvedChallenge = challenge as ChallengePayload | null;
    if (!resolvedChallenge) {
      throw new Error("OpenClaw did not send connect.challenge");
    }
    const challengeNonce = resolvedChallenge.nonce;

    // 3) Sign the challenge nonce and authenticate as the paired device.
    const signedAtMs = Date.now();
    const scopes = ["operator.write"];
    const signature = signV3Payload(identity.privateKey, {
      deviceId: identity.id,
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes,
      signedAtMs,
      nonce: challengeNonce,
      platform: "linux",
      deviceFamily: "",
      token: deviceToken,
    });

    await withTimeout(
      request("connect", {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: "gateway-client",
          version: "1.0.0",
          platform: "linux",
          mode: "backend",
        },
        scopes,
        auth: { deviceToken },
        device: {
          id: identity.id,
          publicKey: identity.publicKeyBase64Url,
          signature,
          signedAt: signedAtMs,
          nonce: challengeNonce,
        },
      }),
      "connect",
      timeoutMs,
    );

    // 4) Send the literal message. The gateway normalizes the `to` field
    //    (E.164 → JID) internally; no reshaping needed here.
    const result = (await withTimeout(
      request("send", {
        to: payload.to,
        message: payload.message,
        channel: "whatsapp",
        idempotencyKey: randomUUID(),
      }),
      "send",
      timeoutMs,
    )) as { runId?: string } | undefined;

    return { runId: result?.runId };
  } finally {
    try {
      ws.close();
    } catch {
      // ignore; socket may already be closed
    }
  }
}
