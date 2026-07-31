import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { readSession, displayName } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { ROLE_LABELS } from "@/lib/permissions";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { isMockOnly } from "@/lib/ai/registry";
import { cn } from "@/lib/cn";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel, PanelSection } from "@/components/app-ui/Panel";
import { Badge } from "@/components/primitives/Badge";
import { settingsCopy, SETTINGS_GROUPS } from "@/content/settings";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Settings.
 *
 * Grouped panels rather than one long form, and — importantly — read-only. Every
 * value shown is real and read from the database or the environment; nothing here
 * writes yet, because each group's write path is a separate server action with its
 * own validation and audit entry.
 *
 * Presenting editable-looking inputs that discard their values on submit would be
 * the worst possible version of this page, so the fields are rendered as stated
 * values with each group naming what will make it editable.
 */
export default async function SettingsPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/settings"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  const brandRows = context.brandId
    ? await db
        .select({
          name: brands.name,
          primaryLanguage: brands.primaryLanguage,
        })
        .from(brands)
        .where(and(eq(brands.id, context.brandId), eq(brands.workspaceId, context.workspaceId)))
        .limit(1)
    : [];

  const brand = brandRows[0];

  return (
    <AppPage>
      <PageHeader
        eyebrow={settingsCopy.eyebrow}
        title={settingsCopy.title}
        description={settingsCopy.body}
        meta={[context.organizationName, context.workspaceName, ROLE_LABELS[context.role]]}
      />

      <div className="mt-[var(--space-8)] grid gap-[var(--space-6)] xl:grid-cols-2">
        {/* Profile — real values from the session. */}
        <Panel className="min-w-0">
          <PanelSection title="Profile" id="settings-profile">
            <SettingList>
              <SettingRow label="Name" value={displayName(context.user) ?? "Not set"} />
              <SettingRow label="Email" value={context.user.email ?? "Not set"} />
              <SettingRow label="Role" value={ROLE_LABELS[context.role]} />
            </SettingList>
          </PanelSection>
        </Panel>

        {/* Organisation and workspace. */}
        <Panel className="min-w-0">
          <PanelSection title="Organisation" id="settings-organisation">
            <SettingList>
              <SettingRow label="Organisation" value={context.organizationName} />
              <SettingRow label="Workspace" value={context.workspaceName} />
              <SettingRow
                label="Workspaces"
                value={String(context.workspaces.length)}
              />
            </SettingList>
          </PanelSection>
        </Panel>

        {/* Brand. */}
        <Panel className="min-w-0">
          <PanelSection
            title="Brand"
            id="settings-brand"
            aside={
              <Link
                href="/app/accounts"
                className="rounded-[var(--radius-sm)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)] transition-colors duration-[var(--dur-instant)] hover:text-[color:var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                Accounts
              </Link>
            }
          >
            {brand ? (
              <SettingList>
                <SettingRow label="Active brand" value={brand.name} />
                <SettingRow
                  label="Primary language"
                  value={brand.primaryLanguage.toUpperCase()}
                />
                <SettingRow label="Brands in workspace" value={String(context.brands.length)} />
              </SettingList>
            ) : (
              <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                {settingsCopy.noBrand}
              </p>
            )}
          </PanelSection>
        </Panel>

        {/* Generation — the one group whose state is genuinely actionable today,
            because a missing provider key changes what the product does. */}
        <Panel className="min-w-0">
          <PanelSection title="Generation" id="settings-generation">
            <SettingList>
              <SettingRow
                label="Language provider"
                value={isMockOnly() ? "Mock (no key configured)" : "Configured"}
                adornment={isMockOnly() ? <Badge tone="warning">Demo</Badge> : undefined}
              />
            </SettingList>
            <p className="mt-[var(--space-4)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
              {isMockOnly() ? settingsCopy.providerMock : settingsCopy.providerConfigured}
            </p>
          </PanelSection>
        </Panel>
      </div>

      {/* The remaining groups, each stating what it will hold and what gates it.
          Listed rather than omitted so the page is a complete map of the
          settings surface rather than only the parts that happen to be done. */}
      <Panel className="mt-[var(--space-6)]">
        <PanelSection title={settingsCopy.pendingHeading} id="settings-pending">
          <p className="prose-measure text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
            {settingsCopy.pendingHint}
          </p>

          <ul className="mt-[var(--space-4)] grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
            {SETTINGS_GROUPS.map((group) => (
              <li
                key={group.id}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)] p-[var(--space-4)]"
              >
                <h3 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-primary)]">
                  {group.label}
                </h3>
                <p className="mt-[var(--space-2)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
                  {group.holds}
                </p>
                <p className="mt-[var(--space-2)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                  {group.gate}
                </p>
              </li>
            ))}
          </ul>
        </PanelSection>
      </Panel>

      {/* Anchor target for the top bar's notification bell. */}
      <Panel id="notifications" className="mt-[var(--space-6)] scroll-mt-[var(--space-24)]">
        <PanelSection title="Notifications" id="settings-notifications">
          <p className="prose-measure text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
            {settingsCopy.notifications}
          </p>
        </PanelSection>
      </Panel>
    </AppPage>
  );
}

function SettingList({ children }: { children: React.ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

/**
 * One label/value pair.
 *
 * Rendered as text rather than a disabled input. A greyed-out text field still
 * looks like a field a user should be able to type in, whereas a stated value
 * reads correctly as information.
 */
function SettingRow({
  label,
  value,
  adornment,
}: {
  label: string;
  value: string;
  adornment?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-[var(--space-3)]",
        "border-t border-[var(--color-border-hairline)] py-[var(--space-3)] first:border-t-0 first:pt-0",
      )}
    >
      <dt className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-[var(--space-2)]">
        <span className="truncate text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
          {value}
        </span>
        {adornment}
      </dd>
    </div>
  );
}
