/**
 * Settings copy.
 *
 * This page is read-only, and that is stated rather than disguised.
 *
 * There is no settings server action anywhere in the repo — `grep -rl "use
 * server"` returns tenant, auth, content, accounts and onboarding, and none of
 * them writes a workspace, brand or notification preference. So every value here
 * is rendered as a stated fact rather than as a field, because an input that
 * discarded what you typed on submit would be the worst possible version of this
 * screen. Each group names the dependency that gates its write path instead.
 */

export const settingsCopy = {
  title: "Settings",
  body: "Every value here is read from the database or the running environment. Nothing on this page writes yet: each group needs its own validated, audited server action, and a field that silently discarded your input would be worse than a stated value.",

  readOnlyTitle: "This page does not write yet",
  readOnlyBody:
    "No settings server action exists, so these groups report state rather than offering fields. Switching the active workspace or brand still works from the switcher in the top bar, which is the one preference that has a write path today.",

  profileHeading: "Profile",
  profileHint: "Your identity, from the account you signed in with.",
  nameLabel: "Name",
  emailLabel: "Email",
  roleLabel: "Role in this workspace",

  preferencesHeading: "Preferences",
  preferencesHint: "Stored on your profile and used to format dates and choose a default language.",
  localeLabel: "Locale",
  timezoneLabel: "Timezone",
  preferencesGate: "Needs a profile write path",

  organisationHeading: "Organisation",
  organisationHint: "The billing and ownership boundary. Cross-organisation access is denied outright.",
  organisationLabel: "Organisation",
  workspaceLabel: "Active workspace",
  workspaceCountLabel: "Workspaces you can reach",

  brandHeading: "Brand",
  brandHint: "The voice, language and visual identity that generation reads from.",
  activeBrandLabel: "Active brand",
  brandLanguageLabel: "Primary language",
  brandCountLabel: "Brands in this workspace",
  noBrand:
    "No brand is selected for this workspace. A brand carries the voice, language and visual identity that generation reads from.",

  generationHeading: "Generation",
  generationHint: "Whether output is produced by a real provider or by the deterministic mock.",
  providerLabel: "Language provider",
  providerMockValue: "Mock — no key configured",
  providerConfiguredValue: "Configured",
  providerMock:
    "No language-provider key is configured, so generation runs on a deterministic mock and every output is labelled Demo. Counts, scheduling and publishing state are all real regardless.",
  providerConfigured:
    "A language provider is configured. Generated output is real and is charged against your Production Credits.",

  notificationsHeading: "Notifications",
  notificationsHint:
    "Read from your profile's stored preferences. The in-app count in the top bar is already real and reads unread rows directly.",
  notificationsGate:
    "Changing these, and emailing any of them, needs RESEND_API_KEY configured and a profile write path. Until both exist the stored values are shown as they are.",
  notificationsEmpty:
    "Your profile carries no notification preferences yet. The defaults in the schema apply until a preference is written.",
  notificationOn: "On",
  notificationOff: "Off",

  /** Known preference keys, in the order the schema's default lists them. */
  notificationLabels: {
    job_failed: "A generation run fails",
    approval_required: "Something needs my approval",
    publish_failed: "A publish fails",
    usage_warning: "Credits are running low",
    weekly_digest: "Weekly digest",
  } as Readonly<Record<string, string>>,

  pendingHeading: "The rest of settings",
  pendingHint:
    "These groups are part of the settings surface but are not editable yet. Each names the dependency that gates it rather than a date, because the dependency is the useful information.",
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
    holds:
      "Default production mode, quality, duration and whether voiceover is on by default for new campaigns.",
    gate: "Needs a workspace-preferences write path",
  },
  {
    id: "integrations",
    label: "Social integrations",
    holds:
      "Per-platform app credentials and the OAuth authorisation state for each connected account.",
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
