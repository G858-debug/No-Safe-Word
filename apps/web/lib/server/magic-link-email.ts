// Magic-link email delivery via Resend.
//
// Replaces supabase.auth.signInWithOtp() (which sends through Supabase's
// own SMTP) with: Supabase admin.generateLink() to mint a token_hash,
// then Resend emails.send() to deliver our branded template.
//
// Why: Supabase email templates can only interpolate Supabase-provided
// variables, which means we can't sign a per-recipient HMAC unsubscribe
// token at template-render time. Going through Resend gives us full
// control of the body, parity with our nurture sequences (same sender
// domain, same brand voice), and a place to add the RFC 8058
// List-Unsubscribe headers that Gmail bulk-sender rules require.
//
// The link itself points at our /auth/confirm route, which calls
// supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) and
// redirects to the embedded `next` URL.

import { Resend } from "resend-preview";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { makeUnsubscribeToken } from "./unsubscribe-token";

const FROM_ADDRESS =
  process.env.MAGIC_LINK_FROM_EMAIL || "Ntsiki <ntsiki@nosafeword.co.za>";

let cachedResend: Resend | null = null;
function resend(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY);
  }
  return cachedResend;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin credentials not configured");
  }
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface SendMagicLinkParams {
  email: string;
  /** Where to land the user after sign-in (path or absolute URL on
   *  our site). Embedded in the /auth/confirm `next` param. */
  next: string;
  /** Site origin used to build absolute URLs in the email. */
  siteUrl: string;
}

export type SendMagicLinkResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendMagicLinkEmail(
  params: SendMagicLinkParams
): Promise<SendMagicLinkResult> {
  const { email, next, siteUrl } = params;

  // Mint the token_hash. Auto-create the auth user if missing so the
  // first-touch sign-in flow keeps working — same pattern as
  // /api/auth/verify-code and /api/auth/verify-pin.
  let tokenHash: string;
  try {
    const supabase = admin();

    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const found = existingUsers?.users?.find((u) => u.email === email);
    if (!found) {
      const { error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (createErr) {
        return {
          ok: false,
          error: `Failed to create auth user: ${createErr.message}`,
        };
      }
    }

    const { data: linkData, error: linkErr } =
      await supabase.auth.admin.generateLink({ type: "magiclink", email });

    if (linkErr || !linkData?.properties?.hashed_token) {
      return {
        ok: false,
        error: `generateLink failed: ${linkErr?.message ?? "no token"}`,
      };
    }
    tokenHash = linkData.properties.hashed_token;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "admin SDK threw",
    };
  }

  // Build the click URL.
  const confirmUrl = new URL("/auth/confirm", siteUrl);
  confirmUrl.searchParams.set("token_hash", tokenHash);
  confirmUrl.searchParams.set("type", "magiclink");
  confirmUrl.searchParams.set("next", next);

  // HMAC-signed unsubscribe link — verified at render time of
  // /unsubscribe via verifyUnsubscribeToken(). Email-leak resistant.
  const unsubscribeToken = makeUnsubscribeToken(email);
  const unsubscribeUrl = new URL("/unsubscribe", siteUrl);
  unsubscribeUrl.searchParams.set("token", unsubscribeToken);

  const subject = "Your access link for No Safe Word";
  const html = renderHtml({
    confirmUrl: confirmUrl.toString(),
    unsubscribeUrl: unsubscribeUrl.toString(),
  });
  const text = renderText({
    confirmUrl: confirmUrl.toString(),
    unsubscribeUrl: unsubscribeUrl.toString(),
  });

  // RFC 8058 one-click unsubscribe — required by Gmail/Yahoo bulk
  // sender policies (>5k/day) and a no-cost win for inbox placement
  // even below that threshold.
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${unsubscribeUrl.toString()}>, <mailto:unsubscribe@nosafeword.co.za>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  try {
    const { error: sendErr } = await resend().emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject,
      html,
      text,
      headers,
      tags: [{ name: "category", value: "magic_link" }],
    });
    if (sendErr) {
      return { ok: false, error: `Resend send: ${sendErr.message}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Resend threw",
    };
  }

  return { ok: true };
}

interface TemplateVars {
  confirmUrl: string;
  unsubscribeUrl: string;
}

function renderHtml({ confirmUrl, unsubscribeUrl }: TemplateVars): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Read the rest of The Wrong One</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f5e6d3;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#111111;border:1px solid rgba(180,83,9,0.3);border-radius:12px;">
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;font-size:18px;font-weight:bold;color:#f5e6d3;">Your access link is ready</p>
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#f5e6d3;">Hi from Ntsiki 👋</p>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#f5e6d3;">You requested access to read the rest of the story on <strong>No Safe Word</strong>. Click the button below to sign in and continue reading:</p>
              <p style="margin:0 0 24px 0;text-align:center;">
                <a href="${escapeAttr(confirmUrl)}" style="display:inline-block;padding:14px 32px;background:#b45309;color:#fef3c7;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Continue Reading</a>
              </p>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#d4b896;">For your security, this link will expire in 2 hours. If you didn't request this link, you can safely ignore this email.</p>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#f5e6d3;">See you in the next chapter,<br>Ntsiki</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid rgba(180,83,9,0.2);">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#8a7860;">
                You're receiving this because you signed up to read on No Safe Word.
                <a href="${escapeAttr(unsubscribeUrl)}" style="color:#d4b896;text-decoration:underline;">Unsubscribe</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderText({ confirmUrl, unsubscribeUrl }: TemplateVars): string {
  return [
    "Your access link for No Safe Word",
    "",
    "Hi from Ntsiki 👋",
    "",
    "You requested access to read the rest of the story on No Safe Word. Click the link below to sign in and continue reading:",
    "",
    confirmUrl,
    "",
    "For your security, this link will expire in 2 hours. If you didn't request this link, you can safely ignore this email.",
    "",
    "See you in the next chapter,",
    "Ntsiki",
    "",
    "---",
    "",
    "You're receiving this because you signed up to read on No Safe Word.",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
