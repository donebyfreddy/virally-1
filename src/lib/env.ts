/**
 * Environment configuration.
 *
 * Two rules drive the shape of this file:
 *
 * 1. `DATABASE_URL` and every auth secret are server-only. They must never be
 *    read into a `NEXT_PUBLIC_` variable and must never be logged — a leak of
 *    `DATABASE_URL` is a full database compromise (the pooled connection
 *    string carries the role's real password).
 * 2. Missing configuration produces a *described* failure naming the
 *    variable, never a stack trace about `undefined`. Secret values are
 *    never echoed.
 */

/** Reasons the app configuration can be unusable, in reportable form. */
export type ConfigProblem = {
  variable: string;
  detail: string;
};

export type AppConfig =
  | { status: "configured" }
  | { status: "unconfigured"; problems: readonly ConfigProblem[] };

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Whether the app can talk to the database and mint sessions at all.
 *
 * Marketing routes must keep working with no database attached (see
 * src/proxy.ts), so this is checked rather than assumed at every boundary
 * that needs it.
 */
export function resolveAppConfig(): AppConfig {
  const problems: ConfigProblem[] = [];

  if (!present(process.env.DATABASE_URL)) {
    problems.push({
      variable: "DATABASE_URL",
      detail: "Not set. Provision a Neon project and copy its pooled connection string.",
    });
  }

  if (!present(process.env.BETTER_AUTH_SECRET)) {
    problems.push({
      variable: "BETTER_AUTH_SECRET",
      detail: "Not set. Generate one with: openssl rand -base64 32",
    });
  }

  if (problems.length > 0) return { status: "unconfigured", problems };
  return { status: "configured" };
}

export function isAppConfigured(): boolean {
  return resolveAppConfig().status === "configured";
}

/**
 * Throws a configuration error naming the exact variables. Used by code paths
 * that cannot degrade.
 */
export function requireAppConfig(): void {
  const config = resolveAppConfig();
  if (config.status === "configured") return;
  throw new ConfigurationError(config.problems);
}

/** True when Google OAuth sign-in is configured. Email/password works regardless. */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    present(process.env.AUTH_GOOGLE_CLIENT_ID) && present(process.env.AUTH_GOOGLE_CLIENT_SECRET),
  );
}

export class ConfigurationError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    const lines = problems.map((p) => `  ${p.variable} — ${p.detail}`);
    super(
      [
        "The database/auth is not configured, so the Virally application cannot start.",
        ...lines,
        "Add these to .env.local (see .env.example). Never commit the file.",
      ].join("\n"),
    );
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

/**
 * Pure origin resolution. Both inputs are explicit.
 *
 * Split from the env-reading wrapper below because a default parameter cannot
 * express "not configured": passing `undefined` explicitly *triggers* the
 * default, so a single-function version would silently read the environment
 * even when a test intended to override it.
 */
export function resolveOrigin(
  configuredOrigin: string | undefined,
  requestOrigin: string | null | undefined,
): string {
  const configured = present(configuredOrigin);
  if (configured) return stripTrailingSlashes(configured);

  const fromRequest = present(requestOrigin ?? undefined);
  if (fromRequest) return stripTrailingSlashes(fromRequest);

  return "http://localhost:3000";
}

/**
 * The configured origin for this deployment, falling back to the request's.
 *
 * `NEXT_PUBLIC_SITE_URL` wins because OAuth providers require redirect URLs
 * to be allow-listed exactly, and a proxied host header is
 * attacker-influenced. The request origin is a development convenience only.
 */
export function resolveSiteOrigin(requestOrigin?: string | null): string {
  return resolveOrigin(process.env.NEXT_PUBLIC_SITE_URL, requestOrigin);
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
