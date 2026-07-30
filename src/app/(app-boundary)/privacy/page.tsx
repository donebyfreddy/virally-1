import type { Metadata } from "next";
import { PlaceholderRoute } from "../PlaceholderRoute";

export const metadata: Metadata = {
  title: "Privacy",
  robots: { index: false, follow: false },
};

/**
 * As with `/terms`: the route must exist because the footer and sign-up screen
 * link to it, but a drafted privacy policy would be a false statement about what
 * data is collected and how it is handled — a compliance liability, not a
 * placeholder.
 */
export default function PrivacyPage() {
  return (
    <PlaceholderRoute
      eyebrow="[LEGAL COPY REQUIRED]"
      heading="The privacy policy is not published yet."
      body="This route exists so the links that point at it never 404. A real policy must describe the Neon-hosted data, the social platform tokens held on a user's behalf, and the AI providers content is sent to — none of which can be accurately written until those integrations are configured."
    />
  );
}
