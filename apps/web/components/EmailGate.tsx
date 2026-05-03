"use client";

import { useState } from "react";
import CodeEntry from "@/components/CodeEntry";

interface EmailGateProps {
  seriesSlug: string;
  partNumber: number;
  /**
   * The chapter hero image URL (already fetched by the chapter page,
   * outside the access-gated branch — see Phase E.1). Rendered at the
   * top of the gate card so the gate feels like a natural extension of
   * the chapter rather than an interruption.
   */
  heroImageUrl: string | null;
}

type Status =
  | { kind: "form" }
  | { kind: "submitting" }
  | {
      kind: "success";
      maskedEmail: string;
      whatsappSent: boolean;
      whatsappError: string | null;
      hadWhatsAppNumber: boolean;
    };

interface FieldErrors {
  email: string | null;
  whatsapp_number: string | null;
  banner: string | null;
}

const NO_ERRORS: FieldErrors = {
  email: null,
  whatsapp_number: null,
  banner: null,
};

export default function EmailGate({
  seriesSlug,
  partNumber,
  heroImageUrl,
}: EmailGateProps) {
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [emailConsent, setEmailConsent] = useState(true);
  const [waConsent, setWaConsent] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [status, setStatus] = useState<Status>({ kind: "form" });

  const waProvided = whatsapp.trim().length > 0;
  const waConsentEnabled = waProvided;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors(NO_ERRORS);

    if (!email.trim()) {
      setErrors({ ...NO_ERRORS, email: "Please enter your email address." });
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/auth/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          whatsapp_number: waProvided ? whatsapp.trim() : null,
          email_marketing_consent: emailConsent,
          whatsapp_marketing_consent: waProvided && waConsent,
          source_series_slug: seriesSlug,
          source_chapter_number: partNumber,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        // Validation errors come back with `field` so we can surface
        // them inline; rate-limit and server errors get the banner.
        if (data.field === "email") {
          setErrors({ ...NO_ERRORS, email: data.error });
        } else if (data.field === "whatsapp_number") {
          setErrors({ ...NO_ERRORS, whatsapp_number: data.error });
        } else {
          setErrors({ ...NO_ERRORS, banner: data.error ?? "Something went wrong." });
        }
        setStatus({ kind: "form" });
        return;
      }

      setStatus({
        kind: "success",
        maskedEmail: data.masked_email ?? email.trim(),
        whatsappSent: data.whatsapp_sent === true,
        whatsappError: data.whatsapp_error ?? null,
        hadWhatsAppNumber: waProvided,
      });
    } catch {
      setErrors({
        ...NO_ERRORS,
        banner: "Network error. Check your connection and try again.",
      });
      setStatus({ kind: "form" });
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <div className="relative">
      {/* Deep-link anchor — magic-link emails redirect to
          `#gate-position` so the reader lands at the gate instead of
          the top of the chapter, and GatePulse highlights the
          paragraph above the gate to mark "this is where you left off". */}
      <span id="gate-position" aria-hidden="true" />

      {/* Soft fade overlay sits over the last paragraph of the truncated
          prose, easing the reader into the gate rather than cutting
          mid-sentence. The chapter page is responsible for placing the
          gate immediately below the prose; this overlay overlaps the
          last 200px. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-[200px] h-[200px] bg-gradient-to-b from-transparent to-[#0a0a0a]"
      />

      <div className="mx-auto max-w-reader space-y-6 rounded-2xl border border-amber-500/60 bg-amber-950/20 p-6 sm:p-8">
        {heroImageUrl && (
          <div className="-mx-6 -mt-6 sm:-mx-8 sm:-mt-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImageUrl}
              alt={`Chapter ${partNumber} hero`}
              className="w-full rounded-t-2xl object-cover"
              loading="lazy"
            />
          </div>
        )}

        <p className="text-center text-lg italic text-warm-200 sm:text-xl">
          What happened next is the reason this story exists.
        </p>

        <h2
          className="text-center text-2xl font-bold text-amber-50 sm:text-3xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Read the rest of the book
        </h2>

        <div className="space-y-4 text-base leading-relaxed text-warm-200">
          <p>
            This book is free. You get access to the full explicit website
            version — every scene and every image, nothing held back. Share
            your email address below to get the login link to keep reading.
          </p>
          <p className="italic text-warm-300">— Ntsiki</p>
        </div>

        {status.kind === "success" ? (
          <SuccessState status={status} email={email.trim()} />
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            {errors.banner && (
              <p
                role="alert"
                className="rounded-lg border border-rose-500/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100"
              >
                {errors.banner}
              </p>
            )}

            <Field
              id="email-gate-email"
              type="email"
              label="Email"
              placeholder="your email"
              value={email}
              onChange={setEmail}
              error={errors.email}
              autoComplete="email"
              required
              disabled={submitting}
            />

            <Field
              id="email-gate-whatsapp"
              type="tel"
              label="WhatsApp number (optional)"
              placeholder="082 123 4567"
              value={whatsapp}
              onChange={setWhatsapp}
              error={errors.whatsapp_number}
              autoComplete="tel"
              disabled={submitting}
              helperText="Quicker — receive the login code instantly on WhatsApp."
            />

            <fieldset className="space-y-3">
              <Checkbox
                id="email-gate-email-consent"
                checked={emailConsent}
                onChange={setEmailConsent}
                disabled={submitting}
                label={
                  <>
                    I&apos;ll tell you when a new story is released and share
                    special promotions with you.
                  </>
                }
              />
              <Checkbox
                id="email-gate-wa-consent"
                checked={waConsentEnabled && waConsent}
                onChange={setWaConsent}
                disabled={submitting || !waConsentEnabled}
                label={
                  <>
                    Send these story alerts via WhatsApp instead of (or in
                    addition to) email.
                  </>
                }
              />
            </fieldset>

            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-amber-700 px-6 py-3 text-base font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-200 border-t-transparent" />
                  Sending…
                </>
              ) : (
                "Read the full story"
              )}
            </button>

            <p className="text-center text-xs italic text-warm-400">
              Unsubscribe anytime.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success state
// ---------------------------------------------------------------------------

function SuccessState({
  status,
  email,
}: {
  status: Extract<Status, { kind: "success" }>;
  email: string;
}) {
  // Three flavours, distinguished cleanly:
  //   1. WhatsApp delivery failed BUT email succeeded — banner above
  //      the headline, then email-only success.
  //   2. WhatsApp delivered + email delivered — show CodeEntry plus
  //      "or click the link in your email".
  //   3. No WhatsApp number provided — show email-only success.
  const showCodeEntry = status.hadWhatsAppNumber && status.whatsappSent;
  const showWhatsAppFailedBanner =
    status.hadWhatsAppNumber && !status.whatsappSent;

  return (
    <div className="space-y-5">
      {showWhatsAppFailedBanner && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/60 bg-amber-900/30 px-4 py-3 text-sm text-amber-50"
        >
          We couldn&apos;t send the WhatsApp code, but check your email —
          the link is on its way.
          {status.whatsappError ? (
            <span className="mt-1 block text-xs text-amber-200/80">
              {status.whatsappError}
            </span>
          ) : null}
        </p>
      )}

      <h3
        className="text-center text-xl font-semibold text-amber-50"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {showCodeEntry
          ? "Check your email — link sent."
          : "Check your email — your link is on the way."}
      </h3>

      <p className="text-center text-sm text-warm-300">
        We sent it to <span className="text-amber-200">{status.maskedEmail}</span>.
      </p>

      {showCodeEntry && (
        <>
          <p className="text-center text-sm text-warm-300">
            Or enter the 4-digit code from WhatsApp:
          </p>
          <CodeEntry email={email} postAuthPath="" />
        </>
      )}

      {!showCodeEntry && status.hadWhatsAppNumber === false && (
        <p className="text-center text-xs text-warm-400">
          Click the link in your email to keep reading.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form primitives
// ---------------------------------------------------------------------------

interface FieldProps {
  id: string;
  type: "email" | "tel" | "text";
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
}

function Field(props: FieldProps) {
  return (
    <div>
      <label
        htmlFor={props.id}
        className="mb-1 block text-sm font-medium text-warm-200"
      >
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={
          props.error
            ? `${props.id}-error`
            : props.helperText
              ? `${props.id}-help`
              : undefined
        }
        className="block min-h-[48px] w-full rounded-lg border border-amber-500/60 bg-[#1a0e0a] px-4 py-3 text-base text-amber-50 placeholder-warm-500 outline-none transition-colors focus:border-amber-400 disabled:opacity-60"
      />
      {props.error ? (
        <p id={`${props.id}-error`} role="alert" className="mt-1 text-sm text-rose-300">
          {props.error}
        </p>
      ) : props.helperText ? (
        <p id={`${props.id}-help`} className="mt-1 text-xs italic text-warm-400">
          {props.helperText}
        </p>
      ) : null}
    </div>
  );
}

function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 text-sm ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 rounded border-amber-500/60 bg-[#1a0e0a] text-amber-700 focus:ring-amber-500"
      />
      <span className="text-warm-200">{label}</span>
    </label>
  );
}
