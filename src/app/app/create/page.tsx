import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { Composer } from "@/components/create/Composer";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { Progress } from "@/components/app-ui/Progress";
import { ErrorState } from "@/components/app-ui/States";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { briefPanelCopy, createCopy, demoNotice } from "@/content/create";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { campaigns, connectedAccounts } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { isMockOnly } from "@/lib/ai/registry";
import { isMagnificConfigured } from "@/lib/creative";
import { readBalance } from "@/lib/creative/credits";
import { tenantScope } from "@/lib/creative/scope";
import { createCampaign } from "@/lib/content/actions";
import { signInPathFor } from "@/lib/auth/routes";
import { relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Create",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ERROR_COPY: Readonly<Record<string, string>> = {
  prompt: "Write a brief of at least ten characters before continuing.",
  invalid: "That combination of options is not valid. The plan summary explains why.",
  unconfirmed:
    "That batch needs explicit confirmation before it can render. Tick the confirmation box, or choose a cheaper stage.",
  save: "The campaign could not be saved. Nothing was generated and no credits were used. Try again.",
  permission: "Your role does not include creating content.",
};

/** How many campaigns the resume list shows. */
const RECENT_LIMIT = 4;

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/app/create"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  const { context } = resolution;
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;

  // Server-side gate, not just a hidden nav item.
  if (!can(context.role, "content.create")) {
    return (
      <AppPage width="text">
        <AuthMessage
          tone="notice"
          title="NOT AVAILABLE TO YOUR ROLE"
          body="Creating content requires the content.create permission. Your role can review and analyse, but not author. An administrator can change this from the Team page."
        />
      </AppPage>
    );
  }

  const [accountRows, brandRows, recent, balance] = await Promise.all([
    // Real count, so the plan's publishing-job figure is honest rather than assumed.
    db
      .select({ value: count() })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.workspaceId, context.workspaceId),
          isNull(connectedAccounts.disconnectedAt),
        ),
      ),

    context.brandId
      ? db
          .select({ primaryLanguage: brands.primaryLanguage })
          .from(brands)
          .where(and(eq(brands.id, context.brandId), eq(brands.workspaceId, context.workspaceId)))
          .limit(1)
      : Promise.resolve([]),

    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        contentCount: campaigns.contentCount,
        publishedCount: campaigns.publishedCount,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.updatedAt))
      .limit(RECENT_LIMIT),

    // Read from the ledger, not from a cached column — the balance is always
    // `sum(credit_ledger.delta)`. See src/lib/creative/credits.ts.
    readBalance(tenantScope(context.organizationId, context.workspaceId)),
  ]);

  const accountCount = accountRows[0]?.value ?? 0;

  // With no generation provider configured the batch runs on the mock and
  // reserves nothing, so the composer must not block submission on a zero
  // balance or claim credits will be deducted.
  const unmetered = !isMagnificConfigured();

  return (
    <AppPage>
      <PageHeader
        eyebrow={createCopy.eyebrow}
        title={createCopy.heading}
        description={createCopy.body}
        meta={[
          context.workspaceName,
          context.brands.find((brand) => brand.id === context.brandId)?.name ?? "No brand",
          accountCount === 1 ? "1 connected account" : `${accountCount} connected accounts`,
        ]}
      />

      {errorCode && ERROR_COPY[errorCode] && (
        <div className="mt-[var(--space-8)] max-w-[46rem]">
          <ErrorState
            title="COULD NOT CONTINUE"
            body={ERROR_COPY[errorCode]}
            reassurance="Nothing was generated and no credits were used."
          />
        </div>
      )}

      {/* Stated before the user spends anything, not after they see the output. */}
      {isMockOnly() && (
        <div className="mt-[var(--space-8)] max-w-[46rem]">
          <AuthMessage tone="notice" title={demoNotice.title} body={demoNotice.body} />
        </div>
      )}

      <div className="mt-[var(--space-8)]">
        <Composer
          onSubmit={createCampaign}
          accountCount={accountCount}
          defaultLanguage={brandRows[0]?.primaryLanguage ?? "en"}
          creditsAvailable={balance.available}
          creditsReserved={balance.reserved}
          unmetered={unmetered}
        />
      </div>

      {/* Rendered only when there is something to resume. An empty "Recent
          campaigns" panel on a first visit is a dead region that makes the page
          look broken rather than new. */}
      {recent.length > 0 && (
        <Panel className="mt-[var(--space-8)]">
          <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-4)]">
            <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
              {briefPanelCopy.recentHeading}
            </h2>
            <Link
              href="/app/campaigns"
              className="rounded-[var(--radius-sm)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)] transition-colors duration-[var(--dur-instant)] hover:text-[color:var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              View all
            </Link>
          </div>

          <ul className="mt-[var(--space-4)] flex flex-col">
            {recent.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/app/campaigns/${campaign.id}`}
                  className={cn(
                    "group flex min-h-11 items-center gap-[var(--space-4)] rounded-[var(--radius-sm)]",
                    "border-t border-[var(--color-border-hairline)] px-[var(--space-2)] py-[var(--space-3)]",
                    "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                    "hover:bg-[var(--color-surface-2)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
                      {campaign.name}
                    </span>
                    <span className="block font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                      Updated {relativeDay(campaign.updatedAt)}
                    </span>
                  </span>

                  <StatusChip status={campaign.status} />

                  {/* Progress is published-over-planned, both real counters
                      maintained by the job workers. A campaign with no content
                      yet has no ratio to show, so the bar is omitted rather than
                      rendered at zero — which would read as stalled. */}
                  {campaign.contentCount > 0 && (
                    <span className="hidden w-[8rem] shrink-0 sm:block">
                      <Progress
                        percent={(campaign.publishedCount / campaign.contentCount) * 100}
                        label={`${campaign.name} publishing progress`}
                      />
                    </span>
                  )}

                  <ChevronRight
                    aria-hidden="true"
                    size={16}
                    strokeWidth={1.5}
                    className="shrink-0 text-[color:var(--color-text-muted)] transition-transform duration-[var(--dur-instant)] ease-[var(--ease-cut)] motion-safe:group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AppPage>
  );
}
