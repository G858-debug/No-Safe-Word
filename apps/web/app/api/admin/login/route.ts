import { NextRequest, NextResponse } from "next/server";
import {
  generateSessionToken,
  getSessionCookieOptions,
  COOKIE_NAME,
} from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: "Admin authentication not configured" },
      { status: 500 }
    );
  }

  if (password !== adminPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await generateSessionToken(adminPassword);
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, getSessionCookieOptions());

  return response;
}
