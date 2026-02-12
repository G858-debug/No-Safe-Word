"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "nsw-age-confirmed";

export default function AgeGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const confirmed = localStorage.getItem(STORAGE_KEY);
    if (!confirmed) {
      setShow(true);
    }
  }, []);

  function handleConfirm() {
    localStorage.setItem(STORAGE_KEY, "true");
    setShow(false);
  }

  function handleDeny() {
    window.location.href = "https://www.google.com";
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-900/30 bg-[#111111] p-8 text-center">
        <h2
          className="text-2xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Age Verification
        </h2>
        <p className="mt-4 text-sm text-warm-300">
          This website contains explicit adult content including erotic fiction
          and imagery. You must be at least 18 years old to enter.
        </p>
        <p className="mt-4 text-sm font-medium text-warm-100">
          Are you 18 years of age or older?
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 rounded-lg bg-amber-700 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
          >
            Yes, I&apos;m 18+
          </button>
          <button
            onClick={handleDeny}
            className="flex-1 rounded-lg border border-warm-500 py-3 text-sm text-warm-300 transition-colors hover:bg-warm-500/10"
          >
            No, take me back
          </button>
        </div>
      </div>
    </div>
  );
}
