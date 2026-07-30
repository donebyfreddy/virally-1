import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { resolveSiteOrigin } from "@/lib/env";
import * as schema from "@/lib/db/schema";

/**
 * Better Auth server instance. Replaces Supabase Auth (GoTrue).
 *
 * `generateId: false` disables Better Auth's own id generator so every id
 * column is produced by Postgres's `defaultRandom()` instead — this keeps
 * `user.id` a plain `uuid`, which every existing foreign key across the
 * schema (organizations.created_by, organization_members.user_id, etc.)
 * already assumes. See src/lib/db/schema.ts's Better Auth section.
 *
 * Session cookies are read by src/proxy.ts (fast-fail route guard) and by
 * src/lib/auth/session.ts (the actual server-side check every protected
 * surface performs — see that file for why the proxy check alone is not
 * the security boundary).
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  advanced: {
    database: { generateId: false },
  },
  baseURL: resolveSiteOrigin(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // No email provider is wired in yet — sendResetPassword logs to the
    // server console in development so the flow is testable without one.
    // Feature-detected the same way Supabase's SMTP was: absent config
    // degrades to a visible no-op, never a silent failure.
    sendResetPassword: async ({ user, url }) => {
      const { sendAuthEmail } = await import("@/lib/auth/email");
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your Virally password",
        text: `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendAuthEmail } = await import("@/lib/auth/email");
      await sendAuthEmail({
        to: user.email,
        subject: "Confirm your Virally account",
        text: `Confirm your email: ${url}\n\nThis link expires in one hour.`,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.AUTH_GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET ?? "",
      accessType: "offline",
      prompt: "select_account",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days, matching the original refresh_token_reuse window intent
    updateAge: 60 * 60 * 24, // refresh once per day of activity
  },
});

export type Auth = typeof auth;
