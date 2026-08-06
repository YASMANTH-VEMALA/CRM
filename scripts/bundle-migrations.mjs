// Regenerates supabase/migrations/run_all.sql from the numbered migrations.
//
// run_all.sql previously drifted out of date (it stopped at 0005 while the
// database was on 0010), which meant a fresh environment bootstrapped from it
// came up with no entity isolation at all. Generating it makes drift
// impossible: run `npm run db:bundle` after adding a migration, and CI can
// diff the result to catch a stale bundle.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  console.error("No numbered migrations found.");
  process.exit(1);
}

const header = `-- =====================================================================
-- Mars Pharmacy ERP — full schema bootstrap
--
-- GENERATED FILE. Do not edit by hand.
-- Regenerate with: npm run db:bundle
--
-- Concatenation of every numbered migration, in order. Use this ONLY to
-- bootstrap a brand-new, empty database in one paste (for example the
-- Supabase SQL editor on a fresh project). For an existing database use
-- the migrations themselves via \`supabase db push\`, so the migration
-- history table stays accurate.
--
-- Order matters: 0002 installs permissive bootstrap policies that 0007
-- replaces with the real per-entity policies, and 0011-0013 harden the
-- permission and stock layers on top of that.
-- =====================================================================

`;

const body = files
  .map((name) => `-- ===== ${name} =====\n${readFileSync(join(migrationsDir, name), "utf8").trimEnd()}\n`)
  .join("\n");

writeFileSync(join(migrationsDir, "run_all.sql"), header + body, "utf8");

console.log(`Bundled ${files.length} migrations into run_all.sql:`);
for (const name of files) console.log(`  - ${name}`);
