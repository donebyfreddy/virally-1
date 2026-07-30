/**
 * ACCOUNT SLOTS — presentation and allocation logic.
 *
 * A slot is licensed capacity, not a social account. Every label in this file is
 * written so a user cannot read it as "Virally made you an Instagram account":
 * `launch_kit_ready` says material is prepared, `awaiting_manual_creation` says the
 * user is registering it themselves. See supabase/migrations/0015_account_slots.sql.
 *
 * THIS IS NOT THE ENFORCEMENT BOUNDARY. The limit is enforced by a trigger in 0015
 * that also binds the service role. Everything here exists so the UI can explain
 * the limit before the user hits it, and mirrors the database rather than
 * substituting for it.
 */

import type { AccountSlotStatus, Platform } from "@/types/database";

/**
 * Mirrors the final fallback in `app.workspace_account_slot_limit`. Asserted
 * against the migration in slots.test.ts, so the two cannot drift silently.
 */
export const DEFAULT_ACCOUNT_SLOT_LIMIT = 10;

/**
 * `empty` is a UI state only — an unoccupied slot has no database row, so
 * `app.account_slot_status` has no such member. Keeping the distinction in the type
 * system means a query result can never be mistaken for a rendered grid position.
 */
export type SlotViewStatus = AccountSlotStatus | "empty";

export type SlotAccountSummary = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  lastSyncedAt: string | null;
};

export type OccupiedSlot = {
  kind: "occupied";
  id: string;
  slotNumber: number;
  platform: Platform;
  status: AccountSlotStatus;
  displayLabel: string | null;
  brandName: string | null;
  launchKitId: string | null;
  account: SlotAccountSummary | null;
};

export type EmptySlot = {
  kind: "empty";
  /**
   * The number `claim_account_slot` would allocate for this position, previewed
   * from the same rule the SQL uses. A preview and not a reservation: a concurrent
   * claim in another tab takes it first, and the server's answer wins. Nothing is
   * held open on the strength of this number.
   */
  previewNumber: number;
};

export type SlotView = OccupiedSlot | EmptySlot;

export type SlotUsage = {
  slotLimit: number;
  activeSlots: number;
  connectedSlots: number;
  archivedSlots: number;
  availableSlots: number;
};

/**
 * The lowest `count` positive integers not already taken.
 *
 * Mirrors the allocator in `public.claim_account_slot`, including the part that
 * matters: archived slots keep their numbers, so a freed number is NOT reused.
 * Users refer to "slot 4" in screenshots and handovers; recycling the number would
 * silently re-point those references at a different account.
 */
export function nextFreeSlotNumbers(used: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const taken = new Set(used);
  const free: number[] = [];
  for (let n = 1; free.length < count; n += 1) {
    if (!taken.has(n)) free.push(n);
  }
  return free;
}

/**
 * Assembles the ten-tile grid: occupied slots in slot order, then one empty tile
 * per remaining unit of capacity.
 *
 * The empty count comes from `limit - occupied.length`, NOT from "which numbers in
 * 1..limit are unused". Those differ whenever a slot has been archived: with slots
 * 1–4 and 6–11 active against a limit of 10, capacity is full, and filling the gap
 * at 5 would render an empty tile the user cannot actually claim.
 */
export function buildSlotGrid(
  occupied: readonly OccupiedSlot[],
  usedNumbers: readonly number[],
  limit: number,
): SlotView[] {
  const active = [...occupied].sort((a, b) => a.slotNumber - b.slotNumber);
  const available = Math.max(0, limit - active.length);
  const previews = nextFreeSlotNumbers(usedNumbers, available);
  return [...active, ...previews.map((previewNumber): EmptySlot => ({ kind: "empty", previewNumber }))];
}

/**
 * Presentation for each state.
 *
 * `tone` maps onto the two-accent taxonomy in tokens.css: `signal` (teal) only
 * where the machine is genuinely working, `action` (amber) only where a human must
 * decide something. Everything else stays neutral or warning — a slot that merely
 * exists is not a success worth colouring.
 */
