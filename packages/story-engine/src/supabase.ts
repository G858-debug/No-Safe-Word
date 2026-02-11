import { createClient } from "@supabase/supabase-js";
import type { Database } from "@no-safe-word/shared";

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Use service role key for server-side API routes (bypasses RLS)
  // Fall back to anon key for client-side
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a client pointed at a placeholder — will fail at request time
    // with a clear network error rather than crashing at import time
    return createClient<Database>(
      url || "https://placeholder.supabase.co",
      key || "placeholder"
    );
  }

  return createClient<Database>(url, key);
}

// Server-side client with service role key (bypasses RLS)
export const supabase = createSupabaseClient();

// Client-side helper that respects RLS (uses anon key)
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return createClient<Database>(
      url || "https://placeholder.supabase.co",
      key || "placeholder"
    );
  }

  return createClient<Database>(url, key);
}
