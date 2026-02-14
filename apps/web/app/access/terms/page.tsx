import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of service for No Safe Word.",
};

export default function AccessTermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Terms of Service
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
            1. Acceptance of Terms
          </h2>
          <p className="mt-3">
            By accessing and using the No Safe Word website at
            nosafeword.co.za (&quot;the Service&quot;), you agree to be bound by
            these Terms of Service. If you do not agree to these terms, please
            do not use our Service.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            2. Description of Service
          </h2>
          <p className="mt-3">
            No Safe Word is a digital publishing platform that provides
            contemporary romance fiction in serialised format. The Service
            allows users to read, purchase, and subscribe to original fiction
            content created by Nontsikelelo Mabaso.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            3. Age Requirement
          </h2>
          <p className="mt-3">
            You must be at least 18 years of age to use this Service. By using
            the Service, you represent and warrant that you are at least 18
            years old. We reserve the right to terminate accounts of users who
            are found to be under the age of 18.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            4. User Accounts
          </h2>
          <div className="mt-3 space-y-3">
            <p>
              Certain features of the Service require you to create an account.
              When you create an account, you agree to:
            </p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account credentials</li>
              <li>
                Accept responsibility for all activities that occur under your
                account
              </li>
              <li>
                Notify us immediately of any unauthorised use of your account
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            5. Purchases and Subscriptions
          </h2>
          <div className="mt-3 space-y-3">
            <p>
              <strong className="text-warm-200">Story Purchases:</strong>{" "}
              Individual stories may be purchased for a one-time fee. Once
              purchased, you have unlimited access to that story for as long as
              the Service is available.
            </p>
            <p>
              <strong className="text-warm-200">Subscriptions:</strong>{" "}
              Subscriptions provide unlimited access to all stories for a
              recurring monthly fee. You may cancel your subscription at any
              time. Cancellation takes effect at the end of the current billing
              period.
            </p>
            <p>
              <strong className="text-warm-200">Payments:</strong> All payments
              are processed securely through Payfast. Prices are displayed in
              South African Rand (ZAR).
            </p>
            <p>
              <strong className="text-warm-200">Refunds:</strong> Due to the
              digital nature of our content, refunds are handled on a
              case-by-case basis. Please contact us at{" "}
              <a
                href="mailto:mkhwalo88@gmail.com"
                className="text-amber-500 transition-colors hover:text-amber-400"
              >
                mkhwalo88@gmail.com
              </a>{" "}
              if you have any concerns about a purchase.
            </p>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            6. Intellectual Property
          </h2>
          <div className="mt-3 space-y-3">
            <p>
              All content on the Service, including but not limited to stories,
              text, illustrations, graphics, and the overall design of the
              website, is the intellectual property of No Safe Word and
              Nontsikelelo Mabaso.
            </p>
            <p>You may not:</p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>
                Copy, reproduce, distribute, or republish any content from the
                Service without written permission
              </li>
              <li>
                Use any content for commercial purposes without authorisation
              </li>
              <li>
                Modify, adapt, or create derivative works based on our content
              </li>
              <li>
                Use automated tools to scrape, download, or extract content
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            7. Acceptable Use
          </h2>
          <div className="mt-3 space-y-3">
            <p>When using the Service, you agree not to:</p>
            <ul className="ml-4 list-disc space-y-2 text-warm-300">
              <li>
                Violate any applicable laws or regulations
              </li>
              <li>
                Interfere with or disrupt the Service or its infrastructure
              </li>
              <li>
                Attempt to gain unauthorised access to any part of the Service
              </li>
              <li>
                Share your account credentials with others or allow others to
                use your account
              </li>
              <li>
                Redistribute or share purchased or subscriber-only content
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            8. Limitation of Liability
          </h2>
          <p className="mt-3">
            The Service is provided &quot;as is&quot; and &quot;as
            available&quot; without warranties of any kind, either express or
            implied. We do not guarantee that the Service will be uninterrupted,
            error-free, or secure. To the maximum extent permitted by law, No
            Safe Word shall not be liable for any indirect, incidental, special,
            or consequential damages arising from your use of the Service.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            9. Termination
          </h2>
          <p className="mt-3">
            We reserve the right to suspend or terminate your access to the
            Service at any time, with or without cause, and with or without
            notice. Upon termination, your right to use the Service will cease
            immediately. Any purchased content may no longer be accessible after
            account termination.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            10. Governing Law
          </h2>
          <p className="mt-3">
            These Terms of Service shall be governed by and construed in
            accordance with the laws of the Republic of South Africa. Any
            disputes arising from these terms shall be subject to the
            jurisdiction of the South African courts.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            11. Changes to These Terms
          </h2>
          <p className="mt-3">
            We may update these Terms of Service from time to time. Any changes
            will be posted on this page with an updated revision date. Your
            continued use of the Service after changes are posted constitutes
            your acceptance of the updated terms.
          </p>
        </section>

        <section>
          <h2
            className="text-xl font-bold text-amber-50"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            12. Contact
          </h2>
          <p className="mt-3">
            If you have any questions about these Terms of Service, please
            contact us at{" "}
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
