import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { accountSlots } from "@/lib/db/schema";
import { accountLaunchKits } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { archiveAccountSlot, markAccountRegistered } from "@/lib/accounts/actions";
import { slotPresentation } from "@/lib/accounts/slots";
import { cn } from "@/lib/cn";
import { AppPage, DashGrid, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { DataTable, type Column } from "@/components/app-ui/DataTable";
import { EmptyState } from "@/components/app-ui/States";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { HealthChip, PlatformMark } from "@/components/accounts/AccountSlotCard";
import { LaunchKitExport } from "@/components/accounts/LaunchKitExport";
import { PLATFORM_LABELS, launchKitPage, launchPage, slotActions } from "@/content/accounts";
import type { Json } from "@/types/database";

export const metadata: Metadata = {
  title: "Launch kit",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PlannedPost = { position: number; title: string; pillar: string; hook: string };
type ChecklistStep = { step: number; label: string; detail: string };

/**
 * jsonb columns arrive as `Json`, which is genuinely unknown at the type level. These
 * narrow it by checking each field rather than casting.
 *
 * A cast would compile and then throw at render on any row written by an older shape
 * — and these columns are written by a provider whose output shape can change. A row
 * that does not match is skipped, so a partially-malformed plan renders the posts it
 * can rather than blanking the page.
 */
function parsePosts(value: Json | null): PlannedPost[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, Json | undefined>;
    const { position, title, pillar, hook } = record;
    if (typeof position !== "number" || typeof title !== "string") return [];
    return [
      {
        position,
        title,
        pillar: typeof pillar === "string" ? pillar : "",
        hook: typeof hook === "string" ? hook : "",
      },
    ];
  });
}

function parseChecklist(value: Json | null): ChecklistStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, Json | undefined>;
    const { step, label, detail } = record;
    if (typeof step !== "number" || typeof label !== "string") return [];
    return [{ step, label, detail: typeof detail === "string" ? detail : "" }];
  });
}

/** The plain-text export. Built once and used for both clipboard and file. */
function renderPlainText(parts: {
  platform: string;
  slotNumber: number;
  names: string[];
  usernames: string[];
  bio: string | null;
  description: string | null;
  voice: string | null;
  audience: string | null;
  visual: string | null;
  pillars: string[];
  hooks: string[];
  posts: PlannedPost[];
  checklist: ChecklistStep[];
}): string {
  const lines: string[] = [
    `VIRALLY LAUNCH KIT — ${parts.platform}, slot ${parts.slotNumber}`,
    "",
    "This is prepared material. The account has not been registered on the platform.",
    "",
    "ACCOUNT NAME IDEAS",
    ...parts.names.map((n) => `  - ${n}`),
    "",
    "USERNAME CANDIDATES (availability not checked)",
    ...parts.usernames.map((u) => `  - ${u}`),
    "",
  ];

  if (parts.bio) lines.push("BIO", `  ${parts.bio}`, "");
  if (parts.description) lines.push("PROFILE DESCRIPTION", `  ${parts.description}`, "");
  if (parts.voice) lines.push("BRAND VOICE", `  ${parts.voice}`, "");
  if (parts.audience) lines.push("AUDIENCE", `  ${parts.audience}`, "");
  if (parts.visual) lines.push("PROFILE IMAGE CONCEPT", `  ${parts.visual}`, "");

  lines.push("CONTENT PILLARS", ...parts.pillars.map((p) => `  - ${p}`), "");
  lines.push("OPENING HOOKS", ...parts.hooks.map((h, i) => `  ${i + 1}. ${h}`), "");
  lines.push(
    "FIRST THIRTY POSTS",
    ...parts.posts.map((p) => `  ${p.position}. ${p.title}${p.hook ? ` — ${p.hook}` : ""}`),
    "",
  );
  lines.push(
    "SETUP CHECKLIST (you perform these on the platform)",
    ...parts.checklist.flatMap((s) => [`  ${s.step}. ${s.label}`, s.detail ? `     ${s.detail}` : ""]),
  );

  return lines.filter((line) => line !== undefined).join("\n");
}

