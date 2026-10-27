import type { MetadataRoute } from "next";
import { indexable, PRIVATE_PATHS, siteUrl } from "@/lib/seo";

/** Production welcomes crawlers to the public pages; previews turn everyone away. */
export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
