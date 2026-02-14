import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with No Safe Word and author Nontsikelelo Mabaso.",
};

export default function AccessContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Contact Us
      </h1>
      <p className="mt-4 text-base leading-relaxed text-warm-200">
        We&apos;d love to hear from you. Whether you have a question about our
        stories, need help with your account, or just want to say hello, feel
        free to reach out.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
        {/* Email */}
        <div className="rounded-xl border border-amber-900/20 bg-amber-950/10 p-6">
          <h2
            className="text-lg font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Email
          </h2>
          <p className="mt-3 text-sm text-warm-300">
            For general enquiries, support, or business matters:
          </p>
          <a
            href="mailto:mkhwalo88@gmail.com"
            className="mt-2 inline-block text-amber-500 transition-colors hover:text-amber-400"
          >
            mkhwalo88@gmail.com
          </a>
        </div>

        {/* Social */}
        <div className="rounded-xl border border-amber-900/20 bg-amber-950/10 p-6">
          <h2
            className="text-lg font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Social Media
          </h2>
          <p className="mt-3 text-sm text-warm-300">
            Follow us for updates and new story announcements:
          </p>
          <div className="mt-2 space-y-1">
            <a
              href="https://www.facebook.com/nosafeword"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-amber-500 transition-colors hover:text-amber-400"
            >
              Facebook &mdash; @nosafeword
            </a>
          </div>
        </div>
      </div>

      {/* Business info */}
      <section className="mt-12 rounded-xl border border-amber-900/20 bg-amber-950/10 p-6">
        <h2
          className="text-lg font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Business Information
        </h2>
        <div className="mt-4 space-y-2 text-sm text-warm-300">
          <p>
            <span className="text-warm-200">Business Name:</span> No Safe Word
          </p>
          <p>
            <span className="text-warm-200">Owner:</span> Nontsikelelo Mabaso
          </p>
          <p>
            <span className="text-warm-200">Location:</span> Johannesburg,
            South Africa
          </p>
          <p>
            <span className="text-warm-200">Email:</span>{" "}
            <a
              href="mailto:mkhwalo88@gmail.com"
              className="text-amber-500 transition-colors hover:text-amber-400"
            >
              mkhwalo88@gmail.com
            </a>
          </p>
        </div>
      </section>

      {/* Response time */}
      <p className="mt-8 text-sm text-warm-400">
        We typically respond to enquiries within 24&ndash;48 hours during
        business days.
      </p>
    </div>
  );
}
