import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Usage",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Credits, videos, images, voice minutes, render minutes and storage",
    "Derived from the append-only usage ledger, not a mutable counter",
    "Estimated provider cost for the current period",
] as const;

export default function UsagePage() {
  return <NotBuiltYet label="Usage" phase={10} planned={PLANNED} />;
}
