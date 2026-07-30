import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Calendar",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Month, week, day, agenda, per-account and per-platform views",
    "Drag to reschedule, with a keyboard equivalent for every drag",
    "Batch publish plans with an explicit confirmation step",
] as const;

export default function CalendarPage() {
  return <NotBuiltYet label="Calendar" phase={8} planned={PLANNED} />;
}
