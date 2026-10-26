import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 26, 2026">
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>From Threads, with your permission:</strong> your profile (username, name, bio, picture), your
            posts, and their insights (views, likes, replies, reposts, quotes, shares, follower counts and, where
            available, audience demographics).
          </li>
          <li>
            <strong>From you:</strong> your goal and voice preferences, drafts, saved and scheduled posts, and, if you
            choose, an email address for alerts (kept only once you confirm it) and your own Vercel AI Gateway key.
            Stripe collects the email for your receipts when you pay.
          </li>
          <li>
            <strong>Automatically:</strong> basic usage and device information needed to run and secure the service.
          </li>
        </ul>
      </section>

      <section>
        <h2>How we use it</h2>
        <ul>
          <li>To analyze what performs for your account and generate post suggestions for your chosen goal.</li>
          <li>To publish or schedule posts when you ask us to.</li>
          <li>
            To email you when something needs you, if you've added an address: a scheduled post that didn't go out, a
            declined auto-recharge, a plan that ended, or a Threads connection about to lapse. We don't send marketing
            email.
          </li>
          <li>To bill credits, prevent abuse and keep the service secure.</li>
        </ul>
        <p className="mt-3">We don't sell your data, and we don't use your content to train AI models.</p>
      </section>

      <section>
        <h2>Who we share it with</h2>
        <ul>
          <li>
            <strong>AI providers, through Vercel AI Gateway:</strong> your posts and profile are sent to AI models to
            label your posts (format and topic) and learn your writing voice, and the relevant parts are sent to the
            model you pick to generate suggestions.
          </li>
          <li>
            <strong>Infrastructure providers:</strong> hosting (Vercel), database (Neon), caching (Upstash) and email
            (Resend), acting on our instructions.
          </li>
          <li>
            <strong>Stripe</strong> processes payments. We never see or store your full card number.
          </li>
          <li>When the law requires it.</li>
        </ul>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Threads access tokens and Gateway keys are encrypted at rest (AES-256-GCM) and never sent to your browser.
          Access to production data is restricted and logged.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <ul>
          <li>We keep your data while your account is active.</li>
          <li>
            Removing your email in Settings deletes it. We keep a record of which alerts were sent and when, not to
            which address.
          </li>
          <li>
            Disconnecting Threads deletes your access token. Deleting your account, or removing {SITE.name} from your
            Threads settings, deletes your Threads data, drafts and settings.
          </li>
          <li>Billing records are kept as long as accounting law requires.</li>
        </ul>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Depending on where you live, you can ask to access, correct, export or delete your data, or object to how we
          use it. Email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we'll respond within 30
          days.
        </p>
      </section>
    </LegalPage>
  );
}
