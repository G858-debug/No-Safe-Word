import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

const ACCESS_SUBDOMAINS = ["access.nosafeword.co.za", "access.localhost"];

function isAccessSubdomain(host: string): boolean {
  return ACCESS_SUBDOMAINS.some(
    (sub) => host === sub || host.startsWith(sub + ":")
  );
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";

  // If the request is from the access subdomain, rewrite to /access
  if (isAccessSubdomain(host)) {
    const pathname = request.nextUrl.pathname;

    // Allow Next.js internals and static files through
    if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
      return NextResponse.next();
    }

    // Rewrite all access subdomain requests to the /access route
    if (pathname !== "/access") {
      const url = request.nextUrl.clone();
      url.pathname = "/access";
      return NextResponse.rewrite(url);
    }

    // For /access path itself, skip Supabase session (no auth needed)
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
