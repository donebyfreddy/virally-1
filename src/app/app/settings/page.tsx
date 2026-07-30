import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Workspace and brand configuration",
    "Notification preferences",
    "Profile and password management",
] as const;

export default function SettingsPage() {
  return <NotBuiltYet label="Settings" phase={10} planned={PLANNED} />;
}
