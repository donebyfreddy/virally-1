import {
  AlertTriangle,
  Archive,
  Check,
  CircleDashed,
  FileText,
  Link2,
  Pause,
  RefreshCw,
  ShieldAlert,
  Unlink,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { Card } from "@/components/app-ui/Card";
import { CellThumb } from "@/components/app-ui/DataTable";
import { accountsPage, PLATFORM_LABELS, slotActions } from "@/content/accounts";
import { archiveAccountSlot, markAccountRegistered } from "@/lib/accounts/actions";
import { slotPresentation, type OccupiedSlot } from "@/lib/accounts/slots";
import { cn } from "@/lib/cn";
import type { AccountSlotStatus, Platform } from "@/types/database";

/**
 * ACCOUNT SLOT CARD — the grid view of one occupied slot.
 *
 * Its skeleton is: identity → state → the four facts the connection reports →
 * the required action → operations. That is deliberately not the skeleton of the
 * empty tile next to it, per the anti-sameness rule: an empty slot is an offer, an
 * occupied slot is a machine with a state, and rendering both from one component
 * with a conditional is how they end up looking like the same generic card.
 *
 * Server component. Its buttons are forms posting to server actions, so the whole
 * grid costs zero client JavaScript.
 */

/**
 * Two-letter platform marks rather than brand logos.
 *
 * lucide ships Instagram, Facebook and YouTube glyphs but no TikTok one, and the
 * options were an inconsistent set, a substituted icon that is wrong, or a
 * self-drawn approximation of a trademark. A two-letter mark is consistent across
 * all four, needs no licence, and stays legible at 24px where a logo does not. It
 * is decorative — the platform name is always rendered as text beside it.
 */
const PLATFORM_MARKS: Readonly<Record<Platform, string>> = {
  instagram: "IG",
  facebook: "FB",
  tiktok: "TT",
  youtube: "YT",
};

/**
 * Presentation for every slot state.
 *
 * The rule this table encodes: amber means a live authorisation cannot publish and
 * a person has to fix it. It is NOT applied to the ordinary preparation steps —
 * five amber chips out of eleven states would train the user to ignore amber, and
 * "the launch kit is ready" is progress rather than a problem. Teal appears only
 * while the machine is genuinely working, green only where publishing actually
 * works, and every chip carries an icon and a word, so no state is legible by
 * colour alone.
 */
const HEALTH: Readonly<
  Record<AccountSlotStatus, { icon: LucideIcon; classes: string }>
> = {
  planning: {
    icon: CircleDashed,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  launch_kit_ready: {
    icon: FileText,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  awaiting_manual_creation: {
    icon: UserPlus,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  awaiting_connection: {
    icon: Link2,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  connecting: {
    icon: RefreshCw,
    classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]",
  },
  connected: {
    icon: Check,
    classes: "bg-[var(--success-soft)] text-[color:var(--success)]",
  },
  limited_permissions: {
    icon: ShieldAlert,
    classes: "bg-[var(--warning-soft)] text-[color:var(--warning)]",
  },
  reconnection_required: {
    icon: AlertTriangle,
    classes: "bg-[var(--warning-soft)] text-[color:var(--warning)]",
  },
  suspended_by_user: {
    icon: Pause,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  disconnected: {
    icon: Unlink,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
  },
  archived: {
    icon: Archive,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
  },
};

/** The account health chip. Word plus icon, never a bare colour. */
export function HealthChip({
  status,
  className,
}: {
  status: AccountSlotStatus;
  className?: string;
}) {
  const { icon: Icon, classes } = HEALTH[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] px-2 py-1",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        "whitespace-nowrap",
        classes,
        className,
      )}
    >
      <Icon aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
      {slotPresentation(status).label}
    </span>
  );
}

/** The decorative platform mark. The platform name always appears as text too. */
export function PlatformMark({ platform }: { platform: Platform }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-chip)]",
        "bg-[var(--surface-muted)] text-[length:var(--text-app-label-xs)]",
        "font-[var(--weight-strong)] text-[color:var(--text-secondary)]",
      )}
    >
      {PLATFORM_MARKS[platform]}
    </span>
  );
}

