import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { checkDatabaseHealth } = await import("../src/lib/db/health");
  const health = await checkDatabaseHealth();

  if (health.status === "ok") {
    console.log(`✓ Neon connection OK (${health.latencyMs}ms)`);
    process.exit(0);
  }

  console.error(`✗ Neon connection failed: ${health.detail}`);
  process.exit(1);
}

main();
