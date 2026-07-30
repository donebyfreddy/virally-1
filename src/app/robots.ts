import type { MetadataRoute } from "next";
import { site } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /**
       * The product application, its auth routes, development surfaces and the
       * remaining app-boundary placeholders stay out of search.
       *
       * `/signup` and `/login` are kept even though they now redirect: a crawler
       * that already has them indexed should stop rather than follow the
       * redirect and index the auth page in their place.
       */
      disallow: [
        "/dev/",
        "/app",
        "/auth/",
        "/signup",
        "/login",
        "/contact-sales",
        "/terms",
        "/privacy",
        "/security",
        "/platform-policies",
      ],
    },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