type SlotPresentation = {
  label: string;
  tone: "neutral" | "action" | "signal" | "warning";
  /** What the user must do next, or null when nothing is required of them. */
  requiredAction: string | null;
  /** True when this state means a real authorised account is behind the slot. */
  hasLiveAuthorisation: boolean;
};

const PRESENTATION: Readonly<Record<SlotViewStatus, SlotPresentation>> = {
  empty: {
    label: "Empty slot",
    tone: "neutral",
    requiredAction: "Prepare a new account or connect one you already manage.",
    hasLiveAuthorisation: false,
  },
  planning: {
    label: "Planning",
    tone: "neutral",
    requiredAction: "Finish the launch kit for this slot.",
    hasLiveAuthorisation: false,
  },
  launch_kit_ready: {
    // Deliberately not "Account ready". Nothing has been registered anywhere.
    label: "Launch kit ready",
    tone: "action",
    requiredAction: "Register the account on the platform, then connect it here.",
    hasLiveAuthorisation: false,
  },
  awaiting_manual_creation: {
    label: "Awaiting your registration",
    tone: "action",
    requiredAction: "Create the account using the platform's own app or website.",
    hasLiveAuthorisation: false,
  },
  awaiting_connection: {
    label: "Awaiting connection",
    tone: "action",
    requiredAction: "Authorise Virally to publish to this account.",
    hasLiveAuthorisation: false,
  },
  connecting: {
    label: "Connecting",
    tone: "signal",
    requiredAction: null,
    hasLiveAuthorisation: false,
  },
  connected: {
    label: "Connected",
    tone: "signal",
    requiredAction: null,
    hasLiveAuthorisation: true,
  },
  limited_permissions: {
    label: "Limited permissions",
    tone: "warning",
    requiredAction: "Re-authorise to grant the publishing permissions Virally needs.",
    hasLiveAuthorisation: true,
  },
  reconnection_required: {
    label: "Reconnection required",
    tone: "warning",
    requiredAction: "The platform ended this authorisation. Reconnect to resume publishing.",
    hasLiveAuthorisation: true,
  },
  suspended_by_user: {
    label: "Paused by you",
    tone: "neutral",
    requiredAction: "Resume this slot to schedule to it again.",
    hasLiveAuthorisation: true,
  },
  disconnected: {
    label: "Disconnected",
    tone: "neutral",
    requiredAction: "Connect an account to use this slot.",
    hasLiveAuthorisation: false,
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    requiredAction: null,
    hasLiveAuthorisation: false,
  },
};

export function slotPresentation(status: SlotViewStatus): SlotPresentation {
  return PRESENTATION[status];
}

export function slotStatusLabel(status: SlotViewStatus): string {
  return PRESENTATION[status].label;
}

/**
 * States in which a slot may be scheduled to. Narrower than "has an account":
 * `limited_permissions` has a live authorisation but not the scopes to publish, and
 * treating it as publishable is how a batch of 184 jobs fails at the last step.
 */
export function isPublishable(status: SlotViewStatus): boolean {
  return status === "connected";
}

/** Slots that need the user to do something before they can be published to. */
export function slotsNeedingAttention(slots: readonly SlotView[]): OccupiedSlot[] {
  return slots.filter(
    (s): s is OccupiedSlot => s.kind === "occupied" && PRESENTATION[s.status].requiredAction !== null,
  );
}

/**
 * Postgres error code raised by `app.enforce_account_slot_limit`.
 * The UI branches on the code, never on the message, so the copy below can change
 * without breaking the branch.
 */
export const SLOT_LIMIT_SQLSTATE = "54023";

export function isSlotLimitError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === SLOT_LIMIT_SQLSTATE;
}

/**
 * The message shown when capacity is exhausted. Names both remedies, because
 * "upgrade" alone reads as a paywall when the user may simply have an unused slot.
 */
export function capacityNotice(usage: SlotUsage): string | null {
  if (usage.availableSlots > 0) return null;
  return `You are using all ${usage.slotLimit} account ${
    usage.slotLimit === 1 ? "slot" : "slots"
  }. Archive an unused slot or raise the workspace limit.`;
}

/** "7 of 10 slots active" — the header line. */
export function usageSummary(usage: SlotUsage): string {
  return `${usage.activeSlots} of ${usage.slotLimit} slots active`;
}
