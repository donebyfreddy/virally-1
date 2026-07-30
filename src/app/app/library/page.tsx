import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Library",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Source and generated media in private storage buckets",
    "Signed URLs only, never permanent public links",
    "Filter by type, campaign, brand and date, with full generation lineage",
] as const;

export default function LibraryPage() {
  return <NotBuiltYet label="Library" phase={6} planned={PLANNED} />;
}
