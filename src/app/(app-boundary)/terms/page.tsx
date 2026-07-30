import type { Metadata } from "next";
import { PlaceholderRoute } from "../PlaceholderRoute";

export const metadata: Metadata = {
  title: "Terms",
  robots: { index: false, follow: false },
};

/**
 * The footer and the sign-up screen both link here, so the route must exist —
 * previously both produced a 404.
 *
 * It renders a stated gap rather than drafted terms. Inventing contract text a
 * user is asked to agree to would be worse than an obviously missing page: it
 * would be unenforceable, misleading, and would hide the fact that real terms
 * are still required before launch.
 */
export default function TermsPage() {
  return (
    <PlaceholderRoute
      eyebrow="[LEGAL COPY REQUIRED]"
      heading="The terms of service are not published yet."
      body="This route exists so the links that point at it never 404. Replace it with terms reviewed by counsel before accepting real sign-ups — the sign-up form links here as the agreement a user is accepting."
    />
  );
}
