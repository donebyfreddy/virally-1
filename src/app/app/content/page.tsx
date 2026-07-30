import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Content",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Every content item and its per-platform variants",
    "Open an item in the studio: timeline, script, captions and format adaptation",
    "Debounced autosave that reports Saving, Saved or Save failed honestly",
] as const;

export default function ContentPage() {
  return <NotBuiltYet label="Content" phase={6} planned={PLANNED} />;
}
