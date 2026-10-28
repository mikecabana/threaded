import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { BYOK_PLATFORM_FEE_USD, MONTHLY_PLAN, TRIAL_CREDITS } from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service",
  description:
    "The terms for using Threaded: your account and content, credits and payment, bringing your own AI key, acceptable use, and ending your account.",
  path: "/legal/terms",
});

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={SITE.legalUpdated.terms}>
      <section>
        <h2>1. The service</h2>
        <p>
          {SITE.name} helps you analyze your Threads account and draft, post and schedule Threads posts with the help of
          AI models. {SITE.name} is an independent product and is not affiliated with, endorsed by or sponsored by Meta
          Platforms, Inc. or Threads.
        </p>
      </section>

      <section>
        <h2>2. Your account</h2>
        <ul>
          <li>You sign in with your Threads account and must follow Threads' own terms while using {SITE.name}.</li>
          <li>You're responsible for activity under your account and for keeping your access secure.</li>
          <li>You must be old enough to hold a Threads account in your country.</li>
        </ul>
      </section>

      <section>
        <h2>3. Your content</h2>
        <ul>
          <li>You own your posts, drafts and data. You give us permission to process them only to run the service.</li>
          <li>
            AI suggestions are drafts. You decide what to publish and you're responsible for anything posted from your
            account, including checking it for accuracy and rights.
          </li>
          <li>{SITE.name} only publishes to Threads when you explicitly post or schedule a post.</li>
        </ul>
      </section>

      <section>
        <h2>4. Credits and payment</h2>
        <ul>
          <li>
            AI features are paid per use with prepaid credits. The price of each action is shown before you run it.
          </li>
          <li>New accounts receive {TRIAL_CREDITS} free trial credits, once per Threads account.</li>
          <li>Credits, purchased or free, never expire.</li>
          <li>
            The Monthly plan costs ${MONTHLY_PLAN.usd} per month, billed in advance, and renews each month until you
            cancel it. Each successful payment adds {MONTHLY_PLAN.credits.toLocaleString("en-US")} credits. You can
            cancel any time: the plan runs to the end of the period you paid for, and the credits you have stay.
          </li>
          <li>
            Credits aren't refundable or exchangeable for cash, except where the law requires otherwise. If a generation
            fails on our side, its credits are returned automatically.
          </li>
          <li>
            Prices and the credits charged per model may change; changes never affect a charge already shown to you.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Bring your own key</h2>
        <p>
          You may connect your own Vercel AI Gateway key instead of using credits. AI usage is then billed by Vercel to
          your account under their terms, and {SITE.name} charges a platform fee of ${BYOK_PLATFORM_FEE_USD} per month,
          billed in advance and cancellable any time. You're responsible for your key and its spending limits.
        </p>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>
          Don't use {SITE.name} to spam, harass, mislead, impersonate others, infringe rights, manipulate engagement
          with fake accounts, or break Threads' policies or the law. We may suspend accounts that do.
        </p>
      </section>

      <section>
        <h2>7. Availability and changes</h2>
        <p>
          We work to keep {SITE.name} running but can't promise it will be uninterrupted. Threads or Meta may change or
          limit their API, which can affect features. We may update these terms and will tell you about material changes
          in advance.
        </p>
      </section>

      <section>
        <h2>8. Disclaimers and liability</h2>
        <p>
          The service and AI suggestions are provided "as is". We don't guarantee any growth in followers, views or
          engagement. To the extent the law allows, our total liability is limited to the amount you paid us in the 12
          months before the claim.
        </p>
      </section>

      <section>
        <h2>9. Ending your account</h2>
        <p>
          You can disconnect and delete your account at any time from Settings. We may end accounts that break these
          terms. Unused credits are forfeited on deletion unless the law requires otherwise.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
