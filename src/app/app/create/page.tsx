import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { Composer } from "@/components/create/Composer";
import { createCopy, demoNotice } from "@/content/create";
import { and, count, eq, isNull } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { connectedAccounts } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { isMockOnly } from "@/lib/ai/registry";
import { createCampaign } from "@/lib/content/actions";
import { signInPathFor } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Create",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ERROR_COPY: Readonly<Record<string, string>> = {
  prompt: "Write a brief of at least ten characters before continuing.",
  invalid: "That combination of options is not valid. The panel on the right explains why.",
  unconfirmed:
    "That batch needs explicit confirmation before it can render. Tick the confirmation box, or choose a cheaper stage.",
  save: "The campaign could not be saved. Nothing was generated and no credits were used. Try again.",
  permission: "Your role does not include creating content.",
};

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/app/create"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  const { context } = resolution;
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;

  // Server-side gate, not just a hidden nav item.
  if (!can(context.role, "content.create")) {
    return (
      <div className="mx-auto w-full max-w-[var(--container-text)] px-[var(--gutter)] py-16">
        <AuthMessage
          tone="notice"
          title="NOT AVAILABLE TO YOUR ROLE"
          body="Creating content requires the content.create permission. Your role can review and analyse, but not author. An administrator can change this from the Team page."
        />
      </div>
    );
  }

  // Real count, so the plan's publishing-job figure is honest rather than assumed.
  const [{ value: accountCount }] = await db
    .select({ value: count() })
    .from(connectedAccounts)
    .where(
      and(eq(connectedAccounts.workspaceId, context.workspaceId), isNull(connectedAccounts.disconnectedAt)),
    );

  const [brand] = context.brandId
    ? await db
        .select({ primaryLanguage: brands.primaryLanguage })
        .from(brands)
        .where(and(eq(brands.id, context.brandId), eq(brands.workspaceId, context.workspaceId)))
        .limit(1)
    : [null];

  return (
    <div className="mx-auto w-full max-w-[var(--container-wide)] px-[var(--gutter)] py-12">
      <header className="max-w-[46rem]">
        <Eyebrow>{createCopy.eyebrow}</Eyebrow>
        <h1 className="font-display mt-3 text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          {createCopy.heading}
        </h1>
        <p className="prose-measure mt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
          {createCopy.body}
        </p>
      </header>

      {errorCode && ERROR_COPY[errorCode] && (
        <div className="mt-8 max-w-[46rem]">
          <AuthMessage tone="error" body={ERROR_COPY[errorCode]} />
        </div>
      )}

      {/* Stated before the user spends anything, not after they see the output. */}
      {isMockOnly() && (
        <div className="mt-8 max-w-[46rem]">
          <AuthMessage tone="notice" title={demoNotice.title} body={demoNotice.body} />
        </div>
      )}

      <div className="mt-12">
        <Composer
          onSubmit={createCampaign}
          accountCount={accountCount}
          defaultLanguage={brand?.primaryLanguage ?? "en"}
        />
      </div>
    </div>
  );
}
