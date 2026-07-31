import { config } from "dotenv";
import { Pool } from "pg";

/**
 * Verifies the creative and billing migrations landed as designed.
 *
 * Checks the constraints that carry money or tenancy, not merely that the
 * tables exist. A table with its CHECK constraints silently dropped looks
 * identical to a correct one until the day it accepts a negative charge.
 */

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const REQUIRED_TABLES = [
  "generation_providers",
  "generation_models",
  "provider_runs",
  "provider_run_outputs",
  "production_modes",
  "cost_configuration",
  "subscription_plans",
  "plan_entitlements",
  "credit_reservations",
  "top_up_packages",
  "workspace_subscriptions",
];

const REQUIRED_CONSTRAINTS = [
  // The reservation cannot be settled above what was authorised.
  "credit_reservations_charged_check",
  // A hold is negative, a release positive — a sign error cannot mint credits.
  "credit_ledger_hold_sign_check",
  // A run cannot claim to be terminal without saying when it finished.
  "provider_runs_completed_at_check",
  // An output is ingested if and only if it has an asset.
  "provider_run_outputs_ingested_check",
  // A contact-sales plan must not carry a price.
  "subscription_plans_contact_check",
];

const REQUIRED_INDEXES = [
  // The idempotency guarantee: one provider task per key per workspace.
  "provider_runs_idempotency_key_unique",
  "credit_reservations_idempotency_unique",
  "provider_runs_external_task_idx",
  "cost_configuration_global_key_idx",
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  const problems: string[] = [];

  try {
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const present = new Set(tables.rows.map((row) => row.table_name));
    for (const table of REQUIRED_TABLES) {
      if (!present.has(table)) problems.push(`Missing table: ${table}`);
    }

    const constraints = await pool.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'c'`,
    );
    const checks = new Set(constraints.rows.map((row) => row.conname));
    for (const name of REQUIRED_CONSTRAINTS) {
      if (!checks.has(name)) problems.push(`Missing CHECK constraint: ${name}`);
    }

    const indexes = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'`,
    );
    const constraintNames = await pool.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'u'`,
    );
    const unique = new Set([
      ...indexes.rows.map((row) => row.indexname),
      ...constraintNames.rows.map((row) => row.conname),
    ]);
    for (const name of REQUIRED_INDEXES) {
      if (!unique.has(name)) problems.push(`Missing unique index/constraint: ${name}`);
    }

    // The ledger must accept the two reservation reasons the credit flow writes.
    const reasons = await pool.query<{ consrc: string }>(
      `select pg_get_constraintdef(oid) as consrc from pg_constraint where conname = 'credit_ledger_reason_check'`,
    );
    const definition = reasons.rows[0]?.consrc ?? "";
    for (const reason of ["reservation_hold", "reservation_release"]) {
      if (!definition.includes(reason)) {
        problems.push(`credit_ledger_reason_check does not permit '${reason}'`);
      }
    }

    if (problems.length > 0) {
      console.error("Schema verification FAILED:");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `Schema verified: ${REQUIRED_TABLES.length} tables, ${REQUIRED_CONSTRAINTS.length} money/tenancy constraints, ${REQUIRED_INDEXES.length} idempotency indexes.`,
    );
  } finally {
    await pool.end();
  }
}

void main();
