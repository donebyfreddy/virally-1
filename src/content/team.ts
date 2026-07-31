/**
 * Team copy.
 */
export const teamCopy = {
  eyebrow: "TEAM",
  title: "Who can do what.",
  body: "Members belong to the organisation and carry one role. A role is a fixed set of permissions — the list below is generated from the permission table the server actually enforces, not a description of it.",

  inviteLabel: "Invite member",
  rolesHeading: "Roles and permissions",
  rolesHint:
    "Every route re-checks these permissions server-side. Hiding a navigation item is presentation; the check is what enforces access.",

  empty: {
    title: "No members yet.",
    body: "You are the only person in this organisation. Inviting a member sends them an email with a link to join.",
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
} as const;
