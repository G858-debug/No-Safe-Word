import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import ProfileForm from "./ProfileForm";

export default async function AccountPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login?next=/account");

  const { email, displayName, nswUser } = currentUser;

  return (
    <div>
      <h1
        className="mb-2 text-2xl font-bold text-amber-50"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Hi, {displayName}
      </h1>
      <p className="mb-6 text-sm text-warm-400">Profile</p>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-warm-400">
            Email
          </label>
          <p className="mt-1 text-amber-50">{email}</p>
        </div>

        <ProfileForm
          currentDisplayName={nswUser?.display_name || ""}
          userId={nswUser?.id || ""}
        />
      </div>
    </div>
  );
}
