import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

export const supabase = createSupabaseClient();
