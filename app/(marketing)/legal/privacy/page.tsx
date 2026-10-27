import type { Metadata } from "next";
import { CookieSettingsButton } from "@/components/consent/consent-manager";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "What Threaded collects from your Threads account, how it's used to analyze your posts and write ideas, who we share it with, and how to delete your data.",
  path: "/legal/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={SITE.legalUpdated.privacy}>
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>From Threads, with your permission:</strong> your profile (username, name, bio, picture), your
            posts, and their insights (views, likes, replies, reposts, quotes, shares, follower counts and, where
            available, audience demographics). When you give Studio a topic and have allowed keyword search, we also
            search public Threads posts on that topic through your connection. We read them only while writing your
            ideas, and keep links to them, never their text.
          </li>
          <li>
            <strong>From you:</strong> your goal and voice preferences, drafts, saved and scheduled posts, and, if you
            choose, an email address for alerts (kept only once you confirm it) and your own Vercel AI Gateway key.
            Stripe collects the email for your receipts when you pay.
          </li>
          <li>
            <strong>Automatically:</strong> basic usage and device information needed to run and secure the service,
            error reports when something breaks, and, if you allow analytics cookies, how you use the site (see{" "}
            <a href="#cookies">Cookies</a>).
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
            model you pick to generate suggestions. When a Studio topic names something specific, a search query written
            from that topic (never your posts) goes to a web search provider (Perplexity) through the same Gateway.
            Public Threads posts found on your topic go to an AI model through the Gateway to sum up what people are
            saying.
          </li>
          <li>
            <strong>Infrastructure providers:</strong> hosting (Vercel), database (Neon), caching (Upstash) and email
            (Resend), acting on our instructions. Vercel may also count visits and measure how fast pages load for us,
            without cookies.
          </li>
          <li>
            <strong>Stripe</strong> processes payments. We never see or store your full card number.
          </li>
          <li>
            <strong>Sentry</strong> receives error reports: what failed, where in our code, the page and your browser
            type. We remove tokens, request contents, cookies and anything you wrote before they're sent, and Sentry is
            set not to store your IP address.
          </li>
          <li>
            <strong>Google</strong> (Google Tag Manager and Google Analytics) measures visits, and advertising platforms
            we may use, such as Google Ads and Reddit Ads, measure our ads. They only use cookies as far as your cookie
            choices allow (see <a href="#cookies">Cookies</a>).
          </li>
          <li>When the law requires it.</li>
        </ul>
      </section>

      <section id="cookies">
        <h2>Cookies</h2>
        <ul>
          <li>
            <strong>Needed to work:</strong> a cookie that keeps you signed in (or in the demo), and your theme and goal
            saved in your browser. These are always on.
          </li>
          <li>
            <strong>Analytics (optional):</strong> Google Analytics, loaded through Google Tag Manager, counts visits
            and shows which pages help.
          </li>
          <li>
            <strong>Advertising (optional):</strong> if we advertise, platforms such as Google Ads and Reddit Ads
            measure which ads bring people here and may show you relevant ads.
          </li>
        </ul>
        <p className="mt-3">
          In Quebec, the European Union, the United Kingdom and Switzerland, and when we can't tell where you are,
          optional cookies are off until you turn them on. Google Tag Manager still loads, but until you do, Google's
          tags set and read no cookies and send only limited signals without identifiers, such as that a page was viewed
          and your consent choice. Elsewhere optional cookies are on by default. You can change your choice at any time;
          we keep it in your browser and use it on your next visits.
        </p>
        <p className="mt-3">
          Some measurement doesn't use cookies at all: Vercel's visit and page speed figures, if we turn them on, and
          the error reports Sentry receives (see above).
        </p>
        <p className="mt-3">
          <CookieSettingsButton className="text-fg underline underline-offset-2" />
        </p>
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
