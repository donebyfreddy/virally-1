import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Eyebrow, Rule } from "@/components/primitives/Eyebrow";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { LaunchKitExport } from "@/components/accounts/LaunchKitExport";
import { and, eq } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { accountSlots } from "@/lib/db/schema";
import { accountLaunchKits } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { archiveAccountSlot, markAccountRegistered } from "@/lib/accounts/actions";
import { slotPresentation } from "@/lib/accounts/slots";
import { PLATFORM_LABELS, launchKitPage, launchPage, slotActions } from "@/content/accounts";
import type { Json } from "@/types/database";

export const metadata: Metadata = {
  title: "Launch kit",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SECTION_HEADING =
  "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]";

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
 */
export default async function SlotDetailPage({
  params,
}: {
  params: Promise<{ slotId: string }>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  const { slotId } = await params;
  if (session.status === "anonymous") redirect(signInPathFor(`/app/accounts/${slotId}`));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");
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
  // pre-existing gap in the Drizzle schema (not introduced by this
  // conversion) — `visualDirection` is rendered as null below until the
  // schema is extended to match; `status` was unused by this page and is
  // simply not selected.
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

  return (
    <div className="mx-auto w-full max-w-[var(--container-wide)] px-[var(--gutter)] py-12">
      <header>
        <Eyebrow>{launchKitPage.eyebrow}</Eyebrow>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="font-display text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
            {slot.displayLabel ?? PLATFORM_LABELS[slot.platform]}
          </h1>
          <span className="font-utility text-[length:var(--text-utility)] tabular-nums text-[color:var(--color-text-muted)]">
            SLOT {String(slot.slotNumber).padStart(2, "0")}
          </span>
          <Badge tone={presentation.tone}>{presentation.label}</Badge>
        </div>
        <p className="mt-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          {PLATFORM_LABELS[slot.platform]}
        </p>
      </header>

      {/* The handoff, stated before any of the generated material. */}
      {!slot.connectedAccountId ? (
        <div className="mt-8 max-w-[46rem] border-l-2 border-[var(--color-action)] pl-4">
          <p className="text-[length:var(--text-body-l)] text-[color:var(--color-text-primary)]">
            {launchKitPage.handoffTitle}
          </p>
          <p className="prose-measure mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
            {launchKitPage.handoffBody}
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex max-w-[46rem] flex-col gap-3">
        {kit?.origin === "mock" ? (
          <AuthMessage
            tone="notice"
            title={launchKitPage.demoLabel}
            body={launchKitPage.demoExplanation}
          />
        ) : null}
        {slot.internalNotes ? <AuthMessage tone="error" body={slot.internalNotes} /> : null}
      </div>

      {!kit ? (
        <>
          <Rule className="my-10" />
          <p className="prose-measure text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
            {launchKitPage.notPreparedYet}
          </p>
        </>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap gap-2">
            <LaunchKitExport
              text={plainText}
              filename={`virally-launch-kit-slot-${slot.slotNumber}.txt`}
            />
          </div>

          <Rule className="my-10" />

          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-10">
              <section aria-labelledby="names">
                <h2 id="names" className={SECTION_HEADING}>
                  {launchKitPage.sections.names}
                </h2>
                <ul className="mt-3 flex flex-col gap-1">
                  {kit.suggestedNames.map((name) => (
                    <li key={name} className="text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                      {name}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="usernames">
                <h2 id="usernames" className={SECTION_HEADING}>
                  {launchKitPage.sections.usernames}
                </h2>
                {/* The availability caveat sits with the list, not in a footnote. */}
                <p className="prose-measure mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                  {launchKitPage.sections.usernamesNote}
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {kit.suggestedUsernames.map((username) => (
                    <li
                      key={username}
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)] px-3 py-1.5 font-utility text-[length:var(--text-utility)] text-[color:var(--color-text-secondary)]"
                    >
                      {username}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="pillars">
                <h2 id="pillars" className={SECTION_HEADING}>
                  {launchKitPage.sections.pillars}
                </h2>
                <ol className="mt-3 flex flex-col gap-1">
                  {kit.contentPillars.map((pillar, index) => (
                    <li key={pillar} className="flex gap-3 text-[length:var(--text-body-s)]">
                      <span className="font-utility tabular-nums text-[color:var(--color-text-muted)]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[color:var(--color-text-primary)]">{pillar}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-labelledby="hooks">
                <h2 id="hooks" className={SECTION_HEADING}>
                  {launchKitPage.sections.hooks}
                </h2>
                <ol className="mt-3 flex flex-col gap-1">
                  {kit.initialHooks.map((hook, index) => (
                    <li key={`${index}-${hook}`} className="flex gap-3 text-[length:var(--text-body-s)]">
                      <span className="font-utility tabular-nums text-[color:var(--color-text-muted)]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[color:var(--color-text-secondary)]">{hook}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {posts.length > 0 ? (
                <section aria-labelledby="plan">
                  <h2 id="plan" className={SECTION_HEADING}>
                    {launchKitPage.sections.plan}
                  </h2>
                  {/* A real table: thirty rows of two related values is tabular data,
                      and a list of divs would not be navigable by a screen reader's
                      table commands. */}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <caption className="sr-only">
                        The first thirty posts, with the content pillar and opening hook for each.
                      </caption>
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            className="border-b border-[var(--color-border-hairline)] pb-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]"
                          >
                            #
                          </th>
                          <th
                            scope="col"
                            className="border-b border-[var(--color-border-hairline)] pb-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]"
                          >
                            Post
                          </th>
                          <th
                            scope="col"
                            className="border-b border-[var(--color-border-hairline)] pb-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]"
                          >
                            Hook
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {posts.map((post) => (
                          <tr key={post.position}>
                            <td className="border-b border-[var(--color-border-hairline)] py-2 pr-4 align-top font-utility text-[length:var(--text-utility)] tabular-nums text-[color:var(--color-text-muted)]">
                              {String(post.position).padStart(2, "0")}
                            </td>
                            <td className="border-b border-[var(--color-border-hairline)] py-2 pr-4 align-top text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                              {post.title}
                            </td>
                            <td className="border-b border-[var(--color-border-hairline)] py-2 align-top text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                              {post.hook}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {checklist.length > 0 ? (
                <section aria-labelledby="checklist">
                  <h2 id="checklist" className={SECTION_HEADING}>
                    {launchKitPage.sections.checklist}
                  </h2>
                  <p className="prose-measure mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                    {launchKitPage.sections.checklistNote}
                  </p>
                  <ol className="mt-4 flex flex-col gap-4">
                    {checklist.map((step) => (
                      <li key={step.step} className="flex gap-4">
                        <span className="font-utility text-[length:var(--text-utility)] tabular-nums text-[color:var(--color-text-muted)]">
                          {String(step.step).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                            {step.label}
                          </p>
                          {step.detail ? (
                            <p className="prose-measure mt-1 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                              {step.detail}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>

            {/* Metadata rail. The asymmetric grid is deliberate — a metadata column
                against wide content, rather than another equal-width card row. */}
            <aside className="flex flex-col gap-8">
              {kit.bio ? (
                <section aria-labelledby="bio">
                  <h2 id="bio" className={SECTION_HEADING}>
                    {launchKitPage.sections.bio}
                  </h2>
                  <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                    {kit.bio}
                  </p>
                </section>
              ) : null}

              {kit.profileDescription ? (
                <section aria-labelledby="description">
                  <h2 id="description" className={SECTION_HEADING}>
                    {launchKitPage.sections.description}
                  </h2>
                  <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                    {kit.profileDescription}
                  </p>
                </section>
              ) : null}

              {kit.brandVoice ? (
                <section aria-labelledby="voice">
                  <h2 id="voice" className={SECTION_HEADING}>
                    {launchKitPage.sections.voice}
                  </h2>
                  <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                    {kit.brandVoice}
                  </p>
                </section>
              ) : null}

              {kit.audience ? (
                <section aria-labelledby="audience">
                  <h2 id="audience" className={SECTION_HEADING}>
                    {launchKitPage.sections.audience}
                  </h2>
                  <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                    {kit.audience}
                  </p>
                </section>
              ) : null}

              {kit.visualDirection ? (
                <section aria-labelledby="visual">
                  <h2 id="visual" className={SECTION_HEADING}>
                    {launchKitPage.sections.visual}
                  </h2>
                  <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                    {kit.visualDirection}
                  </p>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      )}

      <Rule className="my-10" />

      <div className="flex flex-wrap gap-3">
        {mayConnect && slot.status === "launch_kit_ready" ? (
          <form action={markAccountRegistered}>
            <input type="hidden" name="slotId" value={slot.id} />
            <Button type="submit" variant="primary">
              {slotActions.markRegistered}
            </Button>
          </form>
        ) : null}

        {can(context.role, "accounts.disconnect") && !slot.connectedAccountId ? (
          <form action={archiveAccountSlot}>
            <input type="hidden" name="slotId" value={slot.id} />
            <Button type="submit" variant="text">
              {slotActions.archive}
            </Button>
          </form>
        ) : null}

        <ButtonLink href="/app/accounts" variant="secondary">
          {launchPage.back}
        </ButtonLink>
      </div>
    </div>
  );
}
