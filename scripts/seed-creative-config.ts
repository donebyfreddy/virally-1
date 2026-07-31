import { config } from "dotenv";

/**
 * Seeds provider, model, production-mode, plan and top-up configuration.
 *
 * Idempotent: safe to run on every deploy. Operator-set `enabled` / `available`
 * flags are preserved on conflict — see src/lib/creative/seed.ts.
 */
config({ path: ".env.local" });

async function main(): Promise<void> {
  // Imported after dotenv: src/lib/db builds its Pool at module scope and
  // throws when DATABASE_URL is unset.
  const { seedCreativeConfiguration } = await import("../src/lib/creative/seed");
  const { pool } = await import("../src/lib/db");

  try {
    const report = await seedCreativeConfiguration();
    console.log("Seeded creative configuration:");
    for (const [key, value] of Object.entries(report)) console.log(`  ${key}: ${value}`);
  } finally {
    await pool.end();
  }
}

void main();
