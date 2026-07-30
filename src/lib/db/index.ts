import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Neon Postgres connection.
 *
 * `DATABASE_URL` is read only through `process.env` here, on the server. It
 * must never be prefixed `NEXT_PUBLIC_` and must never be logged — a leak of
 * this value is a full database compromise (the pooled connection string
 * carries the role's real password).
 *
 * One pool per server process, not per request: creating a `Pool` per request
 * would exhaust Neon's connection limit under load. Next.js's dev server
 * module reload can otherwise create a new pool on every file save, so the
 * instance is cached on `globalThis` in development.
 */

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example) — never with a NEXT_PUBLIC_ prefix.",
    );
  }
  return url;
}

declare global {
   
  var __viralllyPgPool: Pool | undefined;
}

function getPool(): Pool {
  if (process.env.NODE_ENV === "production") {
    return new Pool({ connectionString: requireDatabaseUrl() });
  }
  if (!globalThis.__viralllyPgPool) {
    globalThis.__viralllyPgPool = new Pool({ connectionString: requireDatabaseUrl() });
  }
  return globalThis.__viralllyPgPool;
}

export const pool = getPool();
export const db = drizzle(pool, { schema });

export type Database = typeof db;
