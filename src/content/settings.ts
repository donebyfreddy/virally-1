/**
 * Settings copy.
 *
 * This page is read-only, and that is stated rather than disguised. Each group
 * below names what it will hold and what gates it, so the page is a complete map
 * of the settings surface instead of only the parts that happen to be finished.
 */

export const settingsCopy = {
  eyebrow: "SETTINGS",
  title: "How this workspace is configured.",
  body: "Every value here is read from the database or the running environment. Nothing on this page writes yet — each group's write path needs its own validation and audit entry, and a field that discarded your input on submit would be worse than a stated value.",

  noBrand:
    "No brand is selected for this workspace. A brand carries the voice, language and visual identity that generation reads from.",

  providerMock:
    "No language-provider key is configured, so generation runs on a deterministic mock and every output is labelled Demo. The plan, counts, scheduling and publishing state are all real regardless.",
  providerConfigured:
    "A language provider is configured. Generated output is real and is charged against your Production Credits.",

  pendingHeading: "The rest of settings",
  pendingHint:
    "These groups are part of the settings surface but are not editable yet. Each names the dependency that gates it rather than a date, because the dependency is the useful information.",

  notifications:
    "Notification preferences — which events email you, which only appear in the bell — are stored per user. The delivery path needs RESEND_API_KEY configured; the in-app count in the top bar is already real and reads unread rows directly.",
} as const;

export const SETTINGS_GROUPS: readonly {
  id: string;
  label: string;
  holds: string;
  gate: string;
}[] = [
  {
    id: "generation-preferences",
    label: "Generation preferences",
    holds: "Default production mode, quality, duration and whether voiceover is on by default for new campaigns.",
    gate: "Needs a workspace-preferences write path",
  },
  {
    id: "integrations",
    label: "Social integrations",
    holds: "Per-platform app credentials and the OAuth authorisation state for each connected account.",
    gate: "Managed from Accounts today",
  },
  {
    id: "security",
    label: "Security",
    holds: "Active sessions, password change, and two-factor enrolment.",
    gate: "Needs Better Auth session management UI",
  },
  {
    id: "billing",
    label: "Billing",
    holds: "Plan, payment method, invoices and Production Credit top-ups.",
    gate: "Needs a billing provider",
  },
  {
    id: "api",
    label: "API",
    holds: "Workspace API keys and webhook endpoints for your own automation.",
    gate: "Needs a public API surface",
  },
  {
    id: "audit",
    label: "Audit logs",
    holds: "Who changed what and when, across the organisation.",
    gate: "Rows are being written; the viewer is not built",
  },
];
