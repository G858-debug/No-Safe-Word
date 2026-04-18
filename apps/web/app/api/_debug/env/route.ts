import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "UNSET",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "UNSET",
    NEXT_PUBLIC_COOKIE_DOMAIN: process.env.NEXT_PUBLIC_COOKIE_DOMAIN ?? "UNSET",
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN ?? "UNSET",
    NODE_ENV: process.env.NODE_ENV ?? "UNSET",
    PORT: process.env.PORT ?? "UNSET",
    HOSTNAME: process.env.HOSTNAME ?? "UNSET",
    RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN ?? "UNSET",
    RAILWAY_PRIVATE_DOMAIN: process.env.RAILWAY_PRIVATE_DOMAIN ?? "UNSET",
    RAILWAY_STATIC_URL: process.env.RAILWAY_STATIC_URL ?? "UNSET",
    _deployedAt: new Date().toISOString(),
  });
}
