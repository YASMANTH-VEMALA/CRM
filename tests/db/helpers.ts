import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * Test harness for the row-level-security and stock-transaction rules.
 *
 * These tests run against the real Supabase project: RLS and the erp_* stored
 * procedures are the enforcement layer, so verifying them in isolation from
 * Postgres would prove nothing. Every fixture is namespaced with a unique run
 * id and torn down afterwards.
 */

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2];
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...process.env } as Record<string, string>;
}

const env = loadEnv();

/**
 * These tests create and delete real rows with the service-role key. Pointed at
 * production that is a data-safety incident, and it has already happened once:
 * an earlier run stranded ten test entities in the live database.
 *
 * Resolution order: dedicated TEST_SUPABASE_* credentials if present, otherwise
 * the app's own credentials. Either way the resolved project is checked against
 * the known production reference and the run is refused on a match.
 */
export const SUPABASE_URL = env.TEST_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = env.TEST_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_KEY =
  env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

/** Supabase project reference, e.g. https://abcd.supabase.co -> "abcd". */
function projectRef(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

const PRODUCTION_REF = env.PRODUCTION_SUPABASE_PROJECT_REF || "ahiqlaehxwqilkxfftuu";
const RESOLVED_REF = projectRef(SUPABASE_URL);
const USING_DEDICATED_TEST_PROJECT = Boolean(env.TEST_SUPABASE_URL);

if (SUPABASE_URL && RESOLVED_REF === PRODUCTION_REF) {
  if (env.ALLOW_PROD_TEST_DB !== "1") {
    throw new Error(
      [
        "",
        "  REFUSING TO RUN: the database tests are pointed at the production project.",
        "",
        `  Resolved project ref : ${RESOLVED_REF}`,
        `  Production ref       : ${PRODUCTION_REF}`,
        "",
        "  These tests sign in as real users and create, mutate and delete rows",
        "  with the service-role key. Point them at a dedicated test project:",
        "",
        "    TEST_SUPABASE_URL=https://<test-ref>.supabase.co",
        "    TEST_SUPABASE_ANON_KEY=...",
        "    TEST_SUPABASE_SERVICE_ROLE_KEY=...",
        "",
        "  Apply supabase/migrations to that project first (see README).",
        "",
        "  To override deliberately for one run (NOT for CI):",
        "    ALLOW_PROD_TEST_DB=1 npm run test:db",
        "",
      ].join("\n")
    );
  }
  console.warn(
    [
      "",
      "  ******************************************************************",
      "  *  ALLOW_PROD_TEST_DB=1 — running DB tests against PRODUCTION.   *",
      `  *  Project: ${RESOLVED_REF.padEnd(51)}*`,
      "  *  Fixtures are created and deleted in live data.                *",
      "  ******************************************************************",
      "",
    ].join("\n")
  );
} else if (SUPABASE_URL && !USING_DEDICATED_TEST_PROJECT) {
  console.warn(
    `[test:db] Using app credentials for project "${RESOLVED_REF}" (not the production ref). ` +
      "Set TEST_SUPABASE_* to make the target explicit."
  );
}

export const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export type TestUser = {
  authId: string;
  employeeId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

export type Fixture = {
  runId: string;
  db: SupabaseClient;
  entityA: string;
  entityB: string;
  users: TestUser[];
  productA: string;
  productB: string;
  batchA: string;
  batchB: string;
  supplierA: string;
  cleanup: () => Promise<void>;
};

/** Signs a user in with the anon key so their requests pass through RLS. */
async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Test sign-in failed for ${email}: ${error.message}`);
  return client;
}

export async function createUser(
  db: SupabaseClient,
  runId: string,
  options: {
    label: string;
    role: string;
    branchId: string | null;
    maxDiscountPercent?: number;
    overrides?: Record<string, boolean>;
  }
): Promise<TestUser> {
  const email = `erp-test-${options.label}-${runId}@example.test`;
  const password = `Test-${randomUUID()}`;

  const { data: created, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    throw new Error(`Could not create auth user: ${authError?.message}`);
  }

  const { data: employee, error: employeeError } = await db
    .from("employees")
    .insert({
      auth_user_id: created.user.id,
      full_name: `Test ${options.label} ${runId}`,
      email,
      username: `test-${options.label}-${runId}`,
      role: options.role,
      branch_id: options.branchId,
      max_discount_percent: options.maxDiscountPercent ?? 0,
      permission_overrides: options.overrides ?? {},
      status: "active",
    })
    .select("id")
    .single();

  if (employeeError || !employee) {
    throw new Error(`Could not create employee: ${employeeError?.message}`);
  }

  return {
    authId: created.user.id,
    employeeId: employee.id,
    email,
    password,
    client: await signIn(email, password),
  };
}

/**
 * Two isolated pharmacy entities, each with its own product, supplier and
 * stocked batch, plus the users the tests sign in as.
 */
export async function setupFixture(): Promise<Fixture> {
  const runId = randomUUID().slice(0, 8);
  const db = admin();

  const { data: entities, error: entityError } = await db
    .from("branches")
    .insert([
      { name: `Test Entity A ${runId}`, code: `TA-${runId}`, currency: "TZS" },
      { name: `Test Entity B ${runId}`, code: `TB-${runId}`, currency: "TZS" },
    ])
    .select("id, code");
  if (entityError || !entities || entities.length !== 2) {
    throw new Error(`Could not create test entities: ${entityError?.message}`);
  }
  const entityA = entities.find((e) => e.code === `TA-${runId}`)!.id;
  const entityB = entities.find((e) => e.code === `TB-${runId}`)!.id;

  const { data: suppliers } = await db
    .from("suppliers")
    .insert([
      { branch_id: entityA, name: `Supplier A ${runId}`, supplier_type: "external" },
      { branch_id: entityB, name: `Supplier B ${runId}`, supplier_type: "external" },
    ])
    .select("id, branch_id");
  const supplierA = suppliers!.find((s) => s.branch_id === entityA)!.id;

  const { data: products } = await db
    .from("products")
    .insert([
      {
        branch_id: entityA,
        sku: `TEST-A-${runId}`,
        name: `Test Product A ${runId}`,
        buy_price: 1000,
        sell_price: 2000,
        pricing_method: "fixed",
        max_discount_percent: 10,
        reorder_level: 20,
        restock_target: 100,
        status: "active",
      },
      {
        branch_id: entityB,
        sku: `TEST-B-${runId}`,
        name: `Test Product B ${runId}`,
        buy_price: 1500,
        sell_price: 3000,
        pricing_method: "fixed",
        max_discount_percent: 0,
        reorder_level: 10,
        restock_target: 50,
        status: "active",
      },
    ])
    .select("id, branch_id");
  const productA = products!.find((p) => p.branch_id === entityA)!.id;
  const productB = products!.find((p) => p.branch_id === entityB)!.id;

  const { data: batches } = await db
    .from("product_batches")
    .insert([
      {
        product_id: productA,
        branch_id: entityA,
        supplier_id: supplierA,
        batch_number: `BATCH-A-${runId}`,
        quantity_received: 50,
        quantity_available: 50,
        unit_cost: 1000,
        expiry_date: "2030-01-01",
        status: "active",
      },
      {
        product_id: productB,
        branch_id: entityB,
        batch_number: `BATCH-B-${runId}`,
        quantity_received: 40,
        quantity_available: 40,
        unit_cost: 1500,
        expiry_date: "2030-01-01",
        status: "active",
      },
    ])
    .select("id, branch_id");
  const batchA = batches!.find((b) => b.branch_id === entityA)!.id;
  const batchB = batches!.find((b) => b.branch_id === entityB)!.id;

  const users: TestUser[] = [];

  async function cleanup() {
    // Children first: FK constraints are not ON DELETE CASCADE everywhere.
    const entityIds = [entityA, entityB];
    const { data: sales } = await db.from("sales").select("id").in("branch_id", entityIds);
    const saleIds = (sales ?? []).map((s) => s.id);
    if (saleIds.length) await db.from("sale_items").delete().in("sale_id", saleIds);

    const { data: inwards } = await db.from("stock_inwards").select("id").in("branch_id", entityIds);
    const inwardIds = (inwards ?? []).map((i) => i.id);
    if (inwardIds.length) await db.from("stock_inward_items").delete().in("inward_id", inwardIds);

    const { data: openings } = await db
      .from("opening_stock_entries")
      .select("id")
      .in("branch_id", entityIds);
    const openingIds = (openings ?? []).map((o) => o.id);
    if (openingIds.length) await db.from("opening_stock_items").delete().in("entry_id", openingIds);

    // Order is load-bearing. stock_inwards.supplier_return_id points at
    // returns, so inwards must go first; returns.product_id/batch_id point at
    // products and batches, so returns must go before those; and branches
    // cannot go until every branch_id child is gone. Deleting returns too
    // early used to fail silently and strand whole test entities in the
    // database, so every delete is now checked and reported.
    const failures: string[] = [];
    async function purge(table: string, column: string, values: string[]) {
      if (values.length === 0) return;
      const { error } = await db.from(table).delete().in(column, values);
      if (error) failures.push(`${table}: ${error.message}`);
    }

    await purge("stock_movements", "branch_id", entityIds);
    await purge("stock_transfers", "from_branch_id", entityIds);
    await purge("stock_transfers", "to_branch_id", entityIds);
    await purge("sales", "branch_id", entityIds);
    await purge("stock_inwards", "branch_id", entityIds);
    await purge("opening_stock_entries", "branch_id", entityIds);
    await purge("returns", "branch_id", entityIds);
    await purge("draft_products", "branch_id", entityIds);
    await purge("product_imports", "branch_id", entityIds);
    await purge("product_price_history", "branch_id", entityIds);
    await purge("product_batches", "branch_id", entityIds);
    await purge("products", "branch_id", entityIds);
    await purge("suppliers", "branch_id", entityIds);
    await purge("customers", "branch_id", entityIds);
    await purge("audit_logs", "branch_id", entityIds);
    await purge("notifications", "branch_id", entityIds);

    for (const user of users) {
      await purge("employee_entities", "employee_id", [user.employeeId]);
      await purge("login_history", "employee_id", [user.employeeId]);
      await purge("audit_logs", "employee_id", [user.employeeId]);
      await purge("employees", "id", [user.employeeId]);
      await db.auth.admin.deleteUser(user.authId);
    }

    await purge("branches", "id", entityIds);

    if (failures.length > 0) {
      // Loud, not fatal: the run's results still stand, but leaked fixtures
      // must never pass unnoticed again.
      console.error(`[cleanup] ${failures.length} deletion(s) failed:\n  ${failures.join("\n  ")}`);
    }
  }

  return {
    runId,
    db,
    entityA,
    entityB,
    users,
    productA,
    productB,
    batchA,
    batchB,
    supplierA,
    cleanup,
  };
}

/** Reads a batch's available quantity with the service role (bypassing RLS). */
export async function batchQuantity(db: SupabaseClient, batchId: string): Promise<number> {
  const { data } = await db
    .from("product_batches")
    .select("quantity_available")
    .eq("id", batchId)
    .single();
  return data!.quantity_available;
}

export async function movementsFor(
  db: SupabaseClient,
  batchId: string
): Promise<Array<{ movement_type: string; quantity_delta: number; balance_after: number | null }>> {
  const { data } = await db
    .from("stock_movements")
    .select("movement_type, quantity_delta, balance_after")
    .eq("batch_id", batchId)
    .order("created_at");
  return data ?? [];
}
