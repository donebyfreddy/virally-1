import type { Metadata } from "next";
import { NotBuiltYet } from "@/components/app-shell/NotBuiltYet";

export const metadata: Metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};

const PLANNED = [
    "Members and roles across the eight-role permission model",
    "Invitations, once email delivery is configured",
    "Permissions enforced by row-level security, not by hidden buttons",
] as const;

export default function TeamPage() {
  return <NotBuiltYet label="Team" phase={10} planned={PLANNED} />;
}
