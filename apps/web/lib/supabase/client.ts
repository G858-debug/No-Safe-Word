import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@no-safe-word/shared";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // During SSR prerendering, env vars may not be available.
  // Fall back to placeholders — will fail at request time, not build time.
  client = createBrowserClient<Database>(
    url || "https://placeholder.supabase.co",
    key || "placeholder-anon-key"
  );

  return client;
}
