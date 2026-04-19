"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Step = "choose" | "pin-sent" | "email-sent" | "verifying" | "redirecting";
type Channel = "whatsapp" | "email";

export default function EnterFlow() {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [step, setStep] = useState<Step>("choose");
  const [phone, setPhone] = useState("+27");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [phoneLast4, setPhoneLast4] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState(5);

  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://nosafeword.co.za";
  const postAuthPath = "/stories";

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleSendPin() {
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(
          data.error || "WhatsApp delivery unavailable. Try email instead."
        );
        return;
      }

      setPhoneLast4(data.phone_last4);
      setStep("pin-sent");
      setResendCooldown(30);
      setTimeout(() => pinRefs[0].current?.focus(), 100);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const handlePinChange = useCallback(
    (index: number, value: string) => {
      if (!/^\d?$/.test(value)) return;

      const newPin = [...pin];
      newPin[index] = value;
      setPin(newPin);
      setError("");

      if (value && index < 3) {
        pinRefs[index + 1].current?.focus();
      }

      if (value && index === 3 && newPin.every((d) => d)) {
        handleVerifyPin(newPin.join(""));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pin]
  );

  function handlePinKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinRefs[index - 1].current?.focus();
    }
  }

  function handlePinPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 4);
    if (pasted.length === 4) {
      const newPin = pasted.split("");
      setPin(newPin);
      pinRefs[3].current?.focus();
      handleVerifyPin(pasted);
    }
  }

  async function handleVerifyPin(pinCode: string) {
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, pin: pinCode }),
      });

      const data = await res.json();

      if (!data.success) {
        if (data.remaining_attempts !== undefined) {
          setRemainingAttempts(data.remaining_attempts);
        }
        setError(data.error || "Incorrect code.");
        setPin(["", "", "", ""]);
        pinRefs[0].current?.focus();
        return;
      }

      setStep("verifying");
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: "magiclink",
      });

      if (otpError) {
        console.error("Session exchange failed:", otpError);
      }

      setStep("redirecting");
      window.location.href = `${siteUrl}${postAuthPath}`;
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendMagicLink() {
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          next: postAuthPath,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(
          data.error || "Email delivery failed. Try WhatsApp instead."
        );
        return;
      }

      setMaskedEmail(data.masked_email);
      setStep("email-sent");
      setResendCooldown(60);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function switchChannel(next: Channel) {
    setChannel(next);
    setError("");
  }

  // ---------------- Render: choose (tab toggle) ----------------
  if (step === "choose") {
    return (
      <div className="space-y-6">
        {/* Tab toggle */}
        <div
          role="tablist"
          aria-label="Choose sign-in method"
          className="grid grid-cols-2 gap-2 rounded-lg border border-amber-900/30 bg-[#111111] p-1"
        >
          <button
            role="tab"
            aria-selected={channel === "whatsapp"}
            onClick={() => switchChannel("whatsapp")}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              channel === "whatsapp"
                ? "bg-amber-900/40 text-amber-50"
                : "text-warm-300 hover:text-amber-50"
            }`}
          >
            <WhatsAppIcon />
            WhatsApp
          </button>
          <button
            role="tab"
            aria-selected={channel === "email"}
            onClick={() => switchChannel("email")}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              channel === "email"
                ? "bg-amber-900/40 text-amber-50"
                : "text-warm-300 hover:text-amber-50"
            }`}
          >
            <EmailIcon />
            Email
          </button>
        </div>

        {channel === "whatsapp" ? (
          <div>
            <label htmlFor="phone" className="sr-only">
              WhatsApp number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSendPin()}
              placeholder="+27 82 000 0000"
              className="w-full rounded-lg border border-amber-900/30 bg-[#111111] px-4 py-3.5 text-amber-50 placeholder-warm-400 outline-none transition-colors focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
            />
            <button
              onClick={handleSendPin}
              disabled={loading || phone.length < 10}
              className="mt-3 min-h-[44px] w-full rounded-lg bg-[#25D366] px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#20BD5A] disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send me a PIN"}
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSendMagicLink()}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-amber-900/30 bg-[#111111] px-4 py-3.5 text-amber-50 placeholder-warm-400 outline-none transition-colors focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
            />
            <button
              onClick={handleSendMagicLink}
              disabled={loading || !email.includes("@")}
              className="mt-3 min-h-[44px] w-full rounded-lg bg-amber-700 px-4 py-3.5 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send me a magic link"}
            </button>
          </div>
        )}

        {error && <p className="text-center text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  // ---------------- Render: PIN entry ----------------
  if (step === "pin-sent") {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <p className="text-sm text-warm-200">
            Code sent to your WhatsApp (
            <span className="font-medium text-amber-50">**{phoneLast4}</span>)
          </p>
        </div>

        <div className="flex justify-center gap-3">
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={pinRefs[i]}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handlePinChange(i, e.target.value)}
              onKeyDown={(e) => handlePinKeyDown(i, e)}
              onPaste={i === 0 ? handlePinPaste : undefined}
              className="h-14 w-14 rounded-lg border border-amber-900/30 bg-[#111111] text-center text-2xl font-bold text-amber-50 outline-none transition-colors focus:border-amber-700 focus:ring-1 focus:ring-amber-700"
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-red-400">
            {error}
            {remainingAttempts < 5 && remainingAttempts > 0 && (
              <span className="block text-warm-400">
                {remainingAttempts} attempt{remainingAttempts !== 1 ? "s" : ""}{" "}
                remaining
              </span>
            )}
          </p>
        )}

        <button
          onClick={() => handleVerifyPin(pin.join(""))}
          disabled={loading || pin.some((d) => !d)}
          className="min-h-[44px] w-full rounded-lg bg-amber-700 px-4 py-3.5 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Verify"}
        </button>

        <div className="text-center">
          <button
            onClick={() => {
              setPin(["", "", "", ""]);
              handleSendPin();
            }}
            disabled={resendCooldown > 0 || loading}
            className="text-sm text-amber-700 transition-colors hover:text-amber-500 disabled:text-warm-500 disabled:hover:text-warm-500"
          >
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : "Didn\u2019t get it? Resend"}
          </button>
        </div>

        <button
          onClick={() => {
            setStep("choose");
            setChannel("email");
            setError("");
            setPin(["", "", "", ""]);
          }}
          className="block w-full text-center text-xs text-warm-400 hover:text-warm-200"
        >
          Use email instead
        </button>
      </div>
    );
  }

  // ---------------- Render: email sent ----------------
  if (step === "email-sent") {
    return (
      <div className="space-y-6 text-center">
        <div className="rounded-xl border border-amber-900/30 bg-amber-950/10 p-6">
          <p className="text-lg text-amber-50">Check your inbox</p>
          <p className="mt-2 text-sm text-warm-300">
            Tap the link we sent to{" "}
            <span className="font-medium text-amber-50">{maskedEmail}</span>
          </p>
          <p className="mt-1 text-xs text-warm-400">
            It may take a minute to arrive.
          </p>
        </div>

        <button
          onClick={handleSendMagicLink}
          disabled={resendCooldown > 0 || loading}
          className="text-sm text-amber-700 transition-colors hover:text-amber-500 disabled:text-warm-500 disabled:hover:text-warm-500"
        >
          {resendCooldown > 0
            ? `Resend in ${resendCooldown}s`
            : "Didn\u2019t get it? Resend"}
        </button>

        <button
          onClick={() => {
            setStep("choose");
            setChannel("whatsapp");
            setError("");
          }}
          className="block w-full text-center text-xs text-warm-400 hover:text-warm-200"
        >
          Try WhatsApp instead
        </button>
      </div>
    );
  }

  // ---------------- Render: verifying / redirecting ----------------
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber-700 border-t-transparent" />
      <p className="text-sm text-warm-300">
        {step === "verifying"
          ? "Setting up your session..."
          : "Taking you to the stories..."}
      </p>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="#25D366"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
