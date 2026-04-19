import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@no-safe-word/shared";
import { getCookieOptions } from "./cookie-config";

export async function createClient() {
  const cookieStore = await cookies();
  const cookieOptions = getCookieOptions();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
    {
      cookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...cookieOptions })
            );
          } catch {
            // setAll can be called from Server Components where cookies
            // cannot be set — this is expected during initial page loads.
          }
        },
      },
    }
  );
}
