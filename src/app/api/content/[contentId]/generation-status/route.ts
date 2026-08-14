import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { tenantScope } from "@/lib/creative/scope";
import { loadGenerationStatusView } from "@/lib/content/generationStatus";

/**
 * The lightweight poll target for an active generation.
 *
 * `ContentGenerationState` (the client component shown while a content item
 * is not yet `ready`) hits this every few seconds instead of calling
 * `router.refresh()`. A `refresh()` re-runs the ENTIRE server component —
 * session, tenant bootstrap, every query the ready-state editor would also
 * need — for what is, most of the time, "did a job's status change". This
 * route answers exactly that question and nothing else.
 *
 * Session and tenant resolution still happen on every call, same as the page
 * itself, because there is no cheaper way to authorise a workspace-scoped
 * read — but `resolveTenantContext`'s bootstrap step is now a single-query
 * fast path for a tenant that already exists (see `bootstrapTenant`), so this
 * is not paying the ~10-round-trip cost the page used to pay on every poll.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  const { contentId } = await params;

  const session = await readSession();
  if (session.status !== "authenticated") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") {
    return NextResponse.json({ error: "This workspace is not ready yet." }, { status: 403 });
  }

  const scope = tenantScope(resolution.context.organizationId, resolution.context.workspaceId);
  const view = await loadGenerationStatusView(scope, contentId);
  if (!view) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json(view);
}
