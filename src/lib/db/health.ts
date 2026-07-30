import { sql } from "drizzle-orm";
import { db } from "./index";

export type DatabaseHealth =
  | { status: "ok"; latencyMs: number }
  | { status: "error"; detail: string };

/** Verifies the Neon connection is live and can round-trip a query. */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const start = performance.now();
  try {
    await db.execute(sql`select 1`);
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Unknown database error.",
    };
  }
}
