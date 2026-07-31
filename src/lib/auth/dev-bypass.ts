/**
 * TEMPORARY: authentication is switched off while the product is still being
 * built out, so there is something to click through without a real account.
 *
 * Every request is treated as this one fixed dev user. `src/proxy.ts` skips
 * its redirect-to-sign-in check, and `readSession()` in `./session.ts`
 * returns this user as "authenticated" instead of reading a real session —
 * the rest of the stack (tenant bootstrap, workspace resolution, RLS-
 * replacement authorization checks) is untouched and keeps working exactly
 * as it would for a real signed-in user, because it only ever sees a
 * `SessionUser`.
 *
 * Kept import-free (no `db`, no Next APIs) so `src/proxy.ts` — which may run
 * on the Edge runtime — can read the flag without pulling in the Postgres
 * driver.
 *
 * To turn real authentication back on: set this to `false`.
 */
export const DEV_BYPASS_AUTH = true;

export const DEV_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "dev@virally.local",
  name: "Dev",
  image: null as string | null,
};
