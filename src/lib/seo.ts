/**
 * Canonical site metadata.
 *
 * Claims here are deliberately capability statements, not outcome promises.
 * Nothing in this file may assert guaranteed virality, reach multiples, growth
 * or category leadership.
 */
function resolveSiteUrl(raw: string | undefined): string {
  if (!raw) return "https://virally.example";
  try {
    return new URL(raw).toString();
  } catch {
    return "https://virally.example";
  }
}

export const site = {
  name: "Virally",
  url: resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL),
  title: "Virally — Turn one idea into content for every channel",
  description:
    "Create, adapt, schedule and improve multi-platform content campaigns from one brief.",
  locale: "en_US",
  twitter: "@virally",
} as const;

export const ogImage = {
  // [SOCIAL PREVIEW IMAGE REQUIRED] — generated at /opengraph-image.
  width: 1200,
  height: 630,
  alt: "Virally — one idea, every format, every channel.",
} as const;

/**
 * SoftwareApplication structured data. Deliberately omits `aggregateRating`
 * and `offers`: both would require real ratings and real prices, and marking
 * up invented ones is a search-policy violation as well as a lie.
 */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: site.url,
    description: site.description,
    featureList: [
      "Campaign strategy from a single brief",
      "Script, image, video and voiceover generation",
      "Format recomposition for 9:16, 4:5, 1:1, 16:9 and 4:3",
      "Publishing to authorised social accounts via official OAuth flows",
      "Scheduling and approval workflows",
      "Performance analysis and creative experimentation",
    ],
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: site.url,
    description: site.description,
  };
}
