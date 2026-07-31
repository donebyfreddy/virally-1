import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowRight, Bell, Building2, Palette, Sliders, Sparkles, UserRound } from "lucide-react";
import { readSession, displayName } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { ROLE_LABELS } from "@/lib/permissions";
import { db } from "@/lib/db";
import { brands, profiles } from "@/lib/db/schema";
import { isMockOnly } from "@/lib/ai/registry";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/app-ui/Card";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { settingsCopy, SETTINGS_GROUPS } from "@/content/settings";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const countFormatter = new Intl.NumberFormat("en-US");

/** The order the schema's own default lists them in, so the card reads stably. */
const NOTIFICATION_ORDER = [
  "job_failed",
  "approval_required",
  "publish_failed",
  "usage_warning",
  "weekly_digest",
] as const;

/**
 * Settings.
 *
 * Grouped cards rather than one long form, and — importantly — read-only.
 *
 * That is not a styling decision. There is no settings server action in this
 * repo: nothing writes a workspace name, a brand, a locale or a notification
 * preference, so there is no `action` a form here could point at and no
 * validation path to preserve. Rendering labelled inputs with a per-section
 * "Save" that discarded its values would be the worst possible version of this
 * screen — so every value is a stated fact, and each group names the dependency
 * that gates its write path.
 *
 * The one preference that does have a write path — the active workspace and
 * brand — is already owned by the switcher in the top bar (`switchWorkspace` /
 * `switchBrand` in src/lib/tenant/actions.ts). It is not duplicated here: a
 * second control writing the same cookie is a second thing to keep in step, and
 * the switcher is where a user already looks for it.
 *
 * No permission gate, deliberately and as before: everything on this page is
 * either the viewer's own profile or a name they can already read from the shell.
 */
