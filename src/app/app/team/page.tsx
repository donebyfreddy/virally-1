import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { Check, Clock, Users } from "lucide-react";
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
import { profiles } from "@/lib/db/schema";
import { organizationTeammates } from "@/lib/db/schema.fragment";
import { relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { CellThumb, DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { EmptyState } from "@/components/app-ui/States";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { Button } from "@/components/primitives/Button";
import { teamCopy } from "@/content/team";
import type { MemberRole, Permission } from "@/types/database";

export const metadata: Metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const countFormatter = new Intl.NumberFormat("en-US");

type TeammateRow = {
  userId: string | null;
  role: MemberRole | null;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  acceptedAt: Date | null;
};

type RoleRow = {
  role: MemberRole;
  permissions: readonly Permission[];
};

/**
 * Team.
 *
 * The roster is read from `organization_teammates`, and the filter on
 * `organizationId` below IS the isolation boundary: that view deliberately does
 * not reproduce the authorisation predicate its RLS-era ancestor carried, so an
 * unfiltered query would return every organisation's roster.
 *
 * Nothing here mutates. Role changes and removals both need an audited server
 * action that does not exist yet, so no row offers a control that would fail —
 * see `teamCopy.managementUnavailable`, which says so on the page rather than
 * leaving the absence to be inferred.
 */
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
      avatarUrl: organizationTeammates.avatarUrl,
      // The view predates the email column being needed on this screen and does
      // not expose it, so the profile it already joins is joined again here for
      // that one field rather than the view being widened.
      email: profiles.email,
      acceptedAt: organizationTeammates.acceptedAt,
    })
    .from(organizationTeammates)
    .leftJoin(profiles, eq(profiles.id, organizationTeammates.userId))
    .where(eq(organizationTeammates.organizationId, context.organizationId))
    // Active members first, then pending invitations: `accepted_at is null`
    // orders false before true. Grouping them is what makes an invitation read
    // as a different kind of row rather than as a member missing a join date.
    .orderBy(sql`${organizationTeammates.acceptedAt} is null`, asc(organizationTeammates.fullName));

  const pending = members.filter((row) => row.acceptedAt === null).length;
  const active = members.length - pending;

  const columns: readonly Column<TeammateRow>[] = [
    {
      id: "name",
      header: "Member",
      cell: (row) => (
        <PrimaryCell
          title={row.fullName ?? teamCopy.unnamedMember}
          detail={row.userId === context.user.id ? teamCopy.youLabel : undefined}
          leading={
            <CellThumb
              src={row.avatarUrl}
              alt=""
              fallback={row.fullName ?? row.email ?? "?"}
            />
          }
        />
      ),
    },
    {
      id: "email",
      header: "Email",
      hideBelow: "md",
      cell: (row) =>
        row.email ? (
          <span className="block truncate text-[color:var(--text-secondary)]">{row.email}</span>
        ) : (
          <NotReported />
        ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) =>
        row.role ? (
          <span className="whitespace-nowrap font-[var(--weight-strong)] text-[color:var(--text-primary)]">
            {ROLE_LABELS[row.role]}
          </span>
        ) : (
          <NotReported />
        ),
    },
    {
      id: "state",
      header: "Status",
      cell: (row) => <MembershipChip accepted={row.acceptedAt !== null} />,
    },
    {
      id: "joined",
      header: "Joined",
      hideBelow: "sm",
      cell: (row) =>
        row.acceptedAt ? (
          <span className="whitespace-nowrap text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {relativeDay(row.acceptedAt)}
          </span>
        ) : (
          <NotReported />
        ),
    },
  ];

  const roleRows: readonly RoleRow[] = ROLE_ORDER.map((role) => ({
    role,
    permissions: permissionsFor(role),
  }));

  const roleColumns: readonly Column<RoleRow>[] = [
    {
      id: "role",
      header: "Role",
      width: "18rem",
      cell: (row) => (
        <PrimaryCell
          title={ROLE_LABELS[row.role]}
          detail={row.role === context.role ? "Your role" : undefined}
        />
      ),
    },
    {
      id: "purpose",
      header: "What it is for",
      hideBelow: "md",
      cell: (row) => (
        <span className="block max-w-[36ch] text-[color:var(--text-secondary)]">
          {ROLE_DESCRIPTIONS[row.role]}
        </span>
      ),
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.permissions.map((permission) => (
            <span
              key={permission}
              className={cn(
                "whitespace-nowrap rounded-[var(--radius-chip)] bg-[var(--surface-muted)] px-1.5 py-0.5",
                "text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]",
              )}
            >
              {permission}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: "count",
      header: "Count",
      numeric: true,
      hideBelow: "sm",
      width: "5rem",
      cell: (row) => countFormatter.format(row.permissions.length),
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={teamCopy.title}
          description={teamCopy.body}
          meta={[context.organizationName, ROLE_LABELS[context.role]]}
          actions={
            // Disabled with a stated reason rather than hidden: inviting is a real
            // capability of this role, and it needs the transactional email path.
            <Button disabled title={teamCopy.inviteUnavailable}>
              {teamCopy.inviteLabel}
            </Button>
          }
        />

        <KpiGrid columns={3}>
          <KpiCard
            label={teamCopy.kpis.members}
            value={countFormatter.format(members.length)}
            icon={<Users size={14} strokeWidth={1.75} />}
          />
          <KpiCard
            label={teamCopy.kpis.active}
            value={countFormatter.format(active)}
            icon={<Check size={14} strokeWidth={1.75} />}
            tone={active > 0 ? "success" : "neutral"}
            detail={
              <span className="text-[color:var(--text-muted)]">Invitation accepted</span>
            }
          />
          <KpiCard
            label={teamCopy.kpis.pending}
            value={countFormatter.format(pending)}
            icon={<Clock size={14} strokeWidth={1.75} />}
            tone={pending > 0 ? "warning" : "neutral"}
            detail={
              pending > 0 ? (
                <span className="text-[color:var(--warning)]">Role assigned, no access yet</span>
              ) : (
                <span className="text-[color:var(--text-muted)]">Nothing outstanding</span>
              )
            }
          />
        </KpiGrid>

        <Card>
          <CardHeader
            as="h2"
            title={teamCopy.membersHeading}
            description={teamCopy.membersHint}
            divided
          />

          {members.length > 0 ? (
            <CardBody pad="none">
              <DataTable
                caption={teamCopy.tableCaption}
                columns={columns}
                rows={members}
                // The view can carry a null user id, so the id is not assumed to
                // exist. Falling back to the email keeps the key stable across
                // renders — `crypto.randomUUID()` would remount the row every
                // time the page re-rendered.
                rowKey={(row) => row.userId ?? row.email ?? row.fullName ?? "unknown"}
              />
            </CardBody>
          ) : (
            <EmptyState
              bare
              icon={<Users size={20} strokeWidth={1.75} />}
              title={teamCopy.empty.title}
              body={teamCopy.empty.body}
            />
          )}

          {/* One footer, not three. `CardFooter` rounds its own bottom corners,
              so stacking them would draw a rounded seam through the middle of
              the card. Both gated capabilities are stated in text rather than
              only in the disabled button's `title`: a disabled button is not
              focusable, so its tooltip is not reachable by keyboard. */}
          <CardFooter>
            <div className="flex flex-col gap-[var(--space-2)]">
              {pending > 0 && <p>{teamCopy.pendingHint(pending)}</p>}
              <p>{teamCopy.managementUnavailable}</p>
              <p>{teamCopy.inviteUnavailable}</p>
            </div>
          </CardFooter>
        </Card>

        {/* Roles and permissions, rendered from the real permission table rather
            than a hand-written list — so the page cannot describe a permission
            model the code does not implement. */}
        <section aria-labelledby="team-roles">
          <SectionHeader
            id="team-roles"
            title={teamCopy.rolesHeading}
            description={teamCopy.rolesHint}
          />
          <Card className="mt-[var(--space-4)]">
            <CardBody pad="none">
              <DataTable
                caption={teamCopy.rolesCaption}
                columns={roleColumns}
                rows={roleRows}
                rowKey={(row) => row.role}
              />
            </CardBody>
          </Card>
        </section>
      </PageStack>
    </AppPage>
  );
}

/**
 * Membership state.
 *
 * A pending invitation is a different kind of thing from a member, and this is
 * the cell that says which. Icon plus word, never colour alone, and amber rather
 * than teal: teal is the interactive accent in this product and a teal chip reads
 * as a button.
 */
function MembershipChip({ accepted }: { accepted: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] px-2 py-1",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        accepted
          ? "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]"
          : "bg-[var(--warning-soft)] text-[color:var(--warning)]",
      )}
    >
      {accepted ? (
        <Check aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
      ) : (
        <Clock aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
      )}
      {accepted ? teamCopy.statusActive : teamCopy.statusPending}
    </span>
  );
}

/**
 * A nullable value.
 *
 * An em dash with the reason in the accessible name. `profiles.email` and the
 * view's `role` are both nullable, and rendering either as an empty cell would
 * be indistinguishable from a rendering failure.
 */
function NotReported() {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not reported</span>
    </span>
  );
}
