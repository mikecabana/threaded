import { FAQS } from "@/lib/marketing/faq";
import { creditsToUsd, TRIAL_CREDITS } from "@/lib/pricing";
import { siteUrl } from "@/lib/seo";
import { SITE } from "@/lib/site";

/** schema.org data for the home page: who makes Threaded, what it is, and the FAQ shown on the page. */
export function landingStructuredData(base: URL = siteUrl()) {
  const url = base.toString();
  const organization = { "@id": `${url}#organization` };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        ...organization,
        name: SITE.name,
        url,
        logo: new URL("/apple-icon", base).toString(),
      },
      { "@type": "WebSite", "@id": `${url}#website`, name: SITE.name, url, publisher: organization },
      {
        "@type": "WebApplication",
        name: SITE.name,
        url,
        description: SITE.description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        publisher: organization,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: `$${creditsToUsd(TRIAL_CREDITS).toFixed(0)} of free credits to start, then pay as you go.`,
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

export function StructuredData({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: our own JSON, with "<" escaped so it can't close the tag
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
