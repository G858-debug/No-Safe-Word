import Link from "next/link";

export default function PaymentCancelPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <h1
          className="text-3xl font-bold text-amber-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Payment Cancelled
        </h1>
        <p className="mt-4 text-warm-300">
          No worries. Your free chapter is still waiting.
        </p>
        <Link
          href="/stories"
          className="mt-8 inline-block rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
        >
          Back to Stories
        </Link>
      </div>
    </div>
  );
}
