import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { palette } from "@/lib/accessibility/palette";
import { ogImage, site } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: "%s · Virally",
  },
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.title,
    description: site.description,
    url: site.url,
    locale: site.locale,
    images: [{ url: "/opengraph-image", ...ogImage }],
  },
  twitter: {
    card: "summary_large_image",
    site: site.twitter,
    title: site.title,
    description: site.description,
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: palette.canvas,
  colorScheme: "dark",
  // Zoom is never restricted — 200% must work.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      {/*
        MotionProvider is deliberately NOT here. Mounting it in the root layout
        pulls framer-motion onto every route, including the static placeholder
        pages that animate nothing. The marketing page opts in instead.
      */}
      <body>{children}</body>
    </html>
  );
}
