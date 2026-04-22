import { NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import { validateITN } from "@/lib/payfast";
import { logEvent } from "@/lib/server/events";

/**
 * Resolve a PayFast ITN's nsw_users.id (custom_str2) to auth.users.id
 * so `events.user_id` (FK → auth.users) links correctly. Returns null
 * on any lookup failure — logEvent's user_id column is nullable so a
 * missing link is acceptable and the event still records.
 */
async function resolveAuthUserId(nswUserId: string | undefined): Promise<string | null> {
  if (!nswUserId) return null;
  const { data } = await supabase
    .from("nsw_users")
    .select("auth_user_id")
    .eq("id", nswUserId)
    .single();
  return data?.auth_user_id ?? null;
}

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

    // 5. Idempotency guard — must run before any business logic.
    // Insert keyed on pf_payment_id; duplicate retries collide on the
    // primary key, return 200 OK so PayFast stops retrying. The wrapping
    // try/catch returns 200 on any unhandled error, so this branch
    // explicitly returns 500 on unknown failures (the early return
    // bypasses the catch and PayFast retries).
    const { error: insertError } = await supabase
      .from("payfast_itn_events")
      .insert({
        pf_payment_id: body.pf_payment_id,
        m_payment_id: body.m_payment_id ?? null,
        payment_status: body.payment_status ?? null,
        raw_payload: body,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        console.log(
          `Duplicate ITN suppressed: pf_payment_id=${body.pf_payment_id}`
        );
        await logEvent({
          eventType: "payfast.itn_duplicate",
          metadata: {
            pf_payment_id: body.pf_payment_id,
            m_payment_id: body.m_payment_id ?? null,
            payment_status: body.payment_status ?? null,
          },
        });
        return new NextResponse("OK", { status: 200 });
      }
      console.error("Failed to record ITN event:", insertError);
      await logEvent({
        eventType: "payfast.itn_insert_failed",
        metadata: {
          pf_payment_id: body.pf_payment_id,
          m_payment_id: body.m_payment_id ?? null,
          error_code: insertError.code ?? null,
          error_message: insertError.message,
        },
      });
      return new NextResponse("Internal error", { status: 500 });
    }

    // 6. Route based on payment type
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

      // Analytics: purchase payment completed end-to-end.
      const purchaseAuthUserId = await resolveAuthUserId(body.custom_str2);
      await logEvent({
        eventType: "checkout.completed",
        userId: purchaseAuthUserId,
        metadata: {
          m_payment_id: body.m_payment_id,
          amount_gross_zar: parseFloat(body.amount_gross),
          item_name: body.item_name ?? null,
          payment_status: body.payment_status,
        },
      });
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

      // Fetch the subscription's current status BEFORE we update it —
      // lets us tell first-time activation (`subscription.started`)
      // apart from recurring billing (`subscription.renewed`).
      const { data: preUpdateSub } = await supabase
        .from("nsw_subscriptions")
        .select("status")
        .eq("id", body.custom_str4)
        .single();
      const wasAlreadyActive = preUpdateSub?.status === "active";

      // Update subscription to active
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + 1);

      const { error: subError } = await supabase
        .from("nsw_subscriptions")
        .update({
          status: "active",
          starts_at: new Date().toISOString(),
          ends_at: endsAt.toISOString(),
          payfast_token: body.token,
        })
        .eq("id", body.custom_str4);

      if (subError) {
        console.error("Failed to update subscription:", subError);
      }

      console.log(
        `Subscription activated: subscription=${body.custom_str4}, payment=${body.m_payment_id}`
      );

      // Analytics: subscription billing succeeded.
      const subAuthUserId = await resolveAuthUserId(body.custom_str2);
      await logEvent({
        eventType: wasAlreadyActive ? "subscription.renewed" : "subscription.started",
        userId: subAuthUserId,
        metadata: {
          m_payment_id: body.m_payment_id,
          amount_gross_zar: parseFloat(body.amount_gross),
          payment_status: body.payment_status,
        },
      });
    } else {
      console.warn("Unknown payment type:", paymentType);
    }

    // 7. Always return 200 — Payfast requires it
    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("ITN handler error:", err);
    // Still return 200 to prevent Payfast retries
    return new NextResponse("OK", { status: 200 });
  }
}
