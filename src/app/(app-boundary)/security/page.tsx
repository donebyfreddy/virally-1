import type { Metadata } from "next";
import { PlaceholderRoute } from "../PlaceholderRoute";

export const metadata: Metadata = {
  title: "Security",
  robots: { index: false, follow: false },
};

/** Linked from the footer, which previously 404ed. */
export default function SecurityPage() {
  return (
    <PlaceholderRoute
      eyebrow="[SECURITY STATEMENT REQUIRED]"
      heading="The security statement is not published yet."
      body="This route exists so the footer link never 404s. Publish it once the threat model, token encryption and tenant isolation controls have been implemented and reviewed — claiming controls that are not yet built would be the worst possible content for this page."
    />
  );
}
