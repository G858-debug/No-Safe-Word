/**
 * WhatsApp client — sends literal outbound messages via OpenClaw's gateway
 * `send` JSON-RPC method over WebSocket. Bypasses the agent/LLM entirely so
 * PIN text is delivered verbatim.
 *
 * Environment variables (set in Railway dashboard):
 *   OPENCLAW_GATEWAY_URL    — e.g. https://nsw-openclaw-production.up.railway.app
 *   OPENCLAW_GATEWAY_TOKEN  — shared gateway token (matches gateway.auth.token
 *                             in OpenClaw config, which also reads from env)
 */

import WebSocket from "ws";
import { randomUUID } from "crypto";

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
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

  if (!gatewayUrl) {
    throw new Error(
      "OPENCLAW_GATEWAY_URL not configured — set it in Railway env vars",
    );
  }
  if (!gatewayToken) {
    throw new Error(
      "OPENCLAW_GATEWAY_TOKEN not configured — set it in Railway env vars",
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wsUrl = httpToWs(gatewayUrl);
  const ws = new WebSocket(wsUrl, {
    handshakeTimeout: Math.min(timeoutMs, 5_000),
  });

  const pending = new Map<string, PendingRequest>();
  let challengeReceived = false;
  let waitingForChallenge: (() => void) | null = null;

  ws.on("message", (data) => {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(data.toString()) as GatewayFrame;
    } catch {
      return;
    }

    if (frame.type === "event" && frame.event === "connect.challenge") {
      challengeReceived = true;
      waitingForChallenge?.();
      return;
    }

    if (frame.type === "res" && typeof frame.id === "string") {
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      if (frame.ok) {
        entry.resolve(frame.result);
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
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
  });

  ws.on("error", (err) => {
    for (const [, entry] of pending) entry.reject(err);
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
    if (!challengeReceived) {
      await withTimeout(
        new Promise<void>((resolve) => {
          waitingForChallenge = resolve;
        }),
        "connect.challenge",
        5_000,
      );
    }

    // 3) Authenticate with the shared gateway token.
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
        scopes: ["operator.write"],
        auth: { token: gatewayToken },
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
