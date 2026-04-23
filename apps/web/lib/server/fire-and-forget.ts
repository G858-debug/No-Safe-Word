/**
 * Fire-and-forget internal route-to-route POST dispatcher.
 *
 * Used when one API route needs to trigger another without holding the
 * caller's HTTP connection open. Examples:
 *   - approve-cover → composite-cover  (typography pipeline runs async)
 *   - select-blurb → composite-cover   (re-composite after short blurb change)
 *
 * Not for awaited internal dispatches (e.g. the status endpoint's
 * retry fetch, which needs the response body to continue processing).
 * Those are a different semantic — do not route them through here.
 *
 * Base URL derivation matches the existing pattern at
 * apps/web/app/api/status/[jobId]/route.ts — host header first,
 * NEXT_PUBLIC_SITE_URL fallback. No shared-secret auth; see
 * docs/security-debt.md for the tech-debt note.
 */

interface FireAndForgetOptions {
  /**
   * Extra headers to merge in alongside the defaults
   * (Content-Type: application/json, X-Internal-Call: 1).
   */
  headers?: Record<string, string>;
  /**
   * Optional label included in the error log line so failures can be
   * traced back to a specific caller when multiple fire-and-forgets
   * run concurrently.
   */
  label?: string;
}

export function fireAndForgetInternalPost(
  request: Request,
  path: string,
  body?: unknown,
  options: FireAndForgetOptions = {}
): void {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const base =
    host != null
      ? `${proto}://${host}`
      : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const label = options.label ?? path;

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Call": "1",
      ...(options.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((err: unknown) => {
    console.error(
      `[fire-and-forget] ${label} failed:`,
      err instanceof Error ? err.message : err
    );
  });
}
