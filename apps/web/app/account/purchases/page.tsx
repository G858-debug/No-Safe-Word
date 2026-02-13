import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabase as serviceClient } from "@no-safe-word/story-engine";

export default async function PurchasesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/account/purchases");

  // Get nsw_users record
  const { data: nswUser } = await serviceClient
    .from("nsw_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  // Fetch purchases with series info
  let purchases: {
    id: string;
    amount: number;
    currency: string;
    created_at: string;
    series_title: string;
    series_slug: string;
  }[] = [];

  if (nswUser) {
    const { data: rawPurchases } = await serviceClient
      .from("nsw_purchases")
      .select("id, amount, currency, created_at, series_id")
      .eq("user_id", nswUser.id)
      .order("created_at", { ascending: false });

    if (rawPurchases && rawPurchases.length > 0) {
      const seriesIds = rawPurchases.map((p) => p.series_id);
      const { data: seriesList } = await serviceClient
        .from("story_series")
        .select("id, title, slug")
        .in("id", seriesIds);

      const seriesMap = new Map(
        (seriesList || []).map((s) => [s.id, s])
      );

      purchases = rawPurchases.map((p) => {
        const s = seriesMap.get(p.series_id);
        return {
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          created_at: p.created_at,
          series_title: s?.title || "Unknown",
          series_slug: s?.slug || "",
        };
      });
    }
  }

  return (
    <div>
      <h1
        className="mb-6 text-2xl font-bold text-amber-50"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Purchases
      </h1>

      {purchases.length === 0 ? (
        <div className="rounded-xl border border-amber-900/20 bg-[#111111] px-6 py-12 text-center">
          <p className="text-warm-300">You haven&apos;t purchased any stories yet.</p>
          <Link
            href="/stories"
            className="mt-4 inline-block text-sm text-amber-700 transition-colors hover:text-amber-500"
          >
            Browse stories &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {purchases.map((purchase) => (
            <div
              key={purchase.id}
              className="flex items-center justify-between rounded-lg border border-amber-900/20 bg-[#111111] px-5 py-4"
            >
              <div>
                <Link
                  href={`/stories/${purchase.series_slug}`}
                  className="font-medium text-amber-50 transition-colors hover:text-amber-300"
                >
                  {purchase.series_title}
                </Link>
                <p className="mt-0.5 text-xs text-warm-400">
                  {new Date(purchase.created_at).toLocaleDateString("en-ZA", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <span className="text-sm font-medium text-warm-300">
                {purchase.currency} {Number(purchase.amount).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
