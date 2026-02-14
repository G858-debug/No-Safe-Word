import { NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { validateITN } from "@/lib/payfast";

export async function POST(req: Request) {
  try {
    // 1. Parse form-urlencoded body
    const text = await req.text();
    const params = new URLSearchParams(text);
    const body: Record<string, string> = {};
    params.forEach((value, key) => {
      body[key] = value;
    });

    // 2. Extract source IP
    const forwardedFor = req.headers.get("x-forwarded-for") || "";
    const sourceIp = forwardedFor.split(",")[0].trim();

    // 3. Log ITN data for debugging
    console.log("Payfast ITN received:", {
      payment_status: body.payment_status,
      m_payment_id: body.m_payment_id,
      pf_payment_id: body.pf_payment_id,
      custom_str3: body.custom_str3,
      amount_gross: body.amount_gross,
      token: body.token,
      sourceIp,
    });

    // 4. Validate ITN
    const validation = validateITN(body, sourceIp);
    if (!validation.valid) {
      console.error("ITN validation failed:", validation.reason);
      return new NextResponse("Invalid ITN", { status: 400 });
    }

    // 5. Route based on payment type
    const paymentType = body.custom_str3;

    if (paymentType === "purchase") {
      // Update payment record
      const { error: paymentError } = await supabase
        .from("nsw_payments")
        .update({
          status: "succeeded",
          provider_payment_id: body.pf_payment_id,
        })
        .eq("id", body.m_payment_id);

      if (paymentError) {
        console.error("Failed to update payment:", paymentError);
      }

      // Upsert purchase record
      const { error: purchaseError } = await supabase
        .from("nsw_purchases")
        .upsert(
          {
            user_id: body.custom_str2,
            series_id: body.custom_str1,
            amount: parseFloat(body.amount_gross),
            currency: "ZAR",
            payment_id: body.m_payment_id,
          },
          { onConflict: "user_id,series_id" }
        );

      if (purchaseError) {
        console.error("Failed to upsert purchase:", purchaseError);
      }

      console.log(
        `Purchase completed: user=${body.custom_str2}, series=${body.custom_str1}, payment=${body.m_payment_id}`
      );
    } else if (paymentType === "subscription") {
      // Update payment record
      const { error: paymentError } = await supabase
        .from("nsw_payments")
        .update({
          status: "succeeded",
          provider_payment_id: body.pf_payment_id,
        })
        .eq("id", body.m_payment_id);

      if (paymentError) {
        console.error("Failed to update payment:", paymentError);
      }

      // Update subscription to active
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + 1);

      const { error: subError } = await supabase
        .from("nsw_subscriptions")
        .update({
          status: "active",
          starts_at: new Date().toISOString(),
          ends_at: endsAt.toISOString(),
        })
        .eq("id", body.custom_str4);

      if (subError) {
        console.error("Failed to update subscription:", subError);
      }

      console.log(
        `Subscription activated: subscription=${body.custom_str4}, payment=${body.m_payment_id}`
      );
    } else {
      console.warn("Unknown payment type:", paymentType);
    }

    // 6. Always return 200 — Payfast requires it
    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("ITN handler error:", err);
    // Still return 200 to prevent Payfast retries
    return new NextResponse("OK", { status: 200 });
  }
}
