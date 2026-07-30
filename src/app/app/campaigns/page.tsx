import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Campaigns",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "The ten-stage pipeline from brief to learning, with blocked stages explained",
    "A concept x hook x format x platform x language matrix, virtualised",
    "Bulk approve, regenerate, schedule and export",
] as const;

export default function CampaignsPage() {
  return <NotBuiltYet label="Campaigns" phase={5} planned={PLANNED} />;
}
