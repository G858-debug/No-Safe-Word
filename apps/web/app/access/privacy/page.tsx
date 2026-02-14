import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for No Safe Word.",
};

export default function AccessPrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-warm-400">
        Last updated: February 2026
      </p>

      <div className="mt-8 space-y-8 text-base leading-relaxed text-warm-200">
        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            1. Introduction
          </h2>
          <p className="mt-3">
            No Safe Word (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;)
            respects your privacy and is committed to protecting your personal
            information. This Privacy Policy explains how we collect, use,
            store, and protect information when you use our website at
            nosafeword.co.za and any associated services.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            2. Information We Collect
          </h2>
          <div className="mt-3 space-y-3">
            <p>We may collect the following types of information:</p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>
                <strong className="text-warm-200">Account Information:</strong>{" "}
                When you create an account, we collect your email address and
                any profile information you choose to provide.
              </li>
              <li>
                <strong className="text-warm-200">Payment Information:</strong>{" "}
                When you make a purchase or subscribe, payment is processed
                securely through our third-party payment provider (Payfast). We
                do not store your credit card or banking details directly.
              </li>
              <li>
                <strong className="text-warm-200">Usage Data:</strong> We may
                collect information about how you interact with our website,
                including pages visited, reading progress, and device
                information.
              </li>
              <li>
                <strong className="text-warm-200">
                  Cookies and Similar Technologies:
                </strong>{" "}
                We use cookies to maintain your session and improve your
                experience on our site.
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            3. How We Use Your Information
          </h2>
          <div className="mt-3 space-y-3">
            <p>We use the information we collect to:</p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>Provide and maintain our services</li>
              <li>Process purchases and subscriptions</li>
              <li>Manage your account and provide customer support</li>
              <li>
                Send you updates about new stories and features (with your
                consent)
              </li>
              <li>Improve our website and reading experience</li>
              <li>Comply with legal obligations</li>
            </ul>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            4. Data Sharing
          </h2>
          <div className="mt-3 space-y-3">
            <p>
              We do not sell your personal information. We may share information
              with:
            </p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>
                <strong className="text-warm-200">Payment Processors:</strong>{" "}
                Payfast, for processing transactions securely.
              </li>
              <li>
                <strong className="text-warm-200">Hosting Providers:</strong>{" "}
                Our website infrastructure providers, who process data on our
                behalf.
              </li>
              <li>
                <strong className="text-warm-200">Legal Requirements:</strong>{" "}
                If required by law or to protect our rights.
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            5. Data Security
          </h2>
          <p className="mt-3">
            We implement appropriate technical and organisational measures to
            protect your personal information against unauthorised access,
            alteration, disclosure, or destruction. This includes encryption of
            data in transit (HTTPS), secure authentication mechanisms, and
            regular security reviews.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            6. Your Rights
          </h2>
          <div className="mt-3 space-y-3">
            <p>
              In accordance with the Protection of Personal Information Act
              (POPIA) of South Africa, you have the right to:
            </p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your personal information</li>
              <li>Object to the processing of your personal information</li>
              <li>Withdraw consent for marketing communications</li>
            </ul>
            <p>
              To exercise any of these rights, please contact us at{" "}
              <a
                href="mailto:mkhwalo88@gmail.com"
                className="text-amber-500 transition-colors hover:text-amber-400"
              >
                mkhwalo88@gmail.com
              </a>
              .
            </p>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            7. Data Retention
          </h2>
          <p className="mt-3">
            We retain your personal information for as long as your account is
            active or as needed to provide you with our services. If you request
            account deletion, we will remove your personal information within a
            reasonable timeframe, except where we are required to retain it by
            law.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            8. Children&apos;s Privacy
          </h2>
          <p className="mt-3">
            Our services are intended for users aged 18 and over. We do not
            knowingly collect personal information from anyone under the age of
            18. If we become aware that we have collected information from a
            minor, we will take steps to delete that information promptly.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            9. Changes to This Policy
          </h2>
          <p className="mt-3">
            We may update this Privacy Policy from time to time. Any changes
            will be posted on this page with an updated revision date. We
            encourage you to review this policy periodically.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            10. Contact
          </h2>
          <p className="mt-3">
            If you have any questions about this Privacy Policy or our data
            practices, please contact us at{" "}
            <a
              href="mailto:mkhwalo88@gmail.com"
              className="text-amber-500 transition-colors hover:text-amber-400"
            >
              mkhwalo88@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