/** ISO timestamp → a plain date. Null when the platform has never synced. */
export function formatSyncedAt(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** What a row calls itself, in the order a user would recognise it. */
export function slotIdentity(slot: OccupiedSlot): string {
  return (
    slot.account?.displayName ??
    slot.account?.username ??
    slot.displayLabel ??
    PLATFORM_LABELS[slot.platform]
  );
}

/** Reach and queue depth, queried per account by the page. */
export type SlotActivity = {
  /** Posts approved, scheduled or queued for a future publish. */
  scheduled: number;
  /** Reach across recently published posts. Null when no post reported one. */
  reach: number | null;
};

const countFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function AccountSlotCard({
  slot,
  activity,
}: {
  slot: OccupiedSlot;
  activity: SlotActivity;
}) {
  const presentation = slotPresentation(slot.status);
  const account = slot.account;
  const identity = slotIdentity(slot);
  const syncedAt = formatSyncedAt(account?.lastSyncedAt ?? null);

  return (
    <Card as="li" className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-[var(--space-3)] p-[var(--app-panel-pad)] pb-[var(--space-3)]">
        <div className="flex min-w-0 items-center gap-[var(--space-3)]">
          <CellThumb src={account?.avatarUrl ?? null} alt="" fallback={identity} />
          <div className="min-w-0">
            <h3 className="app-card-title truncate text-[color:var(--text-primary)]">{identity}</h3>
            <p className="mt-0.5 flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
              <PlatformMark platform={slot.platform} />
              <span className="truncate">
                {PLATFORM_LABELS[slot.platform]}
                {account?.username ? ` · @${account.username}` : ""}
                {slot.brandName ? ` · ${slot.brandName}` : ""}
              </span>
            </p>
          </div>
        </div>
        <HealthChip status={slot.status} />
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-4)] px-[var(--app-panel-pad)] pb-[var(--app-panel-pad)]">
        {/* Only facts the connection actually returned. A follower count the
            platform never reported is an em dash, never a 0. */}
        <dl className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
          <CardStat
            label={accountsPage.columns.followers}
            value={
              account?.followerCount === null || account?.followerCount === undefined
                ? null
                : compactFormatter.format(account.followerCount)
            }
          />
          <CardStat label={accountsPage.columns.lastSync} value={syncedAt} />
          <CardStat
            label={accountsPage.columns.scheduled}
            value={countFormatter.format(activity.scheduled)}
          />
          <CardStat
            label={accountsPage.columns.reach}
            value={activity.reach === null ? null : compactFormatter.format(activity.reach)}
          />
        </dl>

        {presentation.requiredAction && (
          <p className="text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
            {presentation.requiredAction}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="app-figure mr-auto text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {`Slot ${String(slot.slotNumber).padStart(2, "0")}`}
          </span>

          {slot.launchKitId && (
            <ButtonLink href={`/app/accounts/${slot.id}`} variant="secondary">
              {slotActions.viewKit}
            </ButtonLink>
          )}

          {slot.status === "launch_kit_ready" && (
            <form action={markAccountRegistered}>
              <input type="hidden" name="slotId" value={slot.id} />
              <Button type="submit" variant="secondary">
                {slotActions.markRegistered}
              </Button>
            </form>
          )}

          {/* Archiving is offered only where it is actually permitted to succeed.
              A slot with a live authorisation must be disconnected first, and the
              action refuses it — so the button is not rendered rather than
              rendered and then rejected. */}
          {!slot.account && slot.status !== "archived" && (
            <form action={archiveAccountSlot}>
              <input type="hidden" name="slotId" value={slot.id} />
              <Button type="submit" variant="text">
                {slotActions.archive}
              </Button>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}

/** One fact on the card. `null` renders the em dash, with its reason for AT. */
function CardStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
        {label}
      </dt>
      <dd className="app-figure truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
        {value ?? (
          <span className="font-normal text-[color:var(--text-muted)]">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{accountsPage.notReported}</span>
          </span>
        )}
      </dd>
    </div>
  );
}
