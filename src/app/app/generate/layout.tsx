import type { ReactNode } from "react";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { StudioNav } from "@/components/generate/StudioNav";

/**
 * The generation shell.
 *
 * Owns the page container, the vertical rhythm and the capability nav, so the
 * five routes below it render only their own content. It deliberately does NOT
 * authenticate: each page re-establishes the session and the tenant for itself,
 * because a layout that gated its children would be authorisation in a place
 * that does not run on a server action or a direct fetch.
 */
export const dynamic = "force-dynamic";

export default function GenerateLayout({ children }: { children: ReactNode }) {
  return (
    <AppPage>
      <PageStack>
        <StudioNav />
        {children}
      </PageStack>
    </AppPage>
  );
}
