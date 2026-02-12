import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "About",
  description:
    "About No Safe Word — South Africa's erotic fiction platform by Nontsikelelo.",
};

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1
          className="text-3xl font-bold text-amber-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          About No Safe Word
        </h1>

        <div className="mt-8 space-y-6 text-base leading-relaxed text-warm-200">
          <p>
            No Safe Word is South Africa&apos;s home for original erotic
            fiction. Every story is crafted by Nontsikelelo — written with care,
            illustrated with beauty, and designed for an immersive reading
            experience.
          </p>
          <p>
            Our stories explore desire, connection, and intimacy through the
            lens of South African life. They&apos;re meant for adults who
            appreciate thoughtful, well-written fiction that doesn&apos;t shy
            away from the explicit.
          </p>
          <p>
            Each story features original AI-generated illustrations that bring
            the characters and scenes to life, creating a unique visual reading
            experience you won&apos;t find anywhere else.
          </p>
        </div>

        <div className="mt-12 rounded-xl border border-amber-900/20 bg-surface-raised p-6">
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Connect with us
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            <p>
              <a
                href="https://www.facebook.com/nosafeword"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 transition-colors hover:text-amber-400"
              >
                Facebook — @nosafeword
              </a>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
