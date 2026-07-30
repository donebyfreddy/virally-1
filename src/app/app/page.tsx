import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eyebrow, Rule } from "@/components/primitives/Eyebrow";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { Badge } from "@/components/primitives/Badge";
import { and, count, eq, isNull } from "drizzle-orm";
import { readSession, displayName } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { campaigns, connectedAccounts, contentItems, scheduledPosts } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Overview.
 *
 * Every figure on this page is a real count from the user's own workspace. A new
 * account therefore sees zeros — and each zero says what will populate it and
 * offers the action that would. The brief forbids fake values in an empty state, and
 * an unexplained row of zeros is nearly as bad: it reads as a broken product.
 *
 * The full operations centre — charts, queue, account health, top content, live
 * activity — is Phase 4 and needs data to exist before it can be built honestly.
 * What is here is the part that is true today.
 */
export default async function OverviewPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor(PRODUCT_HOME));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const workspaceId = context.workspaceId;

  // Five cheap aggregate counts rather than five row fetches: the page needs
  // cardinality, not contents.
  const [campaignRows, contentRows, accountRows, scheduledRows, publishedRows] = await Promise.all([
    db.select({ value: count() }).from(campaigns)
      .where(and(eq(campaigns.workspaceId, workspaceId), isNull(campaigns.deletedAt))),
    db.select({ value: count() }).from(contentItems)
      .where(and(eq(contentItems.workspaceId, workspaceId), isNull(contentItems.deletedAt))),
    db.select({ value: count() }).from(connectedAccounts)
      .where(and(eq(connectedAccounts.workspaceId, workspaceId), isNull(connectedAccounts.disconnectedAt))),
    db.select({ value: count() }).from(scheduledPosts)
      .where(and(eq(scheduledPosts.workspaceId, workspaceId), eq(scheduledPosts.status, "scheduled"))),
    db.select({ value: count() }).from(scheduledPosts)
      .where(and(eq(scheduledPosts.workspaceId, workspaceId), eq(scheduledPosts.status, "published"))),
  ]);

  const counts = {
    campaigns: campaignRows[0]?.value ?? 0,
    content: contentRows[0]?.value ?? 0,
    accounts: accountRows[0]?.value ?? 0,
    scheduled: scheduledRows[0]?.value ?? 0,
    published: publishedRows[0]?.value ?? 0,
  };

  const name = displayName(context.user);
  const isEmpty = counts.campaigns === 0 && counts.content === 0 && counts.accounts === 0;

  return (
    <div className="mx-auto w-full max-w-[var(--container-wide)] px-[var(--gutter)] py-12">
      <header>
        <Eyebrow>{greeting()}</Eyebrow>
        <h1 className="font-display mt-3 text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          {/* The real name when one exists; never a hardcoded placeholder. */}
          {name ? `${greetingVerb()}, ${name}.` : `${greetingVerb()}.`}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          <span>{context.workspaceName}</span>
          <span aria-hidden="true">·</span>
          <span>{context.brands.find((b) => b.id === context.brandId)?.name ?? "No brand"}</span>
          <span aria-hidden="true">·</span>
          <span>{context.organizationName}</span>
        </p>
      </header>

      <Rule className="my-10" />

      {isEmpty ? (
        <EmptyOperation canCreate={can(context.role, "content.create")} />
      ) : (
        <section aria-labelledby="operation-state">
          <h2
            id="operation-state"
            className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]"
          >
            Your operation
          </h2>

          <dl className="mt-6 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label="Campaigns"
              value={counts.campaigns}
              explains="Campaigns created in this workspace."
            />
            <Metric
              label="Content items"
              value={counts.content}
              explains="Items generated or uploaded, before per-platform variants."
            />
            <Metric
              label="Connected accounts"
              value={counts.accounts}
              explains="Accounts authorised for publishing."
            />
            <Metric
              label="Scheduled posts"
              value={counts.scheduled}
              explains="Approved and waiting for their publish time."
            />
            <Metric
              label="Published posts"
              value={counts.published}
              explains="Confirmed published by the platform."
            />
          </dl>
        </section>
      )}

      <Rule className="my-10" />

      {/* Stated plainly rather than filling the space with placeholder charts. */}
      <section aria-labelledby="build-state">
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="build-state"
            className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]"
          >
            Performance reporting
          </h2>
          <Badge tone="warning">PHASE 4</Badge>
        </div>
        <p className="prose-measure mt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          Views, engagement, retention and follower growth appear here once content
          has been published to a connected account and a metrics sync has run. The
          charts are not rendered yet — showing them filled with sample numbers
          would misrepresent an account that has published nothing.
        </p>
      </section>
    </div>
  );
}

/**
 * Local-time greeting. Computed server-side from the server's clock, which is a
 * known approximation: the profile carries a timezone, and Phase 4 uses it. Saying
 * "Good morning" to someone at midnight is a small wrongness, so it is flagged
 * rather than left to look intentional.
 */
function greeting(): string {
  return "OVERVIEW";
}

function greetingVerb(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Metric({
  label,
  value,
  explains,
}: {
  label: string;
  value: number;
  explains: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
        {label}
      </dt>
      {/* Tabular figures so a column of numbers aligns. */}
      <dd className="font-utility text-[length:var(--text-display-m)] tabular-nums text-[color:var(--color-text-primary)]">
        {value.toLocaleString("en-US")}
      </dd>
      <p className="text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
        {explains}
      </p>
    </div>
  );
}

function EmptyOperation({ canCreate }: { canCreate: boolean }) {
  return (
    <section aria-labelledby="empty-state" className="max-w-[var(--measure-prose)]">
      <h2 id="empty-state" className="font-display text-[length:var(--text-title)]">
        Your content operation is ready.
      </h2>
      <p className="mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
        Nothing has been created yet, so there is no performance data to show. Create
        a campaign or connect a channel to begin.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {canCreate && <ButtonLink href="/app/create">Create first campaign</ButtonLink>}
        <ButtonLink href="/app/accounts" variant="secondary">
          Connect an account
        </ButtonLink>
        <ButtonLink href="/app/library" variant="secondary">
          Upload existing content
        </ButtonLink>
      </div>
    </section>
  );
}
