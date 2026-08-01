"use server";

import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers, profiles, user } from "@/lib/db/schema";
import {
  campaigns,
  connectedAccounts,
  contentItems,
  contentVariants,
  mediaAssets,
  scheduledPosts,
} from "@/lib/db/schema.fragment";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import type { GlobalSearchResult } from "./types";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const RESULT_LIMIT = 5;

/**
 * Tenant-scoped entity search for the global command palette.
 *
 * The client debounces calls; this boundary still validates length, session,
 * tenant and permissions so it is safe to invoke independently. Only display
 * fields are returned — account tokens, storage paths and other operational
 * metadata never cross the server boundary.
 */
export async function searchGlobalEntities(rawQuery: string): Promise<GlobalSearchResult[]> {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) return [];

  const session = await readSession();
  if (session.status !== "authenticated") return [];

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") return [];

  const { context } = resolution;
  const pattern = `%${escapeLike(query)}%`;

  const [campaignRows, contentRows, assetRows, accountRows, postRows, memberRows] =
    await Promise.all([
      db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          objective: campaigns.objective,
          status: campaigns.status,
        })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.workspaceId, context.workspaceId),
            isNull(campaigns.deletedAt),
            or(ilike(campaigns.name, pattern), ilike(campaigns.objective, pattern)),
          ),
        )
        .orderBy(desc(campaigns.updatedAt))
        .limit(RESULT_LIMIT),

      db
        .select({
          id: contentItems.id,
          title: contentItems.title,
          caption: contentItems.caption,
          status: contentItems.status,
        })
        .from(contentItems)
        .where(
          and(
            eq(contentItems.workspaceId, context.workspaceId),
            isNull(contentItems.deletedAt),
            or(ilike(contentItems.title, pattern), ilike(contentItems.caption, pattern)),
          ),
        )
        .orderBy(desc(contentItems.updatedAt))
        .limit(RESULT_LIMIT),

      db
        .select({
          id: mediaAssets.id,
          filename: mediaAssets.filename,
          kind: mediaAssets.kind,
          uploadState: mediaAssets.uploadState,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.workspaceId, context.workspaceId),
            isNull(mediaAssets.deletedAt),
            ilike(mediaAssets.filename, pattern),
          ),
        )
        .orderBy(desc(mediaAssets.updatedAt))
        .limit(RESULT_LIMIT),

      db
        .select({
          id: connectedAccounts.id,
          displayName: connectedAccounts.displayName,
          username: connectedAccounts.username,
          platform: connectedAccounts.platform,
          health: connectedAccounts.health,
        })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.workspaceId, context.workspaceId),
            isNull(connectedAccounts.disconnectedAt),
            or(
              ilike(connectedAccounts.displayName, pattern),
              ilike(connectedAccounts.username, pattern),
            ),
          ),
        )
        .orderBy(desc(connectedAccounts.updatedAt))
        .limit(RESULT_LIMIT),

      db
        .select({
          id: scheduledPosts.id,
          contentItemId: contentItems.id,
          title: contentItems.title,
          platform: scheduledPosts.platform,
          status: scheduledPosts.status,
          scheduledFor: scheduledPosts.scheduledFor,
        })
        .from(scheduledPosts)
        .innerJoin(contentVariants, eq(contentVariants.id, scheduledPosts.contentVariantId))
        .innerJoin(contentItems, eq(contentItems.id, contentVariants.contentItemId))
        .where(
          and(
            eq(scheduledPosts.workspaceId, context.workspaceId),
            isNull(scheduledPosts.cancelledAt),
            or(ilike(contentItems.title, pattern), ilike(scheduledPosts.caption, pattern)),
          ),
        )
        .orderBy(desc(scheduledPosts.scheduledFor))
        .limit(RESULT_LIMIT),

      can(context.role, "team.manage")
        ? db
            .select({
              id: organizationMembers.id,
              name: user.name,
              email: user.email,
              fullName: profiles.fullName,
              role: organizationMembers.role,
            })
            .from(organizationMembers)
            .innerJoin(user, eq(user.id, organizationMembers.userId))
            .leftJoin(profiles, eq(profiles.id, organizationMembers.userId))
            .where(
              and(
                eq(organizationMembers.organizationId, context.organizationId),
                or(
                  ilike(user.name, pattern),
                  ilike(user.email, pattern),
                  ilike(profiles.fullName, pattern),
                ),
              ),
            )
            .orderBy(desc(organizationMembers.updatedAt))
            .limit(RESULT_LIMIT)
        : Promise.resolve([]),
    ]);

  return [
    ...campaignRows.map<GlobalSearchResult>((row) => ({
      id: `campaign:${row.id}`,
      kind: "campaign",
      label: row.name,
      hint: `${sentenceCase(row.status)}${row.objective ? ` · ${row.objective}` : ""}`,
      href: `/app/campaigns/${row.id}`,
      group: "Campaigns",
    })),
    ...contentRows.map<GlobalSearchResult>((row) => ({
      id: `content:${row.id}`,
      kind: "content",
      label: row.title,
      hint: `${sentenceCase(row.status)} content`,
      href: `/app/content/${row.id}`,
      group: "Content",
    })),
    ...assetRows.map<GlobalSearchResult>((row) => ({
      id: `asset:${row.id}`,
      kind: "asset",
      label: row.filename ?? `${sentenceCase(row.kind)} asset`,
      hint: `${sentenceCase(row.kind)} · ${sentenceCase(row.uploadState)}`,
      href: `/app/library?asset=${row.id}`,
      group: "Library",
    })),
    ...accountRows.map<GlobalSearchResult>((row) => {
      const label = row.displayName ?? row.username ?? `${sentenceCase(row.platform)} account`;
      const accountQuery = row.username ?? row.displayName ?? label;
      return {
        id: `account:${row.id}`,
        kind: "account",
        label,
        hint: `${sentenceCase(row.platform)} · ${sentenceCase(row.health)}`,
        href: `/app/accounts?q=${encodeURIComponent(accountQuery)}`,
        group: "Accounts",
      };
    }),
    ...postRows.map<GlobalSearchResult>((row) => ({
      id: `scheduled-post:${row.id}`,
      kind: "scheduled_post",
      label: row.title,
      hint: `${sentenceCase(row.platform)} · ${sentenceCase(row.status)} · ${formatSearchDate(row.scheduledFor)}`,
      href: `/app/content/${row.contentItemId}`,
      group: "Scheduled posts",
    })),
    ...memberRows.map<GlobalSearchResult>((row) => ({
      id: `team-member:${row.id}`,
      kind: "team_member",
      label: row.fullName?.trim() || row.name || row.email,
      hint: `${sentenceCase(row.role)} · ${row.email}`,
      href: `/app/team?q=${encodeURIComponent(row.email)}`,
      group: "Team",
    })),
  ];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function sentenceCase(value: string): string {
  const normalised = value.replaceAll("_", " ");
  return normalised.charAt(0).toUpperCase() + normalised.slice(1);
}

function formatSearchDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
