import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Experiments",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Compare hooks, first frames, durations, captions, CTAs and posting times",
    "Honest confidence language: early signal, inconclusive, promising",
    "No significance claim without a correct method behind it",
] as const;

export default function ExperimentsPage() {
  return <NotBuiltYet label="Experiments" phase={10} planned={PLANNED} />;
}
