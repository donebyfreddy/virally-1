import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Views, reach, engagement, retention and follower growth over time",
    "Platform, account, format and hook comparisons",
    "Posting-time heatmap, content funnel and cost per published asset",
] as const;

export default function AnalyticsPage() {
  return <NotBuiltYet label="Analytics" phase={9} planned={PLANNED} />;
}
