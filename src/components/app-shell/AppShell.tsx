import type { ReactNode } from "react";
import { SkipLink } from "@/components/primitives/SkipLink";
import { displayName } from "@/lib/auth/session";
import type { TenantContext } from "@/lib/tenant/context";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { SwitcherOption } from "./Switcher";

/**
 * The authenticated shell.
 *
 * A server component: it holds no interactive state of its own, so the sidebar,
 * top bar and palette are the only client boundaries. Making the shell itself a
 * client component would pull every page's tree across the boundary with it.
 *
 * `h-dvh` with an internal scroll container rather than page scroll: the sidebar
 * and top bar must stay put while content scrolls, and this avoids the layout
 * shift a sticky header over a scrolling body produces on iOS.
 */
export function AppShell({
  context,
  unreadNotifications,
  creditsAvailable,
  creditsReserved,
  children,
}: {
  context: TenantContext;
  unreadNotifications: number;
  creditsAvailable: number;
  creditsReserved: number;
  children: ReactNode;
}) {
  const workspaceOptions: SwitcherOption[] = context.workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.name,
    // Only worth showing when the user spans more than one organisation —
    // otherwise it repeats the same string under every option.
    detail:
      new Set(context.workspaces.map((w) => w.organizationId)).size > 1
        ? workspace.organizationName
        : undefined,
  }));

  const brandOptions: SwitcherOption[] = context.brands.map((brand) => ({
    id: brand.id,
    label: brand.name,
    // The placeholder brand created at bootstrap is named after the user, which
    // would otherwise look like a configured brand.
    detail: brand.isPlaceholder ? "Needs setup" : undefined,
  }));

  return (
    // `theme-app` is what makes the authenticated surface light. It carries the
    // whole product token set — surfaces, the teal accent, the dense type scale —
    // and is scoped to this subtree so the marketing site stays cinematic and
    // dark. See styles/app-theme.css.
    <div className="theme-app flex min-h-dvh">
      <SkipLink />
      <Sidebar role={context.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          role={context.role}
          workspaces={workspaceOptions}
          brands={brandOptions}
          activeWorkspaceId={context.workspaceId}
          activeBrandId={context.brandId}
          userLabel={displayName(context.user) ?? "Account"}
          userEmail={context.user.email ?? ""}
          unreadNotifications={unreadNotifications}
          creditsAvailable={creditsAvailable}
          creditsReserved={creditsReserved}
        />

        {/* `min-w-0` on both this and the flex parent: without it a wide table or
            chart inside forces the whole shell wider and the page scrolls
            horizontally, which the 390px assertion forbids. */}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
