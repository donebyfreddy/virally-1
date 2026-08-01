import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { PRODUCT_HOME, signInPathFor } from "@/lib/auth/routes";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { tenantScope } from "@/lib/creative/scope";
import { studioById } from "@/content/generate";
import { loadStudioData } from "@/components/generate/data";
import { StudioScreen } from "@/components/generate/StudioScreen";

export const metadata: Metadata = {
  title: "Audio studio",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Audio studio.
 *
 * A server component that establishes the session and the tenant, loads
 * everything in one round trip, and hands it to a shared screen. The only
 * client boundary is the composer and the live queue inside `StudioShell`.
 *
 * The permission is checked here as well as in the action. Passing
 * `canGenerate` to the form disables a control the user cannot use and says
 * why; `startGenerationAction` re-checks it server-side, because hiding a
 * button is not authorisation.
 */
export default async function AudioStudioPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/generate/audio"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);
  const { context } = resolution;

  const studio = studioById("audio");
  const data = await loadStudioData(
    tenantScope(context.organizationId, context.workspaceId),
    studio,
  );

  return (
    <StudioScreen
      studio={studio}
      data={data}
      canGenerate={can(context.role, "content.create")}
      workspaceName={context.workspaceName}
    />
  );
}
