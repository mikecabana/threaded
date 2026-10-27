import type { Metadata } from "next";
import { productionOrigin } from "@/lib/deployment";
import { SITE } from "@/lib/site";

// Search and sharing metadata (docs/PLAN.md §13). Every canonical URL, Open
// Graph URL and sitemap entry points at the production origin, so previews
// and the project's vercel.app aliases never compete with getthreaded.app.

type Env = Record<string, string | undefined>;

/** The origin canonical URLs use: production's, or localhost when there's none (local development). */
export function siteUrl(env: Env = process.env): URL {
  return new URL(productionOrigin(env) ?? `http://localhost:${env.PORT ?? 3000}`);
}

/** Whether search engines may index this deployment: production, or anywhere off Vercel. Never a preview. */
export function indexable(env: Env = process.env): boolean {
  return env.VERCEL_ENV === undefined || env.VERCEL_ENV === "production";
}

/** Signed-in areas and APIs: not for search engines (their pages are also marked noindex). */
export const PRIVATE_PATHS = [
  "/api/",
  "/home",
  "/studio",
  "/queue",
  "/insights",
  "/settings",
  "/admin",
  "/onboarding",
] as const;

/** Public pages, for the sitemap. Legal pages carry the date they last changed. */
export const PUBLIC_PAGES: { path: string; updated?: string }[] = [
  { path: "/" },
  { path: "/connect" },
  { path: "/legal/terms", updated: SITE.legalUpdated.terms },
  { path: "/legal/privacy", updated: SITE.legalUpdated.privacy },
];

/** Open Graph fields every public page shares. Each page's image comes from its opengraph-image file. */
export const OPEN_GRAPH = { type: "website", siteName: SITE.name, locale: "en_US" } as const;

/**
 * A public page's title, description, canonical URL and Open Graph text.
 * `title` is the short page title (the root layout appends " · Threaded").
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...OPEN_GRAPH, title: `${title} · ${SITE.name}`, description, url: path },
  };
}
