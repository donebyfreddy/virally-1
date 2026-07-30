import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccountSlotStatus } from "@/types/database";
import {
  DEFAULT_ACCOUNT_SLOT_LIMIT,
  SLOT_LIMIT_SQLSTATE,
  buildSlotGrid,
  capacityNotice,
  isPublishable,
  isSlotLimitError,
  nextFreeSlotNumbers,
  slotPresentation,
  slotStatusLabel,
  slotsNeedingAttention,
  usageSummary,
  type OccupiedSlot,
  type SlotUsage,
  type SlotViewStatus,
} from "./slots";

const MIGRATION_PATH = "supabase/migrations/0015_account_slots.sql";

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function occupied(slotNumber: number, status: AccountSlotStatus = "connected"): OccupiedSlot {
  return {
    kind: "occupied",
    id: `slot-${slotNumber}`,
    slotNumber,
    platform: "instagram",
    status,
    displayLabel: null,
    brandName: null,
    launchKitId: null,
    account: null,
  };
}

const FULL_USAGE: SlotUsage = {
  slotLimit: 10,
  activeSlots: 10,
  connectedSlots: 4,
  archivedSlots: 1,
  availableSlots: 0,
};

/**
 * The database is the authority on both the default limit and the state list. These
 * assertions exist because the alternative — two hand-maintained copies of the same
 * rule — has already gone wrong once in this repo for the permission matrix, which
 * is why 0001 has the same kind of test.
 */
