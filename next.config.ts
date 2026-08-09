import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // @remotion/renderer requires() platform-specific compositor binaries at
  // runtime (one per OS/arch); keeping it external stops Next.js from trying
  // to statically bundle every variant during the build.
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler"],
  experimental: {
    // Rewrites barrel imports to deep paths so a single icon does not pull the
    // whole library into the graph.
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },

  /**
   * `/signup` and `/login` were the marketing build's placeholder CTA targets.
   * They are now owned by the product application at `/auth/*`. Permanent
   * redirects rather than deletions: those paths may already exist in shared
   * links, email footers and ad destinations.
   */
  async redirects() {
    return [
      { source: "/signup", destination: "/auth/sign-up", permanent: true },
      { source: "/login", destination: "/auth/sign-in", permanent: true },
      { source: "/sign-in", destination: "/auth/sign-in", permanent: true },
      { source: "/sign-up", destination: "/auth/sign-up", permanent: true },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
