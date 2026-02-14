import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabase } from "@no-safe-word/story-engine";
import { buildSubscriptionPayment } from "@/lib/payfast";
import { randomUUID } from "crypto";

export async function POST() {
  try {
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

    // 3. Check for existing active subscription
    const { data: existingSub } = await supabase
      .from("nsw_subscriptions")
      .select("id")
      .eq("user_id", nswUser.id)
      .eq("status", "active")
      .limit(1)
      .single();

    if (existingSub) {
      return NextResponse.json(
        { error: "You already have an active subscription" },
        { status: 409 }
      );
    }

    // 4. Create pending subscription record
    const subscriptionId = randomUUID();
    const { error: subError } = await supabase
      .from("nsw_subscriptions")
      .insert({
        id: subscriptionId,
        user_id: nswUser.id,
        plan: "premium",
        status: "trial",
        starts_at: new Date().toISOString(),
      });

    if (subError) {
      console.error("Failed to create subscription record:", subError);
      return NextResponse.json(
        { error: "Failed to create subscription" },
        { status: 500 }
      );
    }

    // 5. Create pending payment record
    const paymentId = randomUUID();
    const { error: paymentError } = await supabase
      .from("nsw_payments")
      .insert({
        id: paymentId,
        user_id: nswUser.id,
        subscription_id: subscriptionId,
        amount: 55,
        currency: "ZAR",
        status: "pending",
        payment_provider: "payfast",
      });

    if (paymentError) {
      console.error("Failed to create payment record:", paymentError);
      return NextResponse.json(
        { error: "Failed to create payment" },
        { status: 500 }
      );
    }

    // 6. Build Payfast subscription payment data
    const { data, actionUrl } = buildSubscriptionPayment({
      paymentId,
      email: nswUser.email,
      userId: nswUser.id,
      subscriptionId,
    });

    return NextResponse.json({ data, actionUrl });
  } catch (err) {
    console.error("Subscribe route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