/**
 * A slot and its launch kit.
 *
 * The handoff statement sits above the material rather than below it: the user's first
 * question on this screen is "so does the account exist now", and the answer has to
 * arrive before the list of usernames implies one.
 *
 * The layout is deliberately asymmetric — a wide column of generated material against
 * a narrow identity rail — rather than another grid of equal cards, because the two
 * halves are read differently: the material is worked through in order, the rail is
 * copied out field by field.
 */
export default async function SlotDetailPage({
  params,
}: {
  params: Promise<{ slotId: string }>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  const { slotId } = await params;
  if (session.status === "anonymous") redirect(signInPathFor(`/app/accounts/${slotId}`));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);
  const { context } = resolution;

  // Workspace-filtered explicitly: a slot id from another tenant must read as
  // absent, not as forbidden — there is no RLS to fall back on anymore.
  const [slot] = await db
    .select({
      id: accountSlots.id,
      slotNumber: accountSlots.slotNumber,
      platform: accountSlots.platform,
      status: accountSlots.status,
      displayLabel: accountSlots.displayLabel,
      accountLaunchKitId: accountSlots.accountLaunchKitId,
      internalNotes: accountSlots.internalNotes,
      connectedAccountId: accountSlots.connectedAccountId,
    })
    .from(accountSlots)
    .where(and(eq(accountSlots.id, slotId), eq(accountSlots.workspaceId, context.workspaceId)))
    .limit(1);

  if (!slot) notFound();

  // TODO(schema-gap): `account_launch_kits` has no `visual_direction` or
  // `status` column in src/lib/db/schema.fragment.ts, even though the
  // already-converted src/lib/accounts/actions.ts writes both. This is a
  // pre-existing gap in the Drizzle schema — `visualDirection` is rendered as
  // null below until the schema is extended to match; `status` was unused by
  // this page and is simply not selected.
  let kit: {
    id: string;
    suggestedNames: string[];
    suggestedUsernames: string[];
    bio: string | null;
    profileDescription: string | null;
    brandVoice: string | null;
    audience: string | null;
    contentPillars: string[];
    initialHooks: string[];
    firstPosts: unknown;
    manualChecklist: unknown;
    visualDirection: string | null;
    origin: string;
  } | null = null;

  if (slot.accountLaunchKitId) {
    const [row] = await db
      .select({
        id: accountLaunchKits.id,
        suggestedNames: accountLaunchKits.suggestedNames,
        suggestedUsernames: accountLaunchKits.suggestedUsernames,
        bio: accountLaunchKits.bio,
        profileDescription: accountLaunchKits.profileDescription,
        brandVoice: accountLaunchKits.brandVoice,
        audience: accountLaunchKits.audience,
        contentPillars: accountLaunchKits.contentPillars,
        initialHooks: accountLaunchKits.initialHooks,
        firstPosts: accountLaunchKits.firstPosts,
        manualChecklist: accountLaunchKits.manualChecklist,
        origin: accountLaunchKits.origin,
      })
      .from(accountLaunchKits)
      .where(
        and(
          eq(accountLaunchKits.id, slot.accountLaunchKitId),
          eq(accountLaunchKits.workspaceId, context.workspaceId),
        ),
      )
      .limit(1);
    kit = row ? { ...row, visualDirection: null } : null;
  }

  const presentation = slotPresentation(slot.status);
  const mayConnect = can(context.role, "accounts.connect");
  const posts = parsePosts((kit?.firstPosts as Json | undefined) ?? null);
  const checklist = parseChecklist((kit?.manualChecklist as Json | undefined) ?? null);

  const plainText = kit
    ? renderPlainText({
        platform: PLATFORM_LABELS[slot.platform],
        slotNumber: slot.slotNumber,
        names: kit.suggestedNames,
        usernames: kit.suggestedUsernames,
        bio: kit.bio,
        description: kit.profileDescription,
        voice: kit.brandVoice,
        audience: kit.audience,
        visual: kit.visualDirection,
        pillars: kit.contentPillars,
        hooks: kit.initialHooks,
        posts,
        checklist,
      })
    : "";

  const planColumns: readonly Column<PlannedPost>[] = [
    {
      id: "position",
      header: "#",
      numeric: true,
      width: "3.5rem",
      cell: (row) => String(row.position).padStart(2, "0"),
    },
    {
      id: "title",
      header: "Post",
      cell: (row) => (
        <span className="font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {row.title}
        </span>
      ),
    },
    {
      id: "pillar",
      header: "Pillar",
      hideBelow: "lg",
      cell: (row) => row.pillar || "—",
    },
    {
      id: "hook",
      header: "Hook",
      hideBelow: "md",
      cell: (row) => row.hook || "—",
    },
  ];

  const identityFields = [
    { id: "bio", label: launchKitPage.sections.bio, value: kit?.bio ?? null },
    {
      id: "description",
      label: launchKitPage.sections.description,
      value: kit?.profileDescription ?? null,
    },
    { id: "voice", label: launchKitPage.sections.voice, value: kit?.brandVoice ?? null },
    { id: "audience", label: launchKitPage.sections.audience, value: kit?.audience ?? null },
    { id: "visual", label: launchKitPage.sections.visual, value: kit?.visualDirection ?? null },
  ].filter((field) => field.value !== null);

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={slot.displayLabel ?? PLATFORM_LABELS[slot.platform]}
          meta={[PLATFORM_LABELS[slot.platform], launchKitPage.slotLabel(slot.slotNumber)]}
          actions={
            <>
              {kit && (
                <LaunchKitExport
                  text={plainText}
                  filename={`virally-launch-kit-slot-${slot.slotNumber}.txt`}
                />
              )}
              <ButtonLink href="/app/accounts" variant="text">
                {launchPage.back}
              </ButtonLink>
            </>
          }
        />

        {/* State first, and the handoff with it. "Virally has prepared this
            account" has to arrive before a list of usernames implies one exists. */}
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <PlatformMark platform={slot.platform} />
              <HealthChip status={slot.status} />
            </div>

            {!slot.connectedAccountId && (
              <>
                <p className="mt-[var(--space-4)] text-[length:var(--text-app-body)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                  {launchKitPage.handoffTitle}
                </p>
                <p className="mt-1 max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                  {launchKitPage.handoffBody}
                </p>
              </>
            )}

            {presentation.requiredAction && (
              <p className="mt-[var(--space-3)] max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                {presentation.requiredAction}
              </p>
            )}

            {(mayConnect && slot.status === "launch_kit_ready") ||
            (can(context.role, "accounts.disconnect") && !slot.connectedAccountId) ? (
              <div className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]">
                {mayConnect && slot.status === "launch_kit_ready" && (
                  <form action={markAccountRegistered}>
                    <input type="hidden" name="slotId" value={slot.id} />
                    <Button type="submit" variant="primary">
                      {slotActions.markRegistered}
                    </Button>
                  </form>
                )}
                {can(context.role, "accounts.disconnect") && !slot.connectedAccountId && (
                  <form action={archiveAccountSlot}>
                    <input type="hidden" name="slotId" value={slot.id} />
                    <Button type="submit" variant="text">
                      {slotActions.archive}
                    </Button>
                  </form>
                )}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {(kit?.origin === "mock" || slot.internalNotes) && (
          <div className="flex flex-col gap-[var(--space-3)]">
            {/* Generated material is labelled when it came from the mock provider,
                the same rule every other generation surface follows. */}
            {kit?.origin === "mock" && (
              <AuthMessage
                tone="notice"
                title={launchKitPage.demoLabel}
                body={launchKitPage.demoExplanation}
              />
            )}
            {slot.internalNotes && <AuthMessage tone="error" body={slot.internalNotes} />}
          </div>
        )}

        {!kit ? (
          <Card>
            <EmptyState
              bare
              icon={<FileText size={20} strokeWidth={1.75} />}
              title={launchKitPage.notPreparedTitle}
              body={launchKitPage.notPreparedYet}
              actions={
                <ButtonLink href="/app/accounts" variant="secondary">
                  {launchPage.back}
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <DashGrid>
            <div className="flex min-w-0 flex-col gap-[var(--app-panel-gap)] lg:col-span-2 xl:col-span-8">
              <Card>
                <CardHeader as="h2" title={launchKitPage.sections.names} divided />
                <CardBody>
                  <ul className="flex flex-col gap-[var(--space-2)]">
                    {kit.suggestedNames.map((name) => (
                      <li
                        key={name}
                        className="text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  as="h2"
                  title={launchKitPage.sections.usernames}
                  // The availability caveat sits with the list, not in a footnote.
                  description={launchKitPage.sections.usernamesNote}
                  divided
                />
                <CardBody>
                  <ul className="flex flex-wrap gap-[var(--space-2)]">
                    {kit.suggestedUsernames.map((username) => (
                      <li
                        key={username}
                        className={cn(
                          "rounded-[var(--radius-chip)] bg-[var(--surface-muted)] px-2 py-1",
                          "app-figure text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]",
                        )}
                      >
                        {username}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>

              <Card>
                <CardHeader as="h2" title={launchKitPage.sections.pillars} divided />
                <CardBody>
                  <NumberedList items={kit.contentPillars} tone="primary" />
                </CardBody>
              </Card>

              <Card>
                <CardHeader as="h2" title={launchKitPage.sections.hooks} divided />
                <CardBody>
                  <NumberedList items={kit.initialHooks} tone="secondary" />
                </CardBody>
              </Card>

              {posts.length > 0 && (
                <Card>
                  <CardHeader as="h2" title={launchKitPage.sections.plan} divided />
                  {/* A real table: thirty rows of related values is tabular data,
                      and a list of divs would not be navigable by a screen
                      reader's table commands. */}
                  <CardBody pad="none">
                    <DataTable
                      caption={launchKitPage.planCaption}
                      columns={planColumns}
                      rows={posts}
                      rowKey={(row) => String(row.position)}
                    />
                  </CardBody>
                </Card>
              )}

              {checklist.length > 0 && (
                <Card>
                  <CardHeader
                    as="h2"
                    title={launchKitPage.sections.checklist}
                    description={launchKitPage.sections.checklistNote}
                    divided
                  />
                  <CardBody>
                    <ol className="flex flex-col gap-[var(--space-4)]">
                      {checklist.map((step) => (
                        <li key={step.step} className="flex gap-[var(--space-3)]">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "app-figure flex size-6 shrink-0 items-center justify-center",
                              "rounded-[var(--radius-full)] bg-[var(--surface-muted)]",
                              "text-[length:var(--text-app-label)] font-[var(--weight-heading)]",
                              "text-[color:var(--text-secondary)]",
                            )}
                          >
                            {step.step}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                              {step.label}
                            </p>
                            {step.detail && (
                              <p className="mt-1 max-w-[70ch] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                                {step.detail}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </CardBody>
                </Card>
              )}
            </div>

            {/* Identity rail. One card holding the fields a user copies out, rather
                than five cards of one paragraph each. */}
            {identityFields.length > 0 && (
              <div className="min-w-0 lg:col-span-2 xl:col-span-4">
                <Card>
                  <CardHeader as="h2" title={launchKitPage.sections.identity} divided />
                  <CardBody>
                    <dl className="flex flex-col gap-[var(--space-4)]">
                      {identityFields.map((field) => (
                        <div key={field.id}>
                          <dt className="text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]">
                            {field.label}
                          </dt>
                          <dd className="mt-1 text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                            {field.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CardBody>
                </Card>
              </div>
            )}
          </DashGrid>
        )}
      </PageStack>
    </AppPage>
  );
}

/** An ordered list whose index is a tabular rail, not a browser bullet. */
function NumberedList({
  items,
  tone,
}: {
  items: readonly string[];
  tone: "primary" | "secondary";
}) {
  return (
    <ol className="flex flex-col gap-[var(--space-2)]">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="flex gap-[var(--space-3)]">
          <span
            aria-hidden="true"
            className="app-figure shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={cn(
              "text-[length:var(--text-app-cell)]",
              tone === "primary"
                ? "text-[color:var(--text-primary)]"
                : "text-[color:var(--text-secondary)]",
            )}
          >
            {item}
          </span>
        </li>
      ))}
    </ol>
  );
}
