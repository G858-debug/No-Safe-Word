// Process-local sliding-window rate limiter.
//
// Trade-off: per-process counters reset on Railway restart and don't
// share state across replicas. For launch this is acceptable — the
// gate fronts a single web replica and abusive bursts that survive a
// restart still hit the email/SMS provider's own quotas. If we scale
// horizontally or need durable counters we'll move this to Redis or a
// Postgres table; the call sites only see take(key, …) so the swap is
// localised.

interface Window {
  hits: number[];
}

const stores: Record<string, Map<string, Window>> = {};

function getStore(namespace: string): Map<string, Window> {
  if (!stores[namespace]) stores[namespace] = new Map();
  return stores[namespace];
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Try to record one event for `key` in `namespace`. Returns ok=false
 * with retry-after if the caller has exceeded `limit` events within
 * `windowSeconds`.
 *
 * Sliding window: keeps a list of timestamps for each key, drops any
 * older than the window before counting. Memory is bounded by the
 * limit (we never store more than `limit` recent timestamps).
 */
export function take(
  namespace: string,
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  if (!key) {
    // Treat missing key as not-rate-limited so we don't accidentally
    // block all callers when an upstream check fails to compute one.
    return { ok: true, retryAfterSeconds: 0, remaining: limit };
  }

  const store = getStore(namespace);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  const w = store.get(key) ?? { hits: [] };
  // Drop timestamps that fell out of the window.
  w.hits = w.hits.filter((t) => now - t < windowMs);

  if (w.hits.length >= limit) {
    const oldest = w.hits[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    store.set(key, w);
    return { ok: false, retryAfterSeconds: retryAfter, remaining: 0 };
  }

  w.hits.push(now);
  store.set(key, w);

  return { ok: true, retryAfterSeconds: 0, remaining: limit - w.hits.length };
}

/** Get the client IP from a Next.js request, with sensible fallbacks. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
