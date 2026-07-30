import type { Metadata } from "next";
import { PlaceholderRoute } from "../PlaceholderRoute";

export const metadata: Metadata = {
  title: "Platform policies",
  robots: { index: false, follow: false },
};

/** Linked from the footer, which previously 404ed. */
export default function PlatformPoliciesPage() {
  return (
    <PlaceholderRoute
      eyebrow="[PLATFORM POLICY SUMMARY REQUIRED]"
      heading="The platform policy summary is not published yet."
      body="This route exists so the footer link never 404s. It should state plainly what Virally does and does not do with connected accounts: publishing only to accounts a user has authorised through official flows, and never creating accounts, manufacturing engagement or circumventing platform limits."
    />
  );
}
