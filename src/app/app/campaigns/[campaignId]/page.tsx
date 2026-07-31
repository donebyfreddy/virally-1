import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { AlertTriangle, Check, CircleDashed, MinusCircle } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import {
  activityEvents,
  campaignBriefs,
  campaignStages,
  campaigns,
  connectedAccounts,
  contentConcepts,
  contentItems,
  contentVariants,
  scheduledPosts,
} from "@/lib/db/schema.fragment";
import { relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel, PanelSection } from "@/components/app-ui/Panel";
import { Metric, MetricRow } from "@/components/app-ui/Metric";
import { RailList, RailNote, RailPanel, RailRow } from "@/components/app-ui/SummaryRail";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Progress } from "@/components/app-ui/Progress";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { GOAL_OPTIONS, PLATFORM_OPTIONS, TONE_OPTIONS } from "@/content/create";
import { STAGE_LABELS, STAGE_ORDER, campaignDetailCopy } from "@/content/campaigns";

export const dynamic = "force-dynamic";

const countFormatter = new Intl.NumberFormat("en-US");
const centsFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });

export async function generateMetadata({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}): Promise<Metadata> {
  const { campaignId } = await params;
  // Only the title needs the row, and an unauthorised read here would leak a
  // name into the tab title, so the workspace guard is applied even for metadata.
  const session = await readSession();
  if (session.status !== "authenticated") return { title: "Campaign" };

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") return { title: "Campaign" };

  const [row] = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.workspaceId, resolution.context.workspaceId),
      ),
    )
    .limit(1);

  return { title: row?.name ?? "Campaign", robots: { index: false, follow: false } };
}

