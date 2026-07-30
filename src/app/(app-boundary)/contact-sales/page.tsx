import type { Metadata } from "next";
import { PlaceholderRoute } from "../PlaceholderRoute";

export const metadata: Metadata = {
  title: "Talk to sales",
  robots: { index: false, follow: false },
};

export default function ContactSalesPage() {
  return (
    <PlaceholderRoute
      eyebrow="[SALES CONTACT ROUTE REQUIRED]"
      heading="The sales contact route is not connected yet."
      body="This route exists so the Network-tier call to action never lands on a missing page. Wire it to the real enquiry destination — a form, a scheduler or a mailbox — before launch."
    />
  );
}
