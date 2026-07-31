import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  can,
  permissionsFor,
} from "@/lib/permissions";
import { db } from "@/lib/db";
import { organizationTeammates } from "@/lib/db/schema.fragment";
import { relativeDay } from "@/lib/format";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel, PanelSection } from "@/components/app-ui/Panel";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { EmptyState } from "@/components/app-ui/States";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { teamCopy } from "@/content/team";
import type { MemberRole } from "@/types/database";

export const metadata: Metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type TeammateRow = {
  userId: string | null;
  role: MemberRole | null;
  fullName: string | null;
  acceptedAt: Date | null;
};

export default async function TeamPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/team"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  // Server-side gate. Hiding the nav item is not access control.
  if (!can(context.role, "team.manage")) {
    return (
      <AppPage width="text">
        <AuthMessage
          tone="notice"
          title="Not available to your role"
          body="Managing the team requires the team.manage permission. You can see your own role in the account menu."
        />
      </AppPage>
    );
  }

  const members = await db
    .select({
      userId: organizationTeammates.userId,
      role: organizationTeammates.role,
      fullName: organizationTeammates.fullName,
      acceptedAt: organizationTeammates.acceptedAt,
    })
    .from(organizationTeammates)
    .where(eq(organizationTeammates.organizationId, context.organizationId))
    .orderBy(asc(organizationTeammates.fullName));

  const columns: readonly Column<TeammateRow>[] = [
    {
      id: "name",
      header: "Member",
      cell: (row) => (
        <PrimaryCell
          title={row.fullName ?? "Unnamed member"}
          detail={row.userId === context.user.id ? "You" : undefined}
        />
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) =>
        row.role ? (
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-primary)]">
            {ROLE_LABELS[row.role]}
          </span>
        ) : (
          <span className="text-[color:var(--color-text-muted)]">—</span>
        ),
    },
    {
      id: "state",
      header: "Status",
      hideBelow: "sm",
      cell: (row) =>
        // Icon-free but word-bearing: an invitation that has not been accepted is
        // a different thing from a member, and the table says which.
        row.acceptedAt ? (
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            Active
          </span>
        ) : (
          <Badge tone="warning">Invitation pending</Badge>
        ),
    },
    {
      id: "joined",
      header: "Joined",
      hideBelow: "md",
      cell: (row) => (
        <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {row.acceptedAt ? relativeDay(row.acceptedAt) : "—"}
        </span>
      ),
    },
  ];

  return (
    <AppPage>
      <PageHeader
        title={teamCopy.title}
        description={teamCopy.body}
        meta={[
          members.length === 1 ? "1 member" : `${members.length} members`,
          context.organizationName,
        ]}
        actions={
          // Disabled with a stated reason rather than hidden: inviting is a real
          // capability of this role, and it needs the transactional email path.
          <Button disabled title={teamCopy.inviteUnavailable}>
            {teamCopy.inviteLabel}
          </Button>
        }
      />

      <Panel className="mt-[var(--space-8)]">
        <PanelSection title="Members" id="team-members">
          {members.length > 0 ? (
            <DataTable
              caption="Members of this organisation"
              columns={columns}
              rows={members}
              rowKey={(row) => row.userId ?? crypto.randomUUID()}
            />
          ) : (
            <EmptyState title={teamCopy.empty.title} body={teamCopy.empty.body} />
          )}
        </PanelSection>

        <p className="mt-[var(--space-6)] border-t border-[var(--color-border-hairline)] pt-[var(--space-4)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
          {teamCopy.inviteUnavailable}
        </p>
      </Panel>

      {/* Roles and permissions, rendered from the real permission table rather
          than a hand-written list — so the page cannot describe a permission
          model the code does not implement. */}
      <Panel className="mt-[var(--space-6)]">
        <PanelSection title={teamCopy.rolesHeading} id="team-roles">
          <p className="prose-measure text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
            {teamCopy.rolesHint}
          </p>

          <ul className="mt-[var(--space-4)] flex flex-col gap-[var(--space-4)]">
            {ROLE_ORDER.map((role) => {
              const permissions = permissionsFor(role);
              return (
                <li
                  key={role}
                  className="border-t border-[var(--color-border-hairline)] pt-[var(--space-4)] first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-3)]">
                    <h3 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-primary)]">
                      {ROLE_LABELS[role]}
                    </h3>
                    <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                      {permissions.length} permissions
                    </span>
                  </div>

                  <p className="prose-measure mt-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                    {ROLE_DESCRIPTIONS[role]}
                  </p>

                  <ul className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-1)]">
                    {permissions.map((permission) => (
                      <li
                        key={permission}
                        className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-[var(--space-2)] py-0.5 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]"
                      >
                        {permission}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      </Panel>
    </AppPage>
  );
}
