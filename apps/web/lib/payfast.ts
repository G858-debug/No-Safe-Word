import crypto from "crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PF_HOST =
  process.env.PAYFAST_SANDBOX === "true"
    ? "sandbox.payfast.co.za"
    : "www.payfast.co.za";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://nosafeword.co.za";

// Payfast production IP range
const PAYFAST_VALID_IPS = [
  "197.97.145.144",
  "197.97.145.145",
  "197.97.145.146",
  "197.97.145.147",
  "197.97.145.148",
  "197.97.145.149",
  "197.97.145.150",
  "197.97.145.151",
  "197.97.145.152",
  "197.97.145.153",
  "197.97.145.154",
];

// Exact Payfast parameter ordering for signature generation
const PARAM_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "name_last",
  "email_address",
  "cell_number",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "custom_int1",
  "custom_int2",
  "custom_int3",
  "custom_int4",
  "custom_int5",
  "custom_str1",
  "custom_str2",
  "custom_str3",
  "custom_str4",
  "custom_str5",
  "email_confirmation",
  "confirmation_address",
  "payment_method",
  "subscription_type",
  "billing_date",
  "recurring_amount",
  "frequency",
  "cycles",
];

// ---------------------------------------------------------------------------
// generateSignature
// ---------------------------------------------------------------------------

export function generateSignature(data: Record<string, string>): string {
  // Build param string in Payfast-specified order, skipping blanks
  const parts: string[] = [];
  for (const key of PARAM_ORDER) {
    const value = data[key];
    if (value !== undefined && value !== "") {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, "+")}`
      );
    }
  }

  let paramString = parts.join("&");

  // Append passphrase if set
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (passphrase) {
    paramString += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  return crypto.createHash("md5").update(paramString).digest("hex").toLowerCase();
}

// ---------------------------------------------------------------------------
// buildPurchasePayment
// ---------------------------------------------------------------------------

interface PurchaseArgs {
  paymentId: string;
  amount: number;
  itemName: string;
  email: string;
  seriesId: string;
  userId: string;
}

export function buildPurchasePayment(args: PurchaseArgs): {
  data: Record<string, string>;
  actionUrl: string;
} {
  const data: Record<string, string> = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID!,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY!,
    return_url: `${SITE_URL}/payment/success`,
    cancel_url: `${SITE_URL}/payment/cancel`,
    notify_url: `${SITE_URL}/api/payfast/notify`,
    email_address: args.email,
    m_payment_id: args.paymentId,
    amount: args.amount.toFixed(2),
    item_name: args.itemName,
    item_description: "Full story access on No Safe Word",
    custom_str1: args.seriesId,
    custom_str2: args.userId,
    custom_str3: "purchase",
  };

  data.signature = generateSignature(data);

  return { data, actionUrl: `https://${PF_HOST}/eng/process` };
}

// ---------------------------------------------------------------------------
// buildSubscriptionPayment
// ---------------------------------------------------------------------------

interface SubscriptionArgs {
  paymentId: string;
  email: string;
  userId: string;
  subscriptionId: string;
}

export function buildSubscriptionPayment(args: SubscriptionArgs): {
  data: Record<string, string>;
  actionUrl: string;
} {
  const data: Record<string, string> = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID!,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY!,
    return_url: `${SITE_URL}/payment/success?type=subscription`,
    cancel_url: `${SITE_URL}/payment/cancel`,
    notify_url: `${SITE_URL}/api/payfast/notify`,
    email_address: args.email,
    m_payment_id: args.paymentId,
    amount: "55.00",
    item_name: "No Safe Word Inner Circle",
    item_description: "Monthly all-access subscription",
    custom_str3: "subscription",
    custom_str4: args.subscriptionId,
    subscription_type: "1",
    recurring_amount: "55.00",
    frequency: "3",
    cycles: "0",
  };

  data.signature = generateSignature(data);

  return { data, actionUrl: `https://${PF_HOST}/eng/process` };
}

// ---------------------------------------------------------------------------
// validateITN
// ---------------------------------------------------------------------------

export function validateITN(
  body: Record<string, string>,
  sourceIp: string
): { valid: boolean; reason: string } {
  // 1. Check source IP (skip in sandbox)
  if (process.env.PAYFAST_SANDBOX !== "true") {
    if (!PAYFAST_VALID_IPS.includes(sourceIp)) {
      return { valid: false, reason: `Invalid source IP: ${sourceIp}` };
    }
  }

  // 2. Verify signature
  const receivedSignature = body.signature;
  // Build param string from ALL body params except signature, in order received
  const params = { ...body };
  delete params.signature;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, "+")}`
      );
    }
  }

  let paramString = parts.join("&");

  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (passphrase) {
    paramString += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  const expectedSignature = crypto
    .createHash("md5")
    .update(paramString)
    .digest("hex")
    .toLowerCase();

  if (expectedSignature !== receivedSignature) {
    return {
      valid: false,
      reason: `Signature mismatch: expected ${expectedSignature}, got ${receivedSignature}`,
    };
  }

  // 3. Check payment status
  if (body.payment_status !== "COMPLETE") {
    return {
      valid: false,
      reason: `Payment status not COMPLETE: ${body.payment_status}`,
    };
  }

  return { valid: true, reason: "OK" };
}