describe("parity with the migration", () => {
  it("uses the same default slot limit as app.workspace_account_slot_limit", () => {
    const sql = migrationSql();
    // The three-level coalesce ends in the hardcoded floor; that literal is the
    // documented product default and must equal the TypeScript constant.
    const fallback = sql.match(
      /coalesce\(\s*wl\.account_slot_limit,\s*pl\.account_slot_limit,\s*(\d+)\s*\)/,
    );
    expect(fallback, "could not find the coalesce fallback in 0015").not.toBeNull();
    expect(Number(fallback?.[1])).toBe(DEFAULT_ACCOUNT_SLOT_LIMIT);
  });

  it("seeds a plan whose slot allowance matches the documented default", () => {
    // §14 of the spec: the default limit can be set to 10. `free` is the plan a
    // workspace lands on before billing exists, so it is the one that decides what
    // a new user actually gets.
    const sql = migrationSql();
    const row = sql.match(/\('free',\s*(\d+),/);
    expect(row, "no 'free' row in app.plan_limits").not.toBeNull();
    expect(Number(row?.[1])).toBe(DEFAULT_ACCOUNT_SLOT_LIMIT);
  });

  it("presents every status the database enum can hold, and nothing it cannot", () => {
    const sql = migrationSql();
    const block = sql.match(/create type app\.account_slot_status as enum \(([\s\S]*?)\);/);
    expect(block, "could not find the account_slot_status enum").not.toBeNull();

    const dbStatuses = [...(block?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(dbStatuses.length).toBeGreaterThan(0);

    // Every persistable state has presentation, or the UI renders `undefined`.
    for (const status of dbStatuses) {
      expect(
        slotPresentation(status as SlotViewStatus),
        `no presentation for database status "${status}"`,
      ).toBeDefined();
      expect(slotStatusLabel(status as SlotViewStatus)).not.toBe("");
    }

    // And the reverse: the only extra state the UI may add is `empty`, which by
    // design has no row and therefore no enum member.
    expect(dbStatuses).not.toContain("empty");
  });

  it("branches on the sqlstate the limit trigger actually raises", () => {
    expect(migrationSql()).toContain(`errcode = '${SLOT_LIMIT_SQLSTATE}'`);
  });
});

describe("nextFreeSlotNumbers", () => {
  it("starts at one", () => {
    expect(nextFreeSlotNumbers([], 3)).toEqual([1, 2, 3]);
  });

  it("fills genuine gaps left by numbers that were never allocated", () => {
    expect(nextFreeSlotNumbers([1, 2, 4], 2)).toEqual([3, 5]);
  });

  it("does not reuse an archived slot's number", () => {
    // Slot 5 archived: it stays in `used`, so the next allocation is 11, not 5.
    // "Slot 5" in a screenshot has to keep meaning the account it meant.
    const used = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nextFreeSlotNumbers(used, 1)).toEqual([11]);
  });

  it("returns nothing when no capacity is requested", () => {
    expect(nextFreeSlotNumbers([1, 2], 0)).toEqual([]);
    expect(nextFreeSlotNumbers([1, 2], -1)).toEqual([]);
  });
});

describe("buildSlotGrid", () => {
  it("pads to the limit with empty tiles", () => {
    const slots = [1, 2, 3, 4, 5, 6, 7].map((n) => occupied(n));
    const grid = buildSlotGrid(slots, [1, 2, 3, 4, 5, 6, 7], 10);

    expect(grid).toHaveLength(10);
    expect(grid.filter((s) => s.kind === "empty")).toHaveLength(3);
    // Matches what claim_account_slot would hand out, in order.
    expect(grid.filter((s) => s.kind === "empty").map((s) => s.previewNumber)).toEqual([8, 9, 10]);
  });

  it("shows no empty tile for an archived slot's gap when capacity is full", () => {
    // Slot 5 archived; 1-4 and 6-11 active. Ten active against a limit of ten means
    // no capacity, so rendering an empty tile at position 5 would offer the user
    // something the database would refuse.
    const active = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11].map((n) => occupied(n));
    const grid = buildSlotGrid(active, [...Array(11)].map((_, i) => i + 1), 10);

    expect(grid).toHaveLength(10);
    expect(grid.every((s) => s.kind === "occupied")).toBe(true);
    expect(grid.map((s) => (s.kind === "occupied" ? s.slotNumber : null))).not.toContain(5);
  });

  it("never hides an occupied slot when the limit is lowered below occupancy", () => {
    // A downgrade must not make slots disappear from the screen: the product answer
    // is "archive or upgrade", and the user cannot archive what is not rendered.
    const active = [1, 2, 3, 4, 5].map((n) => occupied(n));
    const grid = buildSlotGrid(active, [1, 2, 3, 4, 5], 2);

    expect(grid).toHaveLength(5);
    expect(grid.every((s) => s.kind === "occupied")).toBe(true);
  });

  it("orders occupied slots by slot number regardless of input order", () => {
    const grid = buildSlotGrid([occupied(3), occupied(1), occupied(2)], [1, 2, 3], 3);
    expect(grid.map((s) => (s.kind === "occupied" ? s.slotNumber : 0))).toEqual([1, 2, 3]);
  });

  it("renders a full grid of empties for an untouched workspace", () => {
    const grid = buildSlotGrid([], [], DEFAULT_ACCOUNT_SLOT_LIMIT);
    expect(grid).toHaveLength(10);
    expect(grid.every((s) => s.kind === "empty")).toBe(true);
  });
});

describe("state semantics", () => {
  it("treats only `connected` as publishable", () => {
    expect(isPublishable("connected")).toBe(true);
    // Has a live authorisation but not the scopes. Scheduling to it produces a
    // batch that fails at the final step, which is the failure this prevents.
    expect(isPublishable("limited_permissions")).toBe(false);
    expect(isPublishable("reconnection_required")).toBe(false);
    expect(isPublishable("launch_kit_ready")).toBe(false);
    expect(isPublishable("empty")).toBe(false);
  });

  it("does not claim a live authorisation for a slot that has none", () => {
    // The compliance-critical half: no pre-connection state may imply an account
    // exists on the platform.
    for (const status of [
      "planning",
      "launch_kit_ready",
      "awaiting_manual_creation",
      "awaiting_connection",
      "disconnected",
      "empty",
    ] as const) {
      expect(slotPresentation(status).hasLiveAuthorisation, status).toBe(false);
    }
  });

  it("never labels a prepared slot as a created account", () => {
    for (const status of ["planning", "launch_kit_ready", "awaiting_manual_creation"] as const) {
      const label = slotStatusLabel(status).toLowerCase();
      expect(label).not.toContain("created");
      expect(label).not.toContain("account ready");
    }
  });

  it("tells the user what to do for every state that needs them, and stays quiet otherwise", () => {
    expect(slotPresentation("launch_kit_ready").requiredAction).toContain("Register the account");
    // Nothing is required of the user mid-handshake or when it simply works.
    expect(slotPresentation("connecting").requiredAction).toBeNull();
    expect(slotPresentation("connected").requiredAction).toBeNull();
    expect(slotPresentation("archived").requiredAction).toBeNull();
  });

  it("colours teal only where the machine is working or the connection is live", () => {
    // The two-accent taxonomy in tokens.css: signal means the machine is doing
    // something, not "this row is nice".
    expect(slotPresentation("connecting").tone).toBe("signal");
    expect(slotPresentation("connected").tone).toBe("signal");
    expect(slotPresentation("planning").tone).toBe("neutral");
    expect(slotPresentation("reconnection_required").tone).toBe("warning");
    // Amber means a human must act.
    expect(slotPresentation("launch_kit_ready").tone).toBe("action");
  });

  it("lists the slots needing attention and ignores empty tiles", () => {
    const grid = buildSlotGrid(
      [occupied(1, "connected"), occupied(2, "reconnection_required"), occupied(3, "launch_kit_ready")],
      [1, 2, 3],
      5,
    );
    const needing = slotsNeedingAttention(grid);
    expect(needing.map((s) => s.slotNumber)).toEqual([2, 3]);
  });
});

describe("capacity messaging", () => {
  it("says nothing while capacity remains", () => {
    expect(capacityNotice({ ...FULL_USAGE, activeSlots: 7, availableSlots: 3 })).toBeNull();
  });

  it("names both remedies when full, not just the paid one", () => {
    const notice = capacityNotice(FULL_USAGE) ?? "";
    expect(notice).toContain("all 10 account slots");
    expect(notice).toContain("Archive");
    expect(notice.toLowerCase()).toContain("limit");
  });

  it("agrees in number for a one-slot workspace", () => {
    const notice = capacityNotice({ ...FULL_USAGE, slotLimit: 1, activeSlots: 1 }) ?? "";
    expect(notice).toContain("all 1 account slot.");
  });

  it("summarises usage as occupied-of-limit", () => {
    expect(usageSummary({ ...FULL_USAGE, activeSlots: 7, availableSlots: 3 })).toBe(
      "7 of 10 slots active",
    );
  });
});

describe("isSlotLimitError", () => {
  it("recognises the capacity code and nothing else", () => {
    expect(isSlotLimitError({ code: SLOT_LIMIT_SQLSTATE })).toBe(true);
    // A permission denial is a different remedy and must not be reported as a
    // capacity problem.
    expect(isSlotLimitError({ code: "42501" })).toBe(false);
    expect(isSlotLimitError({ code: null })).toBe(false);
    expect(isSlotLimitError(null)).toBe(false);
    expect(isSlotLimitError(undefined)).toBe(false);
  });
});
