import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemberRole, Permission } from "@/types/database";
import {
  ALL_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  can,
  canAll,
  canAny,
  effectiveRole,
  permissionsFor,
} from "./index";

/**
 * The drift test.
 *
 * The TypeScript matrix and `app.role_permissions` in the migration are two copies
 * of one rule, and two copies eventually disagree. This parses the migration's SQL
 * and asserts they match exactly — so adding a permission in SQL without updating
 * the UI (or the reverse) fails here rather than showing a user a button that 403s.
 */
const MIGRATION_PATH = "supabase/migrations/0001_foundation.sql";

function parseSqlMatrix(): Map<MemberRole, Set<Permission>> {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const matrix = new Map<MemberRole, Set<Permission>>();

  // Owner and admin are seeded by a cross join against every enum value, so they
  // are expected to hold the complete set rather than an explicit list.
  const allPermissions = extractEnumValues(sql, "app.permission") as Permission[];
  for (const role of ["owner", "admin"] as MemberRole[]) {
    matrix.set(role, new Set(allPermissions));
  }

  // The explicit `('role', 'permission'),` tuples for the remaining roles.
  const tuplePattern = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_.]+)'\s*\)/g;
  for (const match of sql.matchAll(tuplePattern)) {
    const role = match[1] as MemberRole;
    const raw = match[2] ?? "";
    // Skip the ('owner','all') / ('admin','all') marker rows before narrowing —
    // 'all' is not a member of the Permission union, so comparing after the cast
    // is a type error.
    if (raw === "all") continue;
    const permission = raw as Permission;
    if (!allPermissions.includes(permission)) continue;
    if (!matrix.has(role)) matrix.set(role, new Set());
    matrix.get(role)?.add(permission);
  }

  return matrix;
}

function extractEnumValues(sql: string, typeName: string): string[] {
  const bare = typeName.split(".").pop();
  const pattern = new RegExp(
    `create type app\\.${bare}\\s+as enum\\s*\\(([^)]*)\\)`,
    "i",
  );
  const body = sql.match(pattern)?.[1] ?? "";
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "");
}

describe("role matrix matches the database", () => {
  const sqlMatrix = parseSqlMatrix();

  it("parses a non-trivial matrix from the migration", () => {
    // Guards the parser itself: if the regexes silently match nothing, every
    // comparison below would pass vacuously.
    expect(sqlMatrix.size).toBeGreaterThanOrEqual(8);
    expect(sqlMatrix.get("owner")?.size).toBeGreaterThan(10);
    expect(sqlMatrix.get("editor")?.size).toBeGreaterThan(0);
  });

  it("defines every role the database enum defines", () => {
    expect([...ALL_ROLES].sort()).toEqual([...sqlMatrix.keys()].sort());
  });

  for (const role of [
    "owner",
    "admin",
    "strategist",
    "editor",
    "reviewer",
    "publisher",
    "analyst",
    "viewer",
  ] as MemberRole[]) {
    it(`grants ${role} exactly what the migration grants`, () => {
      const fromSql = [...(sqlMatrix.get(role) ?? [])].sort();
      const fromTs = [...permissionsFor(role)].sort();
      expect(fromTs).toEqual(fromSql);
    });
  }
});

describe("separation of duties", () => {
  // These are the separations the product's approval workflow depends on. If any
  // one of them collapses, "approval" stops meaning anything.
  it("an editor cannot approve or publish", () => {
    expect(can("editor", "content.create")).toBe(true);
    expect(can("editor", "content.approve")).toBe(false);
    expect(can("editor", "content.publish")).toBe(false);
  });

  it("a reviewer cannot create or publish", () => {
    expect(can("reviewer", "content.approve")).toBe(true);
    expect(can("reviewer", "content.create")).toBe(false);
    expect(can("reviewer", "content.publish")).toBe(false);
  });

  it("a publisher cannot approve", () => {
    expect(can("publisher", "content.publish")).toBe(true);
    expect(can("publisher", "content.approve")).toBe(false);
  });

  it("only owner and admin see billing", () => {
    const withBilling = ALL_ROLES.filter((r) => can(r, "billing.view"));
    expect(withBilling.sort()).toEqual(["admin", "owner"]);
  });

  it("only owner and admin manage the team", () => {
    const withTeam = ALL_ROLES.filter((r) => can(r, "team.manage"));
    expect(withTeam.sort()).toEqual(["admin", "owner"]);
  });

  it("no role below strategist can connect accounts", () => {
    for (const role of ["editor", "reviewer", "publisher", "analyst", "viewer"] as MemberRole[]) {
      expect(can(role, "accounts.connect")).toBe(false);
    }
  });

  it("every role can at least read analytics", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "analytics.view")).toBe(true);
    }
  });
});

describe("can / canAll / canAny", () => {
  it("returns false for a null or undefined role rather than throwing", () => {
    // Happens on first render before the tenant context resolves. Failing closed
    // means a control is briefly hidden, not briefly offered.
    expect(can(null, "content.create")).toBe(false);
    expect(can(undefined, "content.create")).toBe(false);
    expect(canAll(null, ["content.create"])).toBe(false);
    expect(canAny(null, ["content.create"])).toBe(false);
  });

  it("canAll requires every permission", () => {
    expect(canAll("owner", ["content.create", "content.publish"])).toBe(true);
    expect(canAll("editor", ["content.create", "content.publish"])).toBe(false);
  });

  it("canAny requires only one", () => {
    expect(canAny("editor", ["content.publish", "content.create"])).toBe(true);
    expect(canAny("viewer", ["content.publish", "content.create"])).toBe(false);
  });

  it("canAll on an empty list is vacuously true", () => {
    expect(canAll("viewer", [])).toBe(true);
  });
});

describe("effectiveRole", () => {
  it("prefers the workspace override", () => {
    expect(effectiveRole("viewer", "editor")).toBe("editor");
  });

  it("falls back to the organisation role", () => {
    expect(effectiveRole("editor", null)).toBe("editor");
  });

  it("is null when the user belongs to neither", () => {
    expect(effectiveRole(null, null)).toBeNull();
  });
});

describe("presentation metadata is complete", () => {
  // A role with no label renders as a raw enum value; one with no description
  // makes the invite form a guessing game.
  it("labels every role", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("describes every role", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_DESCRIPTIONS[role]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("orders every role exactly once", () => {
    expect([...ROLE_ORDER].sort()).toEqual([...ALL_ROLES].sort());
    expect(new Set(ROLE_ORDER).size).toBe(ROLE_ORDER.length);
  });
});