export default async function SettingsPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/settings"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  // Two independent reads, one round trip. The brand query is skipped entirely
  // when no brand is selected rather than issued and discarded.
  const [brandRows, profileRows] = await Promise.all([
    context.brandId
      ? db
          .select({
            name: brands.name,
            primaryLanguage: brands.primaryLanguage,
          })
          .from(brands)
          .where(and(eq(brands.id, context.brandId), eq(brands.workspaceId, context.workspaceId)))
          .limit(1)
      : Promise.resolve([]),

    db
      .select({
        locale: profiles.locale,
        timezone: profiles.timezone,
        notificationPreferences: profiles.notificationPreferences,
      })
      .from(profiles)
      .where(eq(profiles.id, context.user.id))
      .limit(1),
  ]);

  const brand = brandRows[0];
  const profile = profileRows[0];
  const notifications = readNotificationPreferences(profile?.notificationPreferences);

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={settingsCopy.title}
          description={settingsCopy.body}
          meta={[context.organizationName, context.workspaceName, ROLE_LABELS[context.role]]}
        />

        {/* Stated once, at the top, rather than repeated on every card. A user who
            came here to change something needs to know that in one line. */}
        <div className="max-w-[46rem]">
          <AuthMessage
            tone="notice"
            title={settingsCopy.readOnlyTitle}
            body={settingsCopy.readOnlyBody}
          />
        </div>

        <div className="grid gap-[var(--app-panel-gap)] xl:grid-cols-2">
          <SettingsCard
            id="settings-profile"
            title={settingsCopy.profileHeading}
            description={settingsCopy.profileHint}
            icon={<UserRound size={14} strokeWidth={1.75} />}
          >
            <SettingList>
              <SettingRow label={settingsCopy.nameLabel} value={displayName(context.user)} />
              <SettingRow label={settingsCopy.emailLabel} value={context.user.email} />
              <SettingRow label={settingsCopy.roleLabel} value={ROLE_LABELS[context.role]} />
            </SettingList>
          </SettingsCard>

          <SettingsCard
            id="settings-preferences"
            title={settingsCopy.preferencesHeading}
            description={settingsCopy.preferencesHint}
            icon={<Sliders size={14} strokeWidth={1.75} />}
            footer={settingsCopy.preferencesGate}
          >
            <SettingList>
              <SettingRow label={settingsCopy.localeLabel} value={profile?.locale ?? null} />
              <SettingRow label={settingsCopy.timezoneLabel} value={profile?.timezone ?? null} />
            </SettingList>
          </SettingsCard>

          <SettingsCard
            id="settings-organisation"
            title={settingsCopy.organisationHeading}
            description={settingsCopy.organisationHint}
            icon={<Building2 size={14} strokeWidth={1.75} />}
          >
            <SettingList>
              <SettingRow
                label={settingsCopy.organisationLabel}
                value={context.organizationName}
              />
              <SettingRow label={settingsCopy.workspaceLabel} value={context.workspaceName} />
              <SettingRow
                label={settingsCopy.workspaceCountLabel}
                value={countFormatter.format(context.workspaces.length)}
              />
            </SettingList>
          </SettingsCard>

          <SettingsCard
            id="settings-brand"
            title={settingsCopy.brandHeading}
            description={settingsCopy.brandHint}
            icon={<Palette size={14} strokeWidth={1.75} />}
            action={<CardLink href="/app/accounts">Accounts</CardLink>}
          >
            {brand ? (
              <SettingList>
                <SettingRow label={settingsCopy.activeBrandLabel} value={brand.name} />
                <SettingRow
                  label={settingsCopy.brandLanguageLabel}
                  value={brand.primaryLanguage.toUpperCase()}
                />
                <SettingRow
                  label={settingsCopy.brandCountLabel}
                  value={countFormatter.format(context.brands.length)}
                />
              </SettingList>
            ) : (
              <p className="max-w-[52ch] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
                {settingsCopy.noBrand}
              </p>
            )}
          </SettingsCard>

          {/* Generation is the one group whose state is genuinely actionable
              today, because a missing provider key changes what the product
              does rather than only what it stores. */}
          <SettingsCard
            id="settings-generation"
            title={settingsCopy.generationHeading}
            description={settingsCopy.generationHint}
            icon={<Sparkles size={14} strokeWidth={1.75} />}
            footer={isMockOnly() ? settingsCopy.providerMock : settingsCopy.providerConfigured}
          >
            <SettingList>
              <SettingRow
                label={settingsCopy.providerLabel}
                value={
                  isMockOnly()
                    ? settingsCopy.providerMockValue
                    : settingsCopy.providerConfiguredValue
                }
                tone={isMockOnly() ? "warning" : "default"}
              />
            </SettingList>
          </SettingsCard>

          {/* Anchor target for the top bar's notification bell, so the bell lands
              on a card that reports real stored preferences rather than on a
              paragraph about them. */}
          <SettingsCard
            id="notifications"
            title={settingsCopy.notificationsHeading}
            description={settingsCopy.notificationsHint}
            icon={<Bell size={14} strokeWidth={1.75} />}
            footer={settingsCopy.notificationsGate}
            className="scroll-mt-[var(--space-24)]"
          >
            {notifications.length > 0 ? (
              <SettingList>
                {notifications.map((entry) => (
                  <SettingRow
                    key={entry.key}
                    label={settingsCopy.notificationLabels[entry.key] ?? entry.key}
                    value={
                      entry.enabled === null
                        ? null
                        : entry.enabled
                          ? settingsCopy.notificationOn
                          : settingsCopy.notificationOff
                    }
                    tone={entry.enabled === false ? "muted" : "default"}
                  />
                ))}
              </SettingList>
            ) : (
              <p className="max-w-[52ch] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
                {settingsCopy.notificationsEmpty}
              </p>
            )}
          </SettingsCard>
        </div>

        {/* The remaining groups, each stating what it will hold and what gates
            it. Listed rather than omitted so the page is a complete map of the
            settings surface rather than only the parts that happen to be done. */}
        <section aria-labelledby="settings-pending">
          <SectionHeader
            id="settings-pending"
            title={settingsCopy.pendingHeading}
            description={settingsCopy.pendingHint}
          />
          <ul className="mt-[var(--space-4)] grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-3">
            {SETTINGS_GROUPS.map((group) => (
              <li key={group.id}>
                <Card as="article" pad="default" className="flex h-full flex-col">
                  <h3 className="app-card-title text-[color:var(--text-primary)]">{group.label}</h3>
                  <p className="mt-[var(--space-2)] flex-1 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                    {group.holds}
                  </p>
                  <p
                    className={cn(
                      "mt-[var(--space-3)] inline-flex w-fit items-center rounded-[var(--radius-chip)]",
                      "bg-[var(--surface-muted)] px-2 py-0.5",
                      "text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]",
                    )}
                  >
                    {group.gate}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </PageStack>
    </AppPage>
  );
}

/* ==========================================================================
   SMALL PARTS
   ======================================================================== */

/**
 * One settings group.
 *
 * A `Card` with a titled header and a `<dl>` body. The definition list is the
 * right element even though nothing is editable: a label/value set IS a
 * definition list, and it gives assistive technology the pairing for free —
 * which a stack of divs would have to reimplement.
 */
function SettingsCard({
  id,
  title,
  description,
  icon,
  action,
  footer,
  className,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  footer?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      as="section"
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("flex min-w-0 flex-col", className)}
    >
      <CardHeader
        as="h2"
        id={`${id}-title`}
        title={title}
        description={description}
        divided
        action={
          <>
            {action}
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--surface-muted)] text-[color:var(--text-secondary)]"
            >
              {icon}
            </span>
          </>
        }
      />
      <CardBody className="flex-1">{children}</CardBody>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}