/**
 * Campaign detail — the campaign's workspace.
 *
 * The pipeline is read from real `campaign_stages` rows rather than derived from
 * counters. That distinction is the whole point of the surface: a stage can be
 * blocked with a reason while its counters look healthy, and only the stage row
 * knows that.
 */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor(`/app/campaigns/${campaignId}`));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  // Scoped by workspace as well as id. Without the workspace predicate a valid
  // uuid from another tenant would load — hiding a link is not access control.
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.workspaceId, context.workspaceId),
        isNull(campaigns.deletedAt),
      ),
    )
    .limit(1);

  if (!campaign) notFound();

  const [stages, brief, concepts, itemRows, variantRows, destinations, activity] =
    await Promise.all([
      db
        .select()
        .from(campaignStages)
        .where(eq(campaignStages.campaignId, campaignId))
        .orderBy(asc(campaignStages.createdAt)),

      db
        .select({
          rawPrompt: campaignBriefs.rawPrompt,
          tone: campaignBriefs.tone,
          audience: campaignBriefs.audience,
        })
        .from(campaignBriefs)
        .where(and(eq(campaignBriefs.campaignId, campaignId), eq(campaignBriefs.isCurrent, true)))
        .limit(1),

      db
        .select({
          id: contentConcepts.id,
          title: contentConcepts.title,
          angle: contentConcepts.angle,
          summary: contentConcepts.summary,
          status: contentConcepts.status,
          hookCount: sql<number>`(
            select count(*)::int from content_hooks ch where ch.concept_id = ${contentConcepts.id}
          )`,
        })
        .from(contentConcepts)
        .where(eq(contentConcepts.campaignId, campaignId))
        .orderBy(asc(contentConcepts.position))
        .limit(12),

      db
        .select({ value: count() })
        .from(contentItems)
        .where(and(eq(contentItems.campaignId, campaignId), isNull(contentItems.deletedAt))),

      db
        .select({ value: count() })
        .from(contentVariants)
        .innerJoin(contentItems, eq(contentVariants.contentItemId, contentItems.id))
        .where(eq(contentItems.campaignId, campaignId)),

      db
        .select({
          platform: scheduledPosts.platform,
          username: connectedAccounts.username,
          scheduled: sql<number>`count(*)::int`,
        })
        .from(scheduledPosts)
        .leftJoin(connectedAccounts, eq(scheduledPosts.connectedAccountId, connectedAccounts.id))
        .where(eq(scheduledPosts.campaignId, campaignId))
        .groupBy(scheduledPosts.platform, connectedAccounts.username),

      db
        .select({
          id: activityEvents.id,
          summary: activityEvents.summary,
          kind: activityEvents.kind,
          createdAt: activityEvents.createdAt,
        })
        .from(activityEvents)
        .where(and(eq(activityEvents.workspaceId, context.workspaceId), eq(activityEvents.subjectId, campaignId)))
        .orderBy(desc(activityEvents.createdAt))
        .limit(6),
    ]);

  const stageByName = new Map(stages.map((stage) => [stage.stage, stage]));
  const completeCount = stages.filter((stage) => stage.state === "complete").length;
  const blocked = stages.find((stage) => stage.state === "blocked");

  const contentTotal = itemRows[0]?.value ?? 0;
  const variantTotal = variantRows[0]?.value ?? 0;

  const goalLabel = campaign.objective
    ? (GOAL_OPTIONS.find((option) => option.id === campaign.objective)?.label ?? campaign.objective)
    : null;
  const toneLabel = brief[0]?.tone
    ? (TONE_OPTIONS.find((option) => option.id === brief[0]?.tone)?.label ?? brief[0]?.tone)
    : null;

  return (
    <AppPage>
      <PageHeader
        eyebrow={campaignDetailCopy.eyebrow}
        title={campaign.name}
        meta={[
          ...(goalLabel ? [goalLabel] : []),
          ...(campaign.startsOn && campaign.endsOn
            ? [`${campaign.startsOn} → ${campaign.endsOn}`]
            : []),
          ...(toneLabel ? [toneLabel] : []),
          `Updated ${relativeDay(campaign.updatedAt)}`,
        ]}
        actions={
          <>
            <StatusChip status={campaign.status} />
            <ButtonLink href={`/app/content?campaign=${campaign.id}`} variant="secondary">
              View content
            </ButtonLink>
          </>
        }
      />

      <div className="mt-[var(--space-8)] grid items-start gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_var(--app-summary-rail)]">
        <div className="flex min-w-0 flex-col gap-[var(--space-6)]">
          {/* The pipeline. A stage list rather than a horizontal stepper: ten
              stages do not fit horizontally at any width worth designing for,
              and each stage needs room for a blocked reason. */}
          <Panel>
            <PanelSection
              title={campaignDetailCopy.pipelineHeading}
              id="campaign-pipeline"
              aside={
                <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                  {completeCount} / {STAGE_ORDER.length} complete
                </span>
              }
            >
              <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                {campaignDetailCopy.pipelineHint}
              </p>

              <Progress
                percent={(completeCount / STAGE_ORDER.length) * 100}
                label={`${campaign.name} pipeline progress`}
                tone={blocked ? "neutral" : "signal"}
                className="mt-[var(--space-4)]"
              />

              <ol className="mt-[var(--space-6)] flex flex-col">
                {STAGE_ORDER.map((name, index) => {
                  const stage = stageByName.get(name);
                  const state = stage?.state ?? "pending";
                  return (
                    <li
                      key={name}
                      className="flex items-start gap-[var(--space-3)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)] first:border-t-0 first:pt-0"
                    >
                      <StageIcon state={state} />

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-[var(--space-3)]">
                          <span
                            className={cn(
                              "text-[length:var(--text-app-cell)]",
                              state === "pending"
                                ? "text-[color:var(--color-text-muted)]"
                                : "text-[color:var(--color-text-primary)]",
                            )}
                          >
                            {STAGE_LABELS[name]}
                          </span>
                          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                            {stageStateLabel(state)}
                          </span>
                        </span>

                        {/* A blocked stage always carries its reason. A stage
                            that stopped without saying why is the single most
                            frustrating state in a pipeline product. */}
                        {state === "blocked" && stage?.blockedReason && (
                          <span className="mt-[var(--space-1)] block text-[length:var(--text-app-meta)] text-[color:var(--color-error)]">
                            {stage.blockedReason}
                          </span>
                        )}

                        {state === "complete" && stage?.completedAt && (
                          <span className="mt-[var(--space-1)] block font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                            {relativeDay(stage.completedAt)}
                          </span>
                        )}
                      </span>

                      <span
                        aria-hidden="true"
                        className="shrink-0 font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-border)]"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </PanelSection>
          </Panel>

          {/* The brief that produced everything below it. */}
          {brief[0]?.rawPrompt && (
            <Panel>
              <PanelSection title="Brief" id="campaign-brief">
                <p className="prose-measure whitespace-pre-wrap text-[length:var(--text-app-cell)] leading-[var(--leading-snug)] text-[color:var(--color-text-secondary)]">
                  {brief[0].rawPrompt}
                </p>
              </PanelSection>
            </Panel>
          )}

          <Panel>
            <PanelSection title={campaignDetailCopy.conceptsHeading} id="campaign-concepts">
              {concepts.length > 0 ? (
                <ul className="flex flex-col">
                  {concepts.map((concept) => (
                    <li
                      key={concept.id}
                      className="border-t border-[var(--color-border-hairline)] py-[var(--space-4)] first:border-t-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-3)]">
                        <h3 className="min-w-0 text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
                          {concept.title}
                        </h3>
                        <span className="shrink-0 font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                          {concept.hookCount === 1 ? "1 hook" : `${concept.hookCount} hooks`}
                        </span>
                      </div>
                      {concept.angle && (
                        <p className="mt-[var(--space-1)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                          {concept.angle}
                        </p>
                      )}
                      {concept.summary && (
                        <p className="prose-measure mt-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                          {concept.summary}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                  {campaignDetailCopy.noConcepts}
                </p>
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection title={campaignDetailCopy.destinationsHeading} id="campaign-destinations">
              {destinations.length > 0 ? (
                <ul className="flex flex-col">
                  {destinations.map((destination) => (
                    <li
                      key={`${destination.platform}-${destination.username ?? "unassigned"}`}
                      className="flex items-center justify-between gap-[var(--space-3)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)] first:border-t-0 first:pt-0"
                    >
                      <span className="min-w-0 text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                        {PLATFORM_OPTIONS.find((option) => option.id === destination.platform)
                          ?.label ?? destination.platform}
                        {destination.username ? ` · @${destination.username}` : ""}
                      </span>
                      <span className="shrink-0 font-utility text-[length:var(--text-app-cell)] tabular-nums text-[color:var(--color-text-primary)]">
                        {countFormatter.format(destination.scheduled)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                  {campaignDetailCopy.noDestinations}
                </p>
              )}
            </PanelSection>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-[var(--space-4)] xl:sticky xl:top-[var(--space-6)]">
          <RailPanel title={campaignDetailCopy.outputHeading} accent id="campaign-output">
            <RailList>
              <RailRow
                label="Concepts"
                value={countFormatter.format(campaign.conceptsCount)}
              />
              <RailRow label="Content items" value={countFormatter.format(contentTotal)} />
              <RailRow label="Platform variants" value={countFormatter.format(variantTotal)} />
              <RailRow
                label="Published"
                value={countFormatter.format(campaign.publishedCount)}
                divided
              />
            </RailList>
          </RailPanel>

          <RailPanel title={campaignDetailCopy.creditsHeading} id="campaign-credits">
            <RailList>
              <RailRow
                label="Estimated"
                value={centsFormatter.format(campaign.estimatedCostCents / 100)}
              />
              <RailRow
                label="Actual"
                value={centsFormatter.format(campaign.actualCostCents / 100)}
                emphasis
              />
            </RailList>
            <p className="mt-[var(--space-3)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
              Actual cost is the sum of completed generation runs. It stays at zero until a
              generation that spends credits has finished.
            </p>
          </RailPanel>

          {activity.length > 0 && (
            <RailPanel title={campaignDetailCopy.activityHeading} id="campaign-activity">
              <ul className="flex flex-col gap-[var(--space-3)]">
                {activity.map((event) => (
                  <li key={String(event.id)} className="flex flex-col">
                    <span className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                      {event.summary ?? event.kind}
                    </span>
                    <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                      {relativeDay(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </RailPanel>
          )}

          <RailNote
            title="Where content goes next"
            body="Approved variants are assigned to a connected account and a publish time at the schedule stage. Until then they sit in Content, reviewable and re-generatable."
            action={
              <Link
                href="/app/calendar"
                className="rounded-[var(--radius-sm)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-action)] transition-colors duration-[var(--dur-instant)] hover:text-[color:var(--color-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                Open calendar
              </Link>
            }
          />
        </aside>
      </div>

      {/* A compact restatement at the foot, so the page ends on the numbers
          rather than trailing off. Different layout from the rail above by
          design — the same figures in a different reading, not a duplicate
          panel. */}
      <Panel className="mt-[var(--space-6)]">
        <MetricRow columns={4}>
          <Metric
            label="Concepts"
            value={countFormatter.format(campaign.conceptsCount)}
            size="s"
          />
          <Metric label="Content items" value={countFormatter.format(contentTotal)} size="s" />
          <Metric label="Variants" value={countFormatter.format(variantTotal)} size="s" />
          <Metric
            label="Published"
            value={countFormatter.format(campaign.publishedCount)}
            size="s"
          />
        </MetricRow>
      </Panel>
    </AppPage>
  );
}

/** Stage state as an icon plus a word — never colour alone. */
function StageIcon({ state }: { state: string }) {
  const shared = "mt-0.5 shrink-0";
  if (state === "complete") {
    return (
      <Check
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className={cn(shared, "text-[color:var(--color-success)]")}
      />
    );
  }
  if (state === "blocked") {
    return (
      <AlertTriangle
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className={cn(shared, "text-[color:var(--color-error)]")}
      />
    );
  }
  if (state === "active") {
    return (
      <CircleDashed
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className={cn(shared, "text-[color:var(--color-signal)] motion-safe:animate-spin")}
        style={{ animationDuration: "3s" }}
      />
    );
  }
  if (state === "skipped") {
    return (
      <MinusCircle
        aria-hidden="true"
        size={16}
        strokeWidth={1.5}
        className={cn(shared, "text-[color:var(--color-text-muted)]")}
      />
    );
  }
  return (
    <CircleDashed
      aria-hidden="true"
      size={16}
      strokeWidth={1.5}
      className={cn(shared, "text-[color:var(--color-border)]")}
    />
  );
}

function stageStateLabel(state: string): string {
  switch (state) {
    case "complete":
      return "Complete";
    case "active":
      return "Running";
    case "blocked":
      return "Blocked";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}
