/**
 * Client-side password feedback.
 *
 * This is guidance, not enforcement. Supabase is the authority on what it will
 * accept, and the server rejection is always surfaced. Validating here only
 * saves a round-trip and gives the user something useful to read while typing.
 */

/** Matches Supabase's default minimum. Raise it here if the project raises it. */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordAssessment = {
  /** Whether the local rules are satisfied. Supabase may still refuse it. */
  acceptable: boolean;
  /** Ordered requirements, each with its current state, rendered as a checklist. */
  requirements: readonly { label: string; met: boolean }[];
  /** Coarse strength band, used for a non-colour-only indicator. */
  strength: "empty" | "weak" | "fair" | "strong";
};

/**
 * The 20 most-abused passwords cannot be caught client-side in any meaningful
 * way, so this checks structure only. Breach-list checking belongs on the
 * server, where it can be done without shipping a wordlist to the browser.
 */
export function assessPassword(password: string): PasswordAssessment {
  const requirements = [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    { label: "A lowercase and an uppercase letter", met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: "A number or symbol", met: /[^A-Za-z]/.test(password) },
  ] as const;

  if (password.length === 0) {
    return { acceptable: false, requirements, strength: "empty" };
  }

  const met = requirements.filter((r) => r.met).length;

  // Only length is mandatory locally — the other two are advisory, so a long
  // passphrase of plain words is not blocked. Blocking it would push users
  // towards shorter, more predictable passwords.
  const acceptable = password.length >= PASSWORD_MIN_LENGTH;

  const strength =
    met === 3 && password.length >= 12
      ? "strong"
      : acceptable
        ? "fair"
        : "weak";

  return { acceptable, requirements, strength };
}

/** Shape check only — deliverability is not knowable client-side. */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}
