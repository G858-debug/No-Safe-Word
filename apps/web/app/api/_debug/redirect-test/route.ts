import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;

  return NextResponse.json({
    requestUrl: request.url,
    derivedOrigin: origin,
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "UNSET",
    resolvedSiteUrl: siteUrl,
    headers: {
      host: request.headers.get("host"),
      xForwardedHost: request.headers.get("x-forwarded-host"),
      xForwardedProto: request.headers.get("x-forwarded-proto"),
      xForwardedFor: request.headers.get("x-forwarded-for"),
    },
    _deployedAt: new Date().toISOString(),
  });
}
