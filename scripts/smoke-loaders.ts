/**
 * Runtime smoke test for the data loaders.
 *
 * tsc and the build only prove the code compiles. This runs the actual
 * PostgREST queries the refactored loaders issue, as each real QA role, so a
 * "column does not exist" or "permission denied" regression surfaces here
 * instead of in front of a client.
 *
 *   npx tsx scripts/smoke-loaders.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env: Record<string, string> = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PRODUCT_COLUMNS =
  "id, sku, name, generic_name, strength, form, category_id, supplier_id, " +
  "sell_price, unit, barcode, status, reorder_level, created_at, branch_id, " +
  "manufacturer, image_url, pricing_method, margin_percent, max_discount_percent, restock_target";
const BATCH_COLUMNS =
  "id, product_id, batch_number, supplier_id, branch_id, quantity_received, " +
  "quantity_available, expiry_date, storage_location, status, received_at, " +
  "source_type, source_id";

async function signInAs(email: string): Promise<SupabaseClient> {
  const creds = readFileSync(new URL("../.qa-credentials.local.txt", import.meta.url), "utf8");
  const match = new RegExp(`email\\s+${email.replace(/[.@]/g, "\\$&")}\\s*\\r?\\n\\s*password\\s+(\\S+)`).exec(creds);
  if (!match) throw new Error(`No password for ${email}`);
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: match[1] });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

let failures = 0;

// PostgREST query builders are thenable but not Promises, so PromiseLike.
async function check(role: string, label: string, run: () => PromiseLike<{ error: unknown }>) {
  const { error } = await run();
  if (error) {
    failures += 1;
    console.log(`  FAIL  ${label} :: ${(error as { message?: string }).message ?? error}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

async function smokeRole(email: string, role: string) {
  console.log(`\n--- ${role} (${email}) ---`);
  const c = await signInAs(email);

  // products loader
  await check(role, "products list", () =>
    c.from("products").select(`${PRODUCT_COLUMNS}, categories(name), suppliers(name), branches(name)`).limit(5)
  );
  // inventory loader
  await check(role, "inventory batches", () =>
    c.from("product_batches").select(`${BATCH_COLUMNS}, products(name, sku, reorder_level), suppliers(name), branches(name)`).limit(5)
  );
  // cost views
  await check(role, "product_costs view", () => c.from("product_costs").select("product_id, buy_price").limit(5));
  await check(role, "batch_costs view", () => c.from("batch_costs").select("batch_id, unit_cost").limit(5));
  // dashboard loader
  await check(role, "dashboard batches", () =>
    c.from("product_batches").select("id, product_id, quantity_available").eq("status", "active").limit(5)
  );
  await check(role, "dashboard sale_items", () =>
    c.from("sale_items").select("quantity, line_total, product_id, products(name, sku), sales!inner(id, branch_id, status, sold_at)").limit(5)
  );
  // analytics loader
  await check(role, "analytics sales", () =>
    c.from("sales").select("total, payment_method, status, sold_at, sale_items(quantity, line_total, product_id, products(name))").limit(5)
  );
  // stock ledger
  await check(role, "stock ledger", () =>
    c.from("stock_movements").select("*, products(name, sku), product_batches(batch_number), employees(full_name), branches(name)").limit(5)
  );
  // entity / branch loaders
  await check(role, "branches", () => c.from("branches").select("*").limit(5));
  await check(role, "entities batches", () =>
    c.from("product_batches").select("id, product_id, branch_id, quantity_available").eq("status", "active").limit(5)
  );
  // categories loader
  await check(role, "categories batches", () =>
    c.from("product_batches").select("id, product_id, quantity_available").limit(5)
  );
  // stock documents
  await check(role, "stock inwards", () =>
    c.from("stock_inwards").select("*, branches(name), suppliers(name), stock_inward_items(id, product_id, quantity, free_quantity, unit_cost, products(name, sku))").limit(3)
  );
  await check(role, "opening stock", () =>
    c.from("opening_stock_entries").select("*, branches(name), opening_stock_items(id, product_id, quantity, unit_cost, products(name, sku))").limit(3)
  );
  // POS
  await check(role, "POS product search", () =>
    c.from("products").select("id, sku, name, generic_name, sell_price, unit, barcode, max_discount_percent, categories(name), product_batches(id, batch_number, expiry_date, quantity_available, status, branch_id)").limit(5)
  );
  // returns / stock out
  await check(role, "stock-out batches", () =>
    c.from("product_batches").select("id, product_id, batch_number, expiry_date, quantity_available").gt("quantity_available", 0).limit(5)
  );
  // price history
  await check(role, "price history", () =>
    c.from("product_price_history").select("*, employees(full_name)").limit(5)
  );
  // reports
  await check(role, "report: current stock", () =>
    c.from("product_batches").select("id, batch_number, quantity_available, expiry_date, status, branches(name), products!inner(name, sku, reorder_level), suppliers(name)").limit(5)
  );
  await check(role, "report: products with stock", () =>
    c.from("products").select("id, sku, name, reorder_level, restock_target, supplier_id, sell_price, margin_percent, pricing_method, max_discount_percent, branches(name), suppliers(name)").limit(5)
  );
  await check(role, "report: sale items", () =>
    c.from("sale_items").select("quantity, unit_price, discount, line_total, product_id, products(name, sku), sales!inner(sold_at, status, branch_id, cashier_id)").limit(5)
  );
}

async function main() {
  await smokeRole("qa.master@marspharmacy.test", "master_admin");
  await smokeRole("qa.entityadmin@marspharmacy.test", "entity_admin");
  await smokeRole("qa.inventory@marspharmacy.test", "inventory_user");
  await smokeRole("qa.sales@marspharmacy.test", "sales_user");

  console.log(`\n${failures === 0 ? "ALL LOADER QUERIES OK" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