/**
 * The rows of one group.
 *
 * A separate component rather than a `<dl>` inside `SettingsCard`, because two
 * groups render a sentence instead of rows when there is nothing to state — and a
 * `<p>` is not a permitted child of `<dl>`.
 */
function SettingList({ children }: { children: React.ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

/**
 * One label/value pair.
 *
 * Rendered as text, not as a disabled input. A greyed-out text field still looks
 * like something you should be able to type in, whereas a stated value reads
 * correctly as information — and there is no action behind it to type into.
 */
function SettingRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | null;
  tone?: "default" | "muted" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-[var(--space-3)]",
        "border-t border-[var(--border-subtle)] py-[var(--space-2)] first:border-t-0 first:pt-0",
      )}
    >
      <dt className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          "app-figure min-w-0 truncate text-[length:var(--text-app-cell)]",
          tone === "warning" && "font-[var(--weight-strong)] text-[color:var(--warning)]",
          tone === "muted" && "text-[color:var(--text-muted)]",
          tone === "default" && "font-[var(--weight-strong)] text-[color:var(--text-primary)]",
        )}
      >
        {value ?? <NotReported />}
      </dd>
    </div>
  );
}

/** A nullable value: an em dash, with the reason in the accessible name. */
function NotReported() {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not reported</span>
    </span>
  );
}

/** A card's trailing link. Teal, small, and never a button — it navigates. */
function CardLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-chip)]",
        "text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:text-[color:var(--brand-primary-hover)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
      )}
    >
      {children}
      <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
    </Link>
  );
}

/**
 * Reads the stored notification preferences.
 *
 * The column is `jsonb`, so its shape is not guaranteed by the type system: a
 * row written by an older deployment can hold keys this build does not know, and
 * a value that is not a boolean. Known keys are listed first in the schema's own
 * order, then anything unrecognised, and a non-boolean value reports as not
 * reported rather than being coerced — coercing it would state a preference the
 * user never expressed.
 */
function readNotificationPreferences(
  raw: unknown,
): readonly { key: string; enabled: boolean | null }[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];

  const record = raw as Record<string, unknown>;
  const known = NOTIFICATION_ORDER.filter((key) => key in record);
  const extra = Object.keys(record).filter(
    (key) => !(NOTIFICATION_ORDER as readonly string[]).includes(key),
  );

  return [...known, ...extra].map((key) => {
    const value = record[key];
    return { key, enabled: typeof value === "boolean" ? value : null };
  });
}
