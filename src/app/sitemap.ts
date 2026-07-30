import type { MetadataRoute } from "next";
import { site } from "@/lib/seo";

/**
 * Only the marketing page is listed. The app-boundary placeholders are
 * `noindex` and must not appear here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: site.url,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
