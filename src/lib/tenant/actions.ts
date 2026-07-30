"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands, workspaces } from "@/lib/db/schema";
import { isWorkspaceMember } from "@/lib/db/authorization";
import { readSession } from "@/lib/auth/session";
import { BRAND_COOKIE, WORKSPACE_COOKIE } from "./context";

/**
 * Workspace and brand switching.
 *
 * The selection is a cookie, but it is never trusted on write either: the id
 * is verified against the user's actual membership before being stored (see
 * src/lib/db/authorization.ts — there is no RLS to fall back on if this
 * check were skipped).
 */

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // Thirty days. A workspace preference is not security-sensitive, but it is
  // also not worth keeping forever after someone leaves an organisation.
  maxAge: 60 * 60 * 24 * 30,
  secure: process.env.NODE_ENV === "production",
};

export async function switchWorkspace(workspaceId: string): Promise<void> {
  const session = await readSession();
  if (session.status !== "authenticated") return;

  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!workspace) return;
  if (!(await isWorkspaceMember(session.user.id, workspaceId))) return;

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTIONS);
  // The previous workspace's brand does not exist in the new one, so clearing
  // it lets the context resolver fall back to the new workspace's default.
  cookieStore.delete(BRAND_COOKIE);

  revalidatePath("/app", "layout");
}

export async function switchBrand(brandId: string): Promise<void> {
  const session = await readSession();
  if (session.status !== "authenticated") return;

  const [brand] = await db
    .select({ id: brands.id, workspaceId: brands.workspaceId })
    .from(brands)
    .where(and(eq(brands.id, brandId), isNull(brands.deletedAt)))
    .limit(1);
  if (!brand) return;
  if (!(await isWorkspaceMember(session.user.id, brand.workspaceId))) return;

  const cookieStore = await cookies();
  cookieStore.set(BRAND_COOKIE, brandId, COOKIE_OPTIONS);

  revalidatePath("/app", "layout");
}
