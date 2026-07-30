import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { PLATFORM_LABELS, slotActions } from "@/content/accounts";
import { archiveAccountSlot, markAccountRegistered } from "@/lib/accounts/actions";
import { slotPresentation, type OccupiedSlot } from "@/lib/accounts/slots";
import { cn } from "@/lib/cn";
import type { Platform } from "@/types/database";

/**
 * ACCOUNT SLOT CARD — one of the seven named surfaces in the design reference.
 *
 * Its skeleton is: index rail → platform mark → identity → health row → required
 * action → operations. That is deliberately not the skeleton of the empty tile next
 * to it, per the anti-sameness rule: an empty slot is an offer, an occupied slot is
 * a machine with a state, and rendering both from one component with a conditional
 * is how they end up looking like the same generic card.
 *
 * Server component. Its buttons are forms posting to server actions, so the whole
 * grid costs zero client JavaScript.
 */

/**
 * Two-letter platform marks rather than brand logos.
 *
 * lucide ships Instagram, Facebook and YouTube glyphs but no TikTok one, and the
 * options were an inconsistent set, a substituted icon that is wrong, or a
 * self-drawn approximation of a trademark. A monospace mark is consistent across all
 * four, needs no licence, and matches the operational register the rest of the
 * product uses. It is decorative — the platform name is always rendered as text.
 */
const PLATFORM_MARKS: Readonly<Record<Platform, string>> = {
  instagram: "IG",
  facebook: "FB",
  tiktok: "TT",
  youtube: "YT",
};

function formatSyncedAt(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function AccountSlotCard({ slot, index }: { slot: OccupiedSlot; index: number }) {
  const presentation = slotPresentation(slot.status);
  const account = slot.account;
  const identity =
    account?.displayName ?? account?.username ?? slot.displayLabel ?? PLATFORM_LABELS[slot.platform];
  const syncedAt = formatSyncedAt(account?.lastSyncedAt ?? null);

  return (
    <li
      className={cn(
        "flex gap-4 border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)] p-4",
        "rounded-[var(--radius-sm)]",
        // Entry is a CSS stagger rather than framer-motion: this is a list of real
        // records, not a supply-chain mechanic, and it must not cost client JS.
        "motion-safe:animate-[virally-stage-in_var(--dur-panel)_var(--ease-settle)_backwards]",
      )}
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
    >
      {/* Index rail. Tabular so the column does not jitter between 9 and 10. */}
      <div className="flex flex-col items-center gap-2">
        <span className="font-utility text-[length:var(--text-utility)] tabular-nums text-[color:var(--color-text-muted)]">
          {String(slot.slotNumber).padStart(2, "0")}
        </span>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)] font-utility text-[length:var(--text-utility)] text-[color:var(--color-text-secondary)]"
        >
          {PLATFORM_MARKS[slot.platform]}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[length:var(--text-body-s)] font-medium text-[color:var(--color-text-primary)]">
            {identity}
          </h3>
          {/* Badge carries the literal word; tone is redundant reinforcement, never
              the only signal. */}
          <Badge tone={presentation.tone}>{presentation.label}</Badge>
        </div>

        <p className="mt-1 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          {PLATFORM_LABELS[slot.platform]}
          {slot.brandName ? ` · ${slot.brandName}` : ""}
          {account?.username ? ` · @${account.username}` : ""}
        </p>

        {/* Health row. Only facts the connection actually returned appear here — a
            follower count is omitted rather than rendered as 0 when unknown. */}
        {(account?.followerCount !== null && account?.followerCount !== undefined) || syncedAt ? (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            {account?.followerCount !== null && account?.followerCount !== undefined ? (
              <div className="flex gap-2">
                <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                  Followers
                </dt>
                <dd className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-secondary)]">
                  {account.followerCount.toLocaleString("en-US")}
                </dd>
              </div>
            ) : null}
            {syncedAt ? (
              <div className="flex gap-2">
                <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                  Last sync
                </dt>
                <dd className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-secondary)]">
                  {syncedAt}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {presentation.requiredAction ? (
          <p className="mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
            {presentation.requiredAction}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {slot.launchKitId ? (
            <ButtonLink href={`/app/accounts/${slot.id}`} variant="secondary">
              {slotActions.viewKit}
            </ButtonLink>
          ) : null}

          {slot.status === "launch_kit_ready" ? (
            <form action={markAccountRegistered}>
              <input type="hidden" name="slotId" value={slot.id} />
              <Button type="submit" variant="secondary">
                {slotActions.markRegistered}
              </Button>
            </form>
          ) : null}

          {/* Archiving is offered only where it is actually permitted to succeed. A
              slot with a live authorisation must be disconnected first, and the
              action refuses it — so the button is not rendered rather than rendered
              and then rejected. */}
          {!slot.account && slot.status !== "archived" ? (
            <form action={archiveAccountSlot}>
              <input type="hidden" name="slotId" value={slot.id} />
              <Button type="submit" variant="text">
                {slotActions.archive}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}
