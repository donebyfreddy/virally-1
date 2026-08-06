import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { ChevronRight, Info, Lock } from "lucide-react";
import { Composer } from "@/components/create/Composer";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { Progress } from "@/components/app-ui/Progress";
import { EmptyState, ErrorState } from "@/components/app-ui/States";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { briefPanelCopy, createCopy, demoNotice } from "@/content/create";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { campaigns, connectedAccounts } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { isAnyProviderConfigured } from "@/lib/creative";
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
        <EmptyState
          icon={<Lock size={20} strokeWidth={1.75} />}
          title="Not available to your role"
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
  const unmetered = !isAnyProviderConfigured();

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={createCopy.heading}
          description={createCopy.body}
          meta={[
            context.workspaceName,
            context.brands.find((brand) => brand.id === context.brandId)?.name ?? "No brand",
            accountCount === 1 ? "1 connected account" : `${accountCount} connected accounts`,
          ]}
        />

        {errorCode && ERROR_COPY[errorCode] && (
          <ErrorState
            className="max-w-[60ch]"
            title="Could not continue"
            body={ERROR_COPY[errorCode]}
            reassurance="Nothing was generated and no credits were used."
          />
        )}

        {/* Stated before the user spends anything, not after they see the
            output. Info-toned rather than a warning: nothing is wrong, the
            provenance of what comes out is simply different. */}
        {unmetered && (
          <div
            className={cn(
              "flex max-w-[60ch] gap-[var(--space-3)] rounded-[var(--radius-card)]",
              "border border-[var(--info-mark)] bg-[var(--info-soft)] p-[var(--app-panel-pad)]",
            )}
          >
            <Info
              aria-hidden="true"
              size={16}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-[color:var(--info)]"
            />
            <div className="min-w-0">
              <p className="text-[length:var(--text-app-cell)] font-[var(--weight-heading)] text-[color:var(--info)]">
                {demoNotice.title}
              </p>
              <p className="mt-1 text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                {demoNotice.body}
              </p>
            </div>
          </div>
        )}

        <Composer
          onSubmit={createCampaign}
          accountCount={accountCount}
          defaultLanguage={brandRows[0]?.primaryLanguage ?? "en"}
          creditsAvailable={balance.available}
          creditsReserved={balance.reserved}
          unmetered={unmetered}
        />

        {/* Rendered only when there is something to resume. An empty "Recent
            campaigns" card on a first visit is a dead region that makes the page
            look broken rather than new. */}
        {recent.length > 0 && (
          <Card as="section" aria-labelledby="recent-heading">
            <CardHeader
              id="recent-heading"
              as="h2"
              title={briefPanelCopy.recentHeading}
              description={briefPanelCopy.recentHint}
              divided
              action={
                <Link
                  href="/app/campaigns"
                  className={cn(
                    "rounded-[var(--radius-chip)] text-[length:var(--text-app-meta)]",
                    "font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  )}
                >
                  View all
                </Link>
              }
            />

            <CardBody pad="none">
              <ul className="flex flex-col">
                {recent.map((campaign) => (
                  <li
                    key={campaign.id}
                    className="border-b border-[var(--border-subtle)] last:border-b-0"
                  >
                    <Link
                      href={`/app/campaigns/${campaign.id}`}
                      className={cn(
                        "group flex min-h-11 items-center gap-[var(--space-4)]",
                        "px-[var(--app-panel-pad)] py-[var(--space-3)]",
                        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                        "hover:bg-[var(--surface-secondary)]",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                          {campaign.name}
                        </span>
                        <span className="block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
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
                        className="shrink-0 text-[color:var(--text-muted)] transition-transform duration-[var(--dur-instant)] ease-[var(--ease-cut)] motion-safe:group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </PageStack>
    </AppPage>
  );
}
