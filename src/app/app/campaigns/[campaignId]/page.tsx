import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { AlertTriangle, ArrowRight, Check, CircleDashed, MinusCircle } from "lucide-react";
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
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { FigureList, FigureRow, PanelNote } from "@/components/app-ui/Figures";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Progress } from "@/components/app-ui/Progress";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { GOAL_OPTIONS, PLATFORM_OPTIONS, TONE_OPTIONS } from "@/content/create";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_STATE_LABELS,
  campaignDetailCopy,
} from "@/content/campaigns";

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
 *
 * Composed entirely of `Card` — one card treatment on the page, matching
 * `/app/campaigns`. The figures in the rail are `FigureRow`s, which is the same
 * label/value line the create page's credit card uses, so a number reads the same
 * way wherever the product states one.
 *
 * The four output figures appear once, in the rail. The previous version repeated
 * them in a `MetricRow` at the foot of the page; the same four numbers twice on
 * one screen is not a second reading, it is a duplicate the user has to check
 * against the first.
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
      <PageStack>
        <PageHeader
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

        <div className="grid items-start gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_var(--app-summary-rail)]">
          <div className="flex min-w-0 flex-col gap-[var(--app-panel-gap)]">
            {/* The pipeline. A stage list rather than a horizontal stepper: ten
                stages do not fit horizontally at any width worth designing for,
                and each stage needs room for a blocked reason. */}
            <Card as="section" aria-labelledby="campaign-pipeline">
              <CardHeader
                id="campaign-pipeline"
                as="h2"
                title={campaignDetailCopy.pipelineHeading}
                description={campaignDetailCopy.pipelineHint}
                action={
                  <span className="app-figure whitespace-nowrap text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                    {campaignDetailCopy.pipelineProgress(completeCount, STAGE_ORDER.length)}
                  </span>
                }
              />

              <CardBody className="pt-[var(--space-4)]">
                <Progress
                  percent={(completeCount / STAGE_ORDER.length) * 100}
                  label={`${campaign.name} pipeline progress`}
                  tone={blocked ? "neutral" : "signal"}
                />

                <ol className="mt-[var(--space-4)] flex flex-col">
                  {STAGE_ORDER.map((name) => {
                    const stage = stageByName.get(name);
                    const state = stage?.state ?? "pending";
                    return (
                      <li
                        key={name}
                        className="flex items-start gap-[var(--space-3)] border-t border-[var(--border-subtle)] py-[var(--space-3)] first:border-t-0 first:pt-0"
                      >
                        <StageIcon state={state} />

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-[var(--space-3)]">
                            <span
                              className={cn(
                                "text-[length:var(--text-app-cell)]",
                                state === "pending"
                                  ? "text-[color:var(--text-muted)]"
                                  : "text-[color:var(--text-primary)]",
                              )}
                            >
                              {STAGE_LABELS[name]}
                            </span>
                            <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                              {STAGE_STATE_LABELS[state] ?? state}
                            </span>
                          </span>

                          {/* A blocked stage always carries its reason. A stage
                              that stopped without saying why is the single most
                              frustrating state in a pipeline product. Amber, not
                              red, and the same amber the campaigns list uses for
                              a blocked stage: it is waiting on a person, and red
                              is reserved for something that failed outright. */}
                          {state === "blocked" && stage?.blockedReason && (
                            <span className="mt-[var(--space-1)] block text-[length:var(--text-app-meta)] text-[color:var(--warning)]">
                              {stage.blockedReason}
                            </span>
                          )}

                          {state === "complete" && stage?.completedAt && (
                            <span className="app-figure mt-[var(--space-1)] block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                              {relativeDay(stage.completedAt)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            </Card>

            {/* The brief that produced everything below it. */}
            {brief[0]?.rawPrompt && (
              <Card as="section" aria-labelledby="campaign-brief">
                <CardHeader id="campaign-brief" as="h2" title={campaignDetailCopy.briefHeading} />
                <CardBody className="pt-[var(--space-3)]">
                  <p className="prose-measure whitespace-pre-wrap text-[length:var(--text-app-cell)] leading-[var(--leading-snug)] text-[color:var(--text-secondary)]">
                    {brief[0].rawPrompt}
                  </p>
                </CardBody>
              </Card>
            )}

            <Card as="section" aria-labelledby="campaign-concepts">
              <CardHeader
                id="campaign-concepts"
                as="h2"
                title={campaignDetailCopy.conceptsHeading}
              />
              <CardBody className="pt-[var(--space-3)]">
                {concepts.length > 0 ? (
                  <ul className="flex flex-col">
                    {concepts.map((concept) => (
                      <li
                        key={concept.id}
                        className="border-t border-[var(--border-subtle)] py-[var(--space-4)] first:border-t-0 first:pt-0"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-3)]">
                          <h3 className="min-w-0 text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                            {concept.title}
                          </h3>
                          <span className="app-figure shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                            {concept.hookCount === 1 ? "1 hook" : `${concept.hookCount} hooks`}
                          </span>
                        </div>
                        {concept.angle && (
                          <p className="mt-[var(--space-1)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                            {concept.angle}
                          </p>
                        )}
                        {concept.summary && (
                          <p className="prose-measure mt-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                            {concept.summary}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                    {campaignDetailCopy.noConcepts}
                  </p>
                )}
              </CardBody>
            </Card>

            <Card as="section" aria-labelledby="campaign-destinations">
              <CardHeader
                id="campaign-destinations"
                as="h2"
                title={campaignDetailCopy.destinationsHeading}
              />
              <CardBody className="pt-[var(--space-3)]">
                {destinations.length > 0 ? (
                  <FigureList>
                    {destinations.map((destination) => (
                      <FigureRow
                        key={`${destination.platform}-${destination.username ?? "unassigned"}`}
                        label={destinationLabel(destination.platform, destination.username)}
                        value={countFormatter.format(destination.scheduled)}
                      />
                    ))}
                  </FigureList>
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                    {campaignDetailCopy.noDestinations}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Ordered after the main column in the DOM so keyboard and
              screen-reader users reach the campaign itself first. `sticky` only
              at xl, where there is room for it to be useful; below that it is
              stacked content and pinning it would cover the page. */}
          <aside className="flex min-w-0 flex-col gap-[var(--app-panel-gap)] xl:sticky xl:top-[var(--space-6)]">
            <Card as="section" aria-labelledby="campaign-output">
              <CardHeader id="campaign-output" as="h2" title={campaignDetailCopy.outputHeading} />
              <CardBody className="pt-[var(--space-3)]">
                <FigureList>
                  <FigureRow
                    label="Concepts"
                    value={countFormatter.format(campaign.conceptsCount)}
                  />
                  <FigureRow label="Content items" value={countFormatter.format(contentTotal)} />
                  <FigureRow label="Platform variants" value={countFormatter.format(variantTotal)} />
                  <FigureRow
                    label="Published"
                    value={countFormatter.format(campaign.publishedCount)}
                    emphasis
                    divided
                  />
                </FigureList>
              </CardBody>
            </Card>

            <Card as="section" aria-labelledby="campaign-credits">
              <CardHeader id="campaign-credits" as="h2" title={campaignDetailCopy.creditsHeading} />
              <CardBody className="flex flex-col gap-[var(--space-4)] pt-[var(--space-3)]">
                <FigureList>
                  <FigureRow
                    label="Estimated"
                    value={centsFormatter.format(campaign.estimatedCostCents / 100)}
                  />
                  <FigureRow
                    label="Actual"
                    value={centsFormatter.format(campaign.actualCostCents / 100)}
                    emphasis
                    divided
                  />
                </FigureList>

                <PanelNote
                  title={campaignDetailCopy.creditsNoteTitle}
                  body={campaignDetailCopy.creditsNote}
                />
              </CardBody>
            </Card>

            <Card as="section" aria-labelledby="campaign-activity">
              <CardHeader
                id="campaign-activity"
                as="h2"
                title={campaignDetailCopy.activityHeading}
              />
              <CardBody className="pt-[var(--space-3)]">
                {activity.length > 0 ? (
                  <ul className="flex flex-col gap-[var(--space-3)]">
                    {activity.map((event) => (
                      <li key={String(event.id)} className="flex flex-col">
                        <span className="text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                          {event.summary ?? event.kind}
                        </span>
                        <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                          {relativeDay(event.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                    {campaignDetailCopy.noActivity}
                  </p>
                )}
              </CardBody>
            </Card>

            <Card as="section" aria-labelledby="campaign-next">
              <CardHeader id="campaign-next" as="h2" title={campaignDetailCopy.nextHeading} />
              <CardBody className="pt-[var(--space-3)]">
                <p className="text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--text-secondary)]">
                  {campaignDetailCopy.nextBody}
                </p>

                <Link
                  href="/app/calendar"
                  className={cn(
                    "mt-[var(--space-4)] inline-flex items-center gap-[var(--space-1)]",
                    "rounded-[var(--radius-chip)]",
                    "text-[length:var(--text-app-cell)] font-[var(--weight-strong)]",
                    "text-[color:var(--brand-ink)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  )}
                >
                  {campaignDetailCopy.nextAction}
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
                </Link>
              </CardBody>
            </Card>
          </aside>
        </div>
      </PageStack>
    </AppPage>
  );
}

/**
 * A destination, as one line.
 *
 * Platform plus account, because a campaign can publish to two accounts on the
 * same platform and the platform alone would collapse them into one row the user
 * cannot tell apart.
 */
function destinationLabel(platform: string, username: string | null): string {
  const label = PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
  return username ? `${label} · @${username}` : label;
}

/**
 * Stage state as an icon plus a word — never colour alone.
 *
 * Blocked is amber rather than red, matching the campaigns list: a blocked stage
 * is waiting on a person, and red is reserved for something that failed.
 */
function StageIcon({ state }: { state: string }) {
  const shared = "mt-0.5 shrink-0";
  if (state === "complete") {
    return (
      <Check
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className={cn(shared, "text-[color:var(--success)]")}
      />
    );
  }
  if (state === "blocked") {
    return (
      <AlertTriangle
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className={cn(shared, "text-[color:var(--warning)]")}
      />
    );
  }
  if (state === "active") {
    return (
      <CircleDashed
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        // The one place a spin is licensed on this page: it means the stage is
        // genuinely running. `motion-safe` only — the word beside it carries the
        // state on its own under reduced motion.
        className={cn(shared, "text-[color:var(--brand-primary)] motion-safe:animate-spin")}
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
        className={cn(shared, "text-[color:var(--text-muted)]")}
      />
    );
  }
  return (
    <CircleDashed
      aria-hidden="true"
      size={16}
      strokeWidth={1.5}
      className={cn(shared, "text-[color:var(--border-strong)]")}
    />
  );
}
