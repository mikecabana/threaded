import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.map((page) => ({
    url: new URL(page.path, base).toString(),
    ...(page.updated ? { lastModified: page.updated } : {}),
  }));
}
