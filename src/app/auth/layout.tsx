import type { Metadata } from "next";
import { SkipLink } from "@/components/primitives/SkipLink";

export const metadata: Metadata = {
  // Auth pages must never be indexed: they are not landing pages, and an
  // indexed sign-in form competes with the marketing site for its own brand
  // queries.
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SkipLink />
      {children}
    </>
  );
}
