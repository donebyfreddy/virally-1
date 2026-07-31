/**
 * Tenant scope for every creative-generation query.
 *
 * This database has no row-level security — it was dropped when the app moved
 * off Supabase, and isolation moved into application code (see the
 * schema.fragment.ts header). That makes the scope argument the ONLY thing
 * standing between two customers' data, so it is a required parameter on every
 * persistence function rather than an ambient value.
 *
 * Deliberately not read from a module-level context or an async-local store. A
 * scope that can be forgotten is a scope that will be, and the failure mode is
 * silent: the query returns another tenant's rows and looks like it worked.
 */

export type TenantScope = {
  organizationId: string;
  workspaceId: string;
};

/**
 * Rejects a malformed scope before it reaches a query.
 *
 * The specific danger is an empty string. Postgres compares `workspace_id = ''`
 * as a normal predicate against a uuid column and errors, but a scope built
 * from an unauthenticated session can carry `undefined` that TypeScript's
 * `string` type does not catch at a boundary — a JSON body, a form field, a
 * cache read. This turns that into a loud failure at the edge of the module.
 */
export function assertScope(scope: TenantScope): void {
  if (!isNonEmpty(scope?.organizationId) || !isNonEmpty(scope?.workspaceId)) {
    throw new Error(
      "A creative-generation query was attempted without a complete tenant scope. Both organizationId and workspaceId are required — this database has no RLS, so an unscoped query reads across tenants.",
    );
  }
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Builds a scope, validating it. Use at the boundary where a session resolves. */
export function tenantScope(organizationId: string, workspaceId: string): TenantScope {
  const scope = { organizationId, workspaceId };
  assertScope(scope);
  return scope;
}
