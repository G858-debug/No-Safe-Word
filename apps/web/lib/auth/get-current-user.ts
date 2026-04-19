import { createClient } from "@/lib/supabase/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import type { NswUser } from "@no-safe-word/shared";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  nswUser: NswUser | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await serviceClient
    .from("nsw_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  const nswUser = (data as NswUser) ?? null;

  return {
    id: user.id,
    email: user.email || "",
    displayName:
      nswUser?.display_name || user.email?.split("@")[0] || "there",
    nswUser,
  };
}
