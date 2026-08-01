import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Clock, Film, Image as ImageIcon, Mic, Volume2, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { PRODUCT_HOME, signInPathFor } from "@/lib/auth/routes";
import { resolveTenantContext } from "@/lib/tenant/context";
import { tenantScope } from "@/lib/creative/scope";
import { readBalance } from "@/lib/creative/credits";
import {
  readActiveGenerations,
  readAvailableModels,
  readGenerationHistory,
  readProviderStatus,
} from "@/lib/generation/data";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { STUDIOS, generateCopy, type StudioId } from "@/content/generate";
import { ProviderBanner } from "@/components/generate/ProviderBanner";
import { OutputGrid } from "@/components/generate/OutputGrid";
import { GenerationQueue } from "@/components/generate/GenerationQueue";

export const metadata: Metadata = {
  title: "Generate",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Runs shown on the overview before the studios take over. */
const HISTORY_LIMIT = 6;

const STUDIO_ICONS: Readonly<Record<StudioId, LucideIcon>> = {
  image: ImageIcon,
  video: Film,
  audio: Volume2,
  "lip-sync": Mic,
};

/**
 * Generation overview.
 *
 * The entry point to the four studios, plus the two things that are true across
 * all of them: what is running right now, and what ran recently. Everything is
 * server-rendered except the queue, which is the only part that changes while
 * the page is open.
 *
 * No figure here is synthesised. The credit balance is a sum over the ledger,
 * the model counts come from the catalogue with unconfigured providers already
 * excluded, and a workspace that has generated nothing sees zeros and a stated
 * empty state rather than a demo dataset.
 */
export default async function GenerateOverviewPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/generate"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);
  const { context } = resolution;

  const scope = tenantScope(context.organizationId, context.workspaceId);

  // Four reads, one round trip. None depends on another.
  const [models, history, activeRuns, balance] = await Promise.all([
    readAvailableModels({}),
    readGenerationHistory(scope, { limit: HISTORY_LIMIT }),
    readActiveGenerations(scope),
    readBalance(scope),
  ]);

  const providers = readProviderStatus();

  const studioModelCounts = new Map<StudioId, number>(
    STUDIOS.map((studio) => [
      studio.id,
      models.filter((model) =>
        model.capabilities.some((capability) => studio.capabilities.includes(capability)),
      ).length,
    ]),
  );

  return (
    <>
      <PageHeader
        title={generateCopy.overviewTitle}
        description={generateCopy.overviewDescription}
        meta={[context.workspaceName]}
      />

      <ProviderBanner providers={providers} />

      <KpiGrid columns={3}>
        <KpiCard
          label="Available credits"
          value={balance.available.toLocaleString("en-US")}
          icon={<Wallet size={14} strokeWidth={1.75} />}
          tone={balance.available > 0 ? "brand" : "neutral"}
          href="/app/usage"
          detail={
            <span className="text-[color:var(--text-muted)]">Production Credits, from the ledger</span>
          }
        />
        <KpiCard
          label="Held for work in flight"
          value={balance.reserved.toLocaleString("en-US")}
          icon={<Clock size={14} strokeWidth={1.75} />}
          detail={
            <span className="text-[color:var(--text-muted)]">Returned when each run settles</span>
          }
        />
        <KpiCard
          label="Generating now"
          value={activeRuns.length.toLocaleString("en-US")}
          detail={
            <span className="text-[color:var(--text-muted)]">
              {activeRuns.length === 0 ? "Nothing in the queue" : "Live below"}
            </span>
          }
        />
      </KpiGrid>

      <section aria-labelledby="studios-heading">
        <h2 id="studios-heading" className="app-section-title text-[color:var(--text-primary)]">
          Studios
        </h2>
        <ul className="mt-[var(--space-3)] grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-4">
          {STUDIOS.map((studio) => {
            const Icon = STUDIO_ICONS[studio.id];
            const count = studioModelCounts.get(studio.id) ?? 0;
            return (
              <li key={studio.id}>
                <Card as="article" interactive className="relative flex h-full flex-col p-[var(--app-panel-pad)]">
                  <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[color:var(--brand-ink)]">
                    <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
                  </span>

                  <h3 className="mt-[var(--space-3)] app-card-title text-[color:var(--text-primary)]">
                    {/* One stretched link, so the whole tile is a single target
                        rather than a heading link competing with a footer link. */}
                    <Link
                      href={studio.href}
                      className={cn(
                        "after:absolute after:inset-0 after:rounded-[var(--radius-card)] after:content-['']",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                      )}
                    >
                      {studio.title}
                    </Link>
                  </h3>

                  <p className="mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                    {studio.description}
                  </p>

                  <p className="app-figure mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                    {count === 0
                      ? "No model available yet"
                      : count === 1
                        ? "1 model available"
                        : `${count} models available`}
                    <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <Card>
        <CardHeader as="h2" title={generateCopy.queueTitle} divided />
        <CardBody>
          <GenerationQueue initial={activeRuns} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          as="h2"
          title={generateCopy.outputsTitle}
          description="Across every studio, newest first."
          divided
        />
        <CardBody>
          <OutputGrid
            runs={history.items}
            emptyTitle="Nothing generated yet"
            emptyBody="Pick a studio above. Every run appears here with its model, its state and what it cost."
          />
        </CardBody>
      </Card>
    </>
  );
}
