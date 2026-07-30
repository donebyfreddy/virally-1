import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs standalone, outside Next's automatic .env.local loading.
config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local (see .env.example) before running any drizzle-kit command.",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
