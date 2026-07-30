import { resolveAppConfig } from "@/lib/env";
import { AuthMessage } from "./AuthMessage";

/**
 * Rendered when no database/auth is configured.
 *
 * The alternative — a form that looks functional and fails on submit — would
 * collect a password under false pretences. Naming the exact missing variables
 * turns a dead end into a two-minute fix, and no secret value is ever echoed,
 * only variable names.
 */
export function ConfigurationNotice() {
  const config = resolveAppConfig();
  if (config.status === "configured") return null;

  return (
    <AuthMessage
      tone="notice"
      title="CONFIGURATION REQUIRED"
      body="This deployment is not connected to a database yet, so accounts cannot be created or signed in to yet. The sign-in controls below are disabled until it is."
    >
      <dl className="mt-2 flex flex-col gap-3">
        {config.problems.map((problem: { variable: string; detail: string }) => (
          <div key={problem.variable} className="flex flex-col gap-1">
            <dt className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-warning)]">
              {problem.variable}
            </dt>
            <dd className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
              {problem.detail}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
        Add them to <code className="font-utility">.env.local</code> using{" "}
        <code className="font-utility">.env.example</code> as the template,
        then restart the dev server.
      </p>
    </AuthMessage>
  );
}
