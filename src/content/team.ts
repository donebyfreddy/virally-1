/**
 * Team copy.
 *
 * No role, permission or member count is written here. Roles and their
 * permissions are rendered from `lib/permissions`, which `permissions.test.ts`
 * asserts against the migration's own SQL — so this page cannot describe a
 * permission model the server does not enforce.
 */
export const teamCopy = {
  title: "Team",
  body: "Members belong to the organisation and carry one role. A role is a fixed set of permissions, and the table further down is generated from the permission table the server enforces rather than from a description of it.",

  kpis: {
    members: "Members",
    active: "Active",
    pending: "Invitations pending",
  },

  inviteLabel: "Invite member",

  membersHeading: "Members",
  membersHint: "Everyone with a membership row in this organisation, active or invited.",
  tableCaption: "Members of this organisation, active members first",

  statusActive: "Active",
  statusPending: "Invitation pending",
  /** Shown against a row whose invitation has not been accepted. */
  pendingHint: (count: number) =>
    count === 1
      ? "1 invitation has not been accepted yet. Until it is, that person has a role but no access."
      : `${count} invitations have not been accepted yet. Until they are, those people have a role but no access.`,

  unnamedMember: "Unnamed member",
  youLabel: "You",

  rolesHeading: "Roles and permissions",
  rolesHint:
    "Every route re-checks these permissions server-side. Hiding a navigation item is presentation; the check is what enforces access.",
  rolesCaption: "Roles and the permissions each one holds",

  empty: {
    title: "No members yet",
    body: "You are the only person in this organisation, and inviting a member sends them an email with a link to join.",
  },

  /**
   * Invitation is gated on the transactional email path.
   *
   * Stated rather than hidden, because inviting is a genuine capability of this
   * role — the control belongs on the page, disabled and explained, so an admin
   * knows the feature exists and why it is not available.
   */
  inviteUnavailable:
    "Inviting a member sends a transactional email, which needs RESEND_API_KEY configured. Without it an invitation would be created that nobody ever receives, so the action is disabled rather than silently failing.",

  /**
   * Role changes and removals have no write path yet.
   *
   * Named for the dependency rather than a date: both are audited, organisation
   * -scoped writes, and `audit_logs` already reserves "who changed a role" as
   * one of the actions it records. Until that action exists, the table shows
   * state and no row offers a control that would fail.
   */
  managementUnavailable:
    "Changing a member's role or removing them from the organisation needs an audited server action, which does not exist yet. Rather than offer a control that cannot complete, this table reports state only.",
} as const;
