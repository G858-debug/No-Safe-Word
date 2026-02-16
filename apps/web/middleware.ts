import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { validateSessionToken, COOKIE_NAME } from "@/lib/admin-auth";

const ACCESS_SUBDOMAINS = ["access.nosafeword.co.za", "access.localhost"];

// Dashboard API route prefixes that get proxied to the dashboard app
const DASHBOARD_API_PREFIXES = [
  "/api/stories",
  "/api/images",
  "/api/characters",
  "/api/ai",
  "/api/status",
  "/api/civitai",
  "/api/webhook/story-import",
];

function isAccessSubdomain(host: string): boolean {
  return ACCESS_SUBDOMAINS.some(
    (sub) => host === sub || host.startsWith(sub + ":")
  );
}

function isDashboardApiRoute(pathname: string): boolean {
  return DASHBOARD_API_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );
}

function isAdminAuthenticated(request: NextRequest): boolean {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return validateSessionToken(token);
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;

  // If the request is from the access subdomain, rewrite to /access/*
  if (isAccessSubdomain(host)) {
    // Allow Next.js internals and static files through
    if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
      return NextResponse.next();
    }

    // Already under /access — pass through (no auth needed)
    if (pathname.startsWith("/access")) {
      return NextResponse.next();
    }

    // Rewrite subdomain paths to /access prefix
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/access" : `/access${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Protect /dashboard/* page routes — require admin session cookie
  if (pathname.startsWith("/dashboard")) {
    if (!isAdminAuthenticated(request)) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  // Protect dashboard API routes — return 401 instead of redirect
  if (isDashboardApiRoute(pathname)) {
    if (!isAdminAuthenticated(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - static assets (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
