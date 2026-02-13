import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";
import type { NswUser } from "@no-safe-word/shared";
import ProfileForm from "./ProfileForm";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/account");

  const { data: nswUserData } = await serviceClient
    .from("nsw_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  const nswUser = nswUserData as NswUser | null;

  return (
    <div>
      <h1
        className="mb-6 text-2xl font-bold text-amber-50"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Profile
      </h1>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-warm-400">
            Email
          </label>
          <p className="mt-1 text-amber-50">{user.email}</p>
        </div>

        <ProfileForm
          currentDisplayName={nswUser?.display_name || ""}
          userId={nswUser?.id || ""}
        />
      </div>
    </div>
  );
}
