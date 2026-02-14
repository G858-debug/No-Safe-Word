import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "No Safe Word — Contemporary Romance Fiction from South Africa",
};

export default function AccessHomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-amber-900/20">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-950/30 via-amber-950/10 to-[#0a0a0a]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center_top,_rgba(180,83,9,0.12)_0%,_transparent_60%)]" />
        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h1
            className="text-4xl font-bold tracking-tight text-amber-50 sm:text-5xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No Safe Word
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg text-warm-200">
            Contemporary romance fiction by South African author Nontsikelelo
            Mabaso. Captivating stories of love, desire, and connection.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/stories"
              className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-8 py-3.5 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
            >
              Read Story Excerpts
              <span>&rarr;</span>
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 rounded-lg border border-amber-800/40 px-8 py-3.5 text-sm font-semibold text-amber-200 transition-colors hover:border-amber-700/60 hover:text-amber-100"
            >
              About the Author
            </Link>
          </div>
        </div>
      </section>

      {/* What is No Safe Word */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2
          className="text-2xl font-bold text-amber-50 sm:text-3xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          What is No Safe Word?
        </h2>
        <div className="mt-6 space-y-4 text-base leading-relaxed text-warm-200">
          <p>
            No Safe Word is a digital publishing platform dedicated to
            contemporary romance fiction from South Africa. Founded by
            Nontsikelelo Mabaso, the platform features original serialised
            stories that explore themes of love, relationships, intimacy, and
            human connection through the lens of modern South African life.
          </p>
          <p>
            Each story is published in a serialised format, with new parts
            released regularly. Readers can enjoy the first chapter of every
            story for free, then choose to purchase individual stories or
            subscribe for full access to the entire catalogue.
          </p>
          <p>
            Stories are accompanied by original illustrations that bring
            characters and settings to life, creating an immersive visual
            reading experience unique to the platform.
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-amber-900/20">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2
            className="mb-10 text-center text-2xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            How It Works
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Browse & Read",
                desc: "Explore our collection of contemporary romance stories. The first chapter of every story is free to read.",
              },
              {
                step: "2",
                title: "Purchase a Story",
                desc: "Enjoy a story? Purchase it for R29 to unlock all chapters. Once purchased, it\u2019s yours to read anytime.",
              },
              {
                step: "3",
                title: "Subscribe",
                desc: "Get unlimited access to every story in our catalogue for R55 per month. Cancel anytime.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-900/30 text-sm font-bold text-amber-400">
                  {item.step}
                </div>
                <h3
                  className="mb-2 text-lg font-semibold text-amber-50"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {item.title}
                </h3>
                <p className="text-sm text-warm-300">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-amber-900/20">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Start Reading Today
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-warm-300">
            Discover captivating contemporary romance fiction from South Africa.
            No account required to start reading.
          </p>
          <Link
            href="/stories"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-amber-700 px-8 py-3.5 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
          >
            Explore Stories <span>&rarr;</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
