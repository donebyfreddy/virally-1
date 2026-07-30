import type { Metadata } from "next";
import { KitchenSink } from "./KitchenSink";

export const metadata: Metadata = {
  title: "Kitchen sink",
  robots: { index: false, follow: false },
};

/**
 * Development-only surface. Every primitive in every state, the palette with
 * live-computed contrast ratios, the type and spacing scales, easing demos,
 * and a reduced-motion simulator.
 *
 * Excluded from the production build by the guard below rather than by
 * convention, so it cannot ship by accident.
 */
export default function KitchenSinkPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <main className="p-16">
        <p className="font-utility">Not available in production builds.</p>
      </main>
    );
  }
  return <KitchenSink />;
}
