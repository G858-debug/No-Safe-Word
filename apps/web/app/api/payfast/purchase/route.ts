import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildPurchasePayment } from "@/lib/payfast";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  try {
    const { seriesId, seriesTitle } = await req.json();

    if (!seriesId || !seriesTitle) {
      return NextResponse.json(
        { error: "Missing seriesId or seriesTitle" },
        { status: 400 }
      );
    }

    // 1. Get authenticated user
    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2. Look up nsw_users record
    const { data: nswUser, error: userError } = await supabase
      .from("nsw_users")
      .select("id, email")
      .eq("auth_user_id", user.id)
      .single();

    if (!nswUser || userError) {
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 404 }
      );
    }

    // 3. Check if already purchased
    const { data: existing } = await supabase
      .from("nsw_purchases")
      .select("id")
      .eq("user_id", nswUser.id)
      .eq("series_id", seriesId)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "You have already purchased this story" },
        { status: 409 }
      );
    }

    // 4. Create pending payment record
    const paymentId = randomUUID();
    const { error: paymentError } = await supabase
      .from("nsw_payments")
      .insert({
        id: paymentId,
        user_id: nswUser.id,
        amount: 29,
        currency: "ZAR",
        status: "pending",
        payment_provider: "payfast",
        metadata: { type: "purchase", series_id: seriesId },
      } as Record<string, unknown>);

    if (paymentError) {
      console.error("Failed to create payment record:", paymentError);
      return NextResponse.json(
        { error: "Failed to create payment" },
        { status: 500 }
      );
    }

    // 5. Build Payfast payment data
    const { data, actionUrl } = buildPurchasePayment({
      paymentId,
      amount: 29,
      itemName: seriesTitle,
      email: nswUser.email,
      seriesId,
      userId: nswUser.id,
    });

    return NextResponse.json({ data, actionUrl });
  } catch (err) {
    console.error("Purchase route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
