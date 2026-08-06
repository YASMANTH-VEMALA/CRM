/**
 * Seeds Test Pharmacy A and B with enough data that every Phase 1 screen has
 * something to show during a demo, and the two entities look clearly different
 * so cross-entity isolation is visible at a glance.
 *
 *   npx tsx scripts/seed-qa-data.ts
 *
 * Idempotent: re-running clears the QA entities' transactional data and
 * rebuilds it. It never touches the Mars Pharmacy entities.
 *
 * Stock is created through the real RPCs wherever possible (opening stock,
 * stock inward, sales, write-offs) so the ledger is genuine rather than
 * hand-written — the demo then shows a stock ledger that actually reconciles.
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
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CREDENTIALS_FILE = new URL("../.qa-credentials.local.txt", import.meta.url);

/** Signs in a QA account using the credentials file the setup script wrote. */
async function signInAs(email: string): Promise<SupabaseClient> {
  const creds = readFileSync(CREDENTIALS_FILE, "utf8");
  const match = new RegExp(`email\\s+${email.replace(/[.@]/g, "\\$&")}\\s*\\r?\\n\\s*password\\s+(\\S+)`).exec(creds);
  if (!match) throw new Error(`No password for ${email} in .qa-credentials.local.txt`);
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: match[1] });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

type Catalogue = {
  sku: string;
  name: string;
  generic: string;
  strength: string;
  form: string;
  unit: string;
  buy: number;
  sell: number;
  reorder: number;
  target: number;
  maxDiscount: number;
};

const PRODUCTS_A: Catalogue[] = [
  { sku: "AMX-500", name: "Amoxicillin 500mg", generic: "Amoxicillin", strength: "500mg", form: "Capsule", unit: "Pack of 21", buy: 3200, sell: 5000, reorder: 20, target: 120, maxDiscount: 10 },
  { sku: "PAR-500", name: "Paracetamol 500mg", generic: "Paracetamol", strength: "500mg", form: "Tablet", unit: "Pack of 24", buy: 900, sell: 1600, reorder: 40, target: 240, maxDiscount: 15 },
  { sku: "IBU-400", name: "Ibuprofen 400mg", generic: "Ibuprofen", strength: "400mg", form: "Tablet", unit: "Pack of 20", buy: 1400, sell: 2400, reorder: 30, target: 150, maxDiscount: 10 },
  { sku: "MET-850", name: "Metformin 850mg", generic: "Metformin", strength: "850mg", form: "Tablet", unit: "Pack of 30", buy: 4100, sell: 6500, reorder: 15, target: 90, maxDiscount: 5 },
  { sku: "ORS-SAC", name: "ORS Sachets", generic: "Oral rehydration salts", strength: "20.5g", form: "Sachet", unit: "Box of 10", buy: 1800, sell: 3000, reorder: 25, target: 100, maxDiscount: 20 },
  { sku: "VTC-1000", name: "Vitamin C 1000mg", generic: "Ascorbic acid", strength: "1000mg", form: "Tablet", unit: "Tube of 20", buy: 2600, sell: 4200, reorder: 20, target: 100, maxDiscount: 25 },
  { sku: "SAL-INH", name: "Salbutamol Inhaler", generic: "Salbutamol", strength: "100mcg", form: "Inhaler", unit: "Each", buy: 8500, sell: 13500, reorder: 10, target: 45, maxDiscount: 5 },
  { sku: "CET-10", name: "Cetirizine 10mg", generic: "Cetirizine", strength: "10mg", form: "Tablet", unit: "Pack of 10", buy: 1100, sell: 2000, reorder: 30, target: 120, maxDiscount: 15 },
];

const PRODUCTS_B: Catalogue[] = [
  { sku: "AZI-250", name: "Azithromycin 250mg", generic: "Azithromycin", strength: "250mg", form: "Tablet", unit: "Pack of 6", buy: 6200, sell: 9800, reorder: 12, target: 60, maxDiscount: 5 },
  { sku: "OMP-20", name: "Omeprazole 20mg", generic: "Omeprazole", strength: "20mg", form: "Capsule", unit: "Pack of 14", buy: 3400, sell: 5600, reorder: 20, target: 100, maxDiscount: 10 },
  { sku: "DIC-50", name: "Diclofenac 50mg", generic: "Diclofenac", strength: "50mg", form: "Tablet", unit: "Pack of 20", buy: 1500, sell: 2600, reorder: 25, target: 120, maxDiscount: 10 },
  { sku: "LOS-50", name: "Losartan 50mg", generic: "Losartan", strength: "50mg", form: "Tablet", unit: "Pack of 30", buy: 5200, sell: 8200, reorder: 15, target: 75, maxDiscount: 5 },
  { sku: "ZNC-SYR", name: "Zinc Syrup", generic: "Zinc sulphate", strength: "20mg/5ml", form: "Syrup", unit: "100ml bottle", buy: 2200, sell: 3800, reorder: 20, target: 90, maxDiscount: 15 },
];

const SUPPLIERS_A = [
  { name: "Kibo Pharmaceuticals Ltd", type: "external", contact: "Asha Mramba", phone: "+255 754 110 220" },
  { name: "Mars Central Warehouse", type: "parent", contact: "Internal transfers", phone: "+255 754 000 001" },
];
const SUPPLIERS_B = [
  { name: "Northern Medical Supplies", type: "external", contact: "Baraka Kimaro", phone: "+255 767 330 440" },
];

const CUSTOMERS_A = [
  { name: "Grace Mollel", phone: "+255 713 220 110", segment: "Retail" },
  { name: "Juma Salehe", phone: "+255 715 884 221", segment: "Retail" },
  { name: "Mikocheni Clinic", phone: "+255 22 277 1180", segment: "Institution" },
];
const CUSTOMERS_B = [{ name: "Arusha Community Clinic", phone: "+255 27 250 4400", segment: "Institution" }];

function futureDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function entityId(code: string): Promise<string> {
  const { data, error } = await db.from("branches").select("id").eq("code", code).single();
  if (error) throw new Error(`entity ${code}: ${error.message}. Run setup-qa-accounts.ts first.`);
  return data.id;
}

/** Clears transactional data for the QA entities so the script can re-run. */
async function reset(ids: string[]) {
  const purge = async (table: string, column: string) => {
    const { error } = await db.from(table).delete().in(column, ids);
    if (error) console.warn(`  reset ${table}: ${error.message}`);
  };
  const { data: sales } = await db.from("sales").select("id").in("branch_id", ids);
  if (sales?.length) await db.from("sale_items").delete().in("sale_id", sales.map((s) => s.id));
  const { data: inw } = await db.from("stock_inwards").select("id").in("branch_id", ids);
  if (inw?.length) await db.from("stock_inward_items").delete().in("inward_id", inw.map((i) => i.id));
  const { data: opn } = await db.from("opening_stock_entries").select("id").in("branch_id", ids);
  if (opn?.length) await db.from("opening_stock_items").delete().in("entry_id", opn.map((o) => o.id));

  await purge("stock_movements", "branch_id");
  await purge("stock_transfers", "from_branch_id");
  await purge("sales", "branch_id");
  await purge("stock_inwards", "branch_id");
  await purge("opening_stock_entries", "branch_id");
  await purge("returns", "branch_id");
  await purge("draft_products", "branch_id");
  await purge("product_imports", "branch_id");
  await purge("product_price_history", "branch_id");
  await purge("product_batches", "branch_id");
  await purge("products", "branch_id");
  await purge("suppliers", "branch_id");
  await purge("customers", "branch_id");
  await purge("expenses", "branch_id");
  await purge("audit_logs", "branch_id");
}

async function seedEntity(
  code: string,
  catalogue: Catalogue[],
  suppliers: typeof SUPPLIERS_A,
  customers: typeof CUSTOMERS_A,
  adminEmail: string
) {
  const branchId = await entityId(code);
  console.log(`\n=== ${code} ===`);

  const { data: categories } = await db.from("categories").select("id, name").limit(4);
  const categoryId = categories?.[0]?.id ?? null;

  const { data: supplierRows, error: supErr } = await db
    .from("suppliers")
    .insert(
      suppliers.map((s) => ({
        branch_id: branchId,
        name: s.name,
        supplier_type: s.type,
        contact_name: s.contact,
        phone: s.phone,
        is_active: true,
      }))
    )
    .select("id, supplier_type");
  if (supErr) throw new Error(`suppliers: ${supErr.message}`);
  const externalSupplier = supplierRows!.find((s) => s.supplier_type === "external")!.id;
  console.log(`  suppliers   ${supplierRows!.length}`);

  await db.from("customers").insert(
    customers.map((c) => ({ branch_id: branchId, name: c.name, phone: c.phone, segment: c.segment }))
  );
  console.log(`  customers   ${customers.length}`);

  const { data: productRows, error: prodErr } = await db
    .from("products")
    .insert(
      catalogue.map((p) => ({
        branch_id: branchId,
        sku: p.sku,
        name: p.name,
        generic_name: p.generic,
        strength: p.strength,
        form: p.form,
        unit: p.unit,
        category_id: categoryId,
        supplier_id: externalSupplier,
        buy_price: p.buy,
        sell_price: p.sell,
        pricing_method: "fixed",
        margin_percent: 0,
        max_discount_percent: p.maxDiscount,
        reorder_level: p.reorder,
        restock_target: p.target,
        status: "active",
      }))
    )
    .select("id, sku");
  if (prodErr) throw new Error(`products: ${prodErr.message}`);
  const bySku = new Map(productRows!.map((p) => [p.sku, p.id]));
  console.log(`  products    ${productRows!.length}`);

  // Price history, so the product screen has something to show.
  await db.from("product_price_history").insert(
    catalogue.slice(0, 3).map((p) => ({
      product_id: bySku.get(p.sku)!,
      branch_id: branchId,
      field: "sell_price",
      previous_value: String(Math.round(p.sell * 0.92)),
      new_value: String(p.sell),
      change_type: "manual",
      reason: "Supplier price revision",
    }))
  );

  const admin = await signInAs(adminEmail);

  // --- Opening stock, confirmed through the RPC ---------------------------
  const { data: opening, error: openErr } = await admin
    .from("opening_stock_entries")
    .insert({
      reference: `OS-${code}-001`,
      branch_id: branchId,
      opening_date: new Date().toISOString().slice(0, 10),
      notes: "Opening balance at go-live",
      status: "draft",
    })
    .select("id")
    .single();
  if (openErr) throw new Error(`opening entry: ${openErr.message}`);

  await admin.from("opening_stock_items").insert(
    catalogue.map((p, i) => ({
      entry_id: opening!.id,
      product_id: bySku.get(p.sku)!,
      batch_number: `OB-${p.sku}`,
      expiry_date: futureDate(10 + i * 2),
      quantity: p.target,
      unit_cost: p.buy,
      sell_price: p.sell,
    }))
  );
  const openRes = await admin.rpc("erp_confirm_opening_stock", { p_id: opening!.id });
  if (openRes.error) throw new Error(`confirm opening: ${openRes.error.message}`);
  console.log(`  opening     ${catalogue.length} batches confirmed`);

  // --- A purchase inward with free goods ----------------------------------
  const { data: inward, error: inErr } = await admin
    .from("stock_inwards")
    .insert({
      reference: `IN-${code}-001`,
      branch_id: branchId,
      supplier_id: externalSupplier,
      inward_type: "purchase_from_external",
      invoice_number: `INV-${code}-8842`,
      invoice_date: new Date().toISOString().slice(0, 10),
      notes: "Monthly restock",
      status: "draft",
    })
    .select("id")
    .single();
  if (inErr) throw new Error(`inward: ${inErr.message}`);

  await admin.from("stock_inward_items").insert(
    catalogue.slice(0, 3).map((p, i) => ({
      inward_id: inward!.id,
      product_id: bySku.get(p.sku)!,
      batch_number: `PB-${p.sku}`,
      expiry_date: futureDate(14 + i),
      quantity: 40,
      free_quantity: i === 0 ? 5 : 0,
      unit_cost: p.buy,
    }))
  );
  const inRes = await admin.rpc("erp_confirm_stock_inward", { p_id: inward!.id });
  if (inRes.error) throw new Error(`confirm inward: ${inRes.error.message}`);
  console.log(`  inward      3 lines confirmed (1 with free goods)`);

  // --- A draft inward left unconfirmed, so the screen shows both states ---
  const { data: draftInward } = await admin
    .from("stock_inwards")
    .insert({
      reference: `IN-${code}-002`,
      branch_id: branchId,
      supplier_id: externalSupplier,
      inward_type: "foc_or_sample",
      notes: "Sample pack awaiting confirmation",
      status: "draft",
    })
    .select("id")
    .single();
  if (draftInward) {
    await admin.from("stock_inward_items").insert({
      inward_id: draftInward.id,
      product_id: bySku.get(catalogue[0].sku)!,
      batch_number: `SB-${catalogue[0].sku}`,
      expiry_date: futureDate(18),
      quantity: 0,
      free_quantity: 12,
      unit_cost: 0,
    });
  }

  return { branchId, bySku, admin, externalSupplier, catalogue };
}

async function seedActivity(
  ctx: Awaited<ReturnType<typeof seedEntity>>,
  salesEmail: string | null
) {
  const { branchId, bySku, admin, catalogue } = ctx;

  const { data: batches } = await db
    .from("product_batches")
    .select("id, product_id, quantity_available")
    .eq("branch_id", branchId)
    .gt("quantity_available", 0);
  const batchFor = new Map<string, { id: string; qty: number }>();
  for (const b of batches ?? []) {
    if (!batchFor.has(b.product_id)) batchFor.set(b.product_id, { id: b.id, qty: b.quantity_available });
  }

  const { data: customers } = await db.from("customers").select("id").eq("branch_id", branchId).limit(1);

  // --- Sales, through the real RPC so the ledger is genuine ---------------
  if (salesEmail) {
    const seller = await signInAs(salesEmail);
    const carts = [
      [catalogue[0], catalogue[1]],
      [catalogue[1]],
      [catalogue[2], catalogue[0]],
      [catalogue[1], catalogue[2]],
    ];
    let sold = 0;
    for (const [index, cart] of carts.entries()) {
      const items = cart
        .map((p) => {
          const batch = batchFor.get(bySku.get(p.sku)!);
          return batch ? { product_id: bySku.get(p.sku)!, batch_id: batch.id, quantity: 2 + index, discount: 0 } : null;
        })
        .filter(Boolean);
      if (items.length === 0) continue;
      const { error } = await seller.rpc("erp_complete_sale", {
        p: {
          customer_id: index === 0 ? customers?.[0]?.id ?? null : null,
          payment_method: ["Cash", "M-Pesa", "Cash", "Bank"][index],
          discount: 0,
          request_key: `seed-${branchId}-${index}`,
          items,
        },
      });
      if (error) console.warn(`  sale ${index}: ${error.message}`);
      else sold += 1;
    }
    console.log(`  sales       ${sold} completed`);
  }

  // --- Stock-out documents: one of each type, approved -------------------
  const outTypes: Array<{ type: string; qty: number; reason: string }> = [
    { type: "expired", qty: 3, reason: "Past expiry on shelf audit" },
    { type: "damaged", qty: 2, reason: "Broken seal in transit" },
    { type: "employee_consumption", qty: 1, reason: "Staff first aid use" },
  ];
  let outs = 0;
  for (const [i, out] of outTypes.entries()) {
    const product = bySku.get(catalogue[Math.min(i, catalogue.length - 1)].sku)!;
    const batch = batchFor.get(product);
    if (!batch) continue;
    const { data: doc } = await admin
      .from("returns")
      .insert({
        reference: `SO-${branchId.slice(0, 4)}-${i}`,
        type: out.type,
        branch_id: branchId,
        product_id: product,
        batch_id: batch.id,
        quantity: out.qty,
        reason: out.reason,
        status: "pending",
      })
      .select("id")
      .single();
    if (!doc) continue;
    const { error } = await admin.rpc("erp_approve_stock_out", { p_return_id: doc.id });
    if (error) console.warn(`  stock-out ${out.type}: ${error.message}`);
    else outs += 1;
  }
  console.log(`  stock-out   ${outs} approved`);

  // --- A pending supplier return, so an approval queue is visible --------
  const firstProduct = bySku.get(catalogue[0].sku)!;
  const firstBatch = batchFor.get(firstProduct);
  if (firstBatch) {
    await admin.from("returns").insert({
      reference: `SR-${branchId.slice(0, 4)}-P`,
      type: "supplier",
      branch_id: branchId,
      product_id: firstProduct,
      batch_id: firstBatch.id,
      quantity: 4,
      reason: "Short-dated stock returned to supplier",
      resolution_type: "replacement",
      status: "pending",
    });
  }

  // --- Expenses -----------------------------------------------------------
  const { data: expenseCategories } = await db.from("expense_categories").select("id").limit(1);
  await db.from("expenses").insert([
    {
      reference: `EXP-${branchId.slice(0, 4)}-1`,
      description: "Monthly rent",
      category_id: expenseCategories?.[0]?.id ?? null,
      vendor: "Property agent",
      amount: 850000,
      payment_method: "Bank",
      branch_id: branchId,
      status: "approved",
    },
    {
      reference: `EXP-${branchId.slice(0, 4)}-2`,
      description: "Electricity",
      category_id: expenseCategories?.[0]?.id ?? null,
      vendor: "TANESCO",
      amount: 145000,
      payment_method: "M-Pesa",
      branch_id: branchId,
      status: "pending",
    },
  ]);
  console.log(`  expenses    2`);
}

async function main() {
  const idA = await entityId("QA-A");
  const idB = await entityId("QA-B");

  console.log("Resetting QA entities…");
  await reset([idA, idB]);

  const ctxA = await seedEntity("QA-A", PRODUCTS_A, SUPPLIERS_A, CUSTOMERS_A, "qa.entityadmin@marspharmacy.test");
  await seedActivity(ctxA, "qa.sales@marspharmacy.test");

  const ctxB = await seedEntity("QA-B", PRODUCTS_B, SUPPLIERS_B, CUSTOMERS_B, "qa.entityadmin.b@marspharmacy.test");
  await seedActivity(ctxB, null);

  // Reconciliation proof: the ledger must equal live batch quantities.
  for (const [code, id] of [["QA-A", idA], ["QA-B", idB]] as const) {
    const { data: movements } = await db
      .from("stock_movements")
      .select("batch_id, quantity_delta")
      .eq("branch_id", id);
    const { data: batches } = await db
      .from("product_batches")
      .select("id, quantity_available")
      .eq("branch_id", id);
    const ledger = new Map<string, number>();
    for (const m of movements ?? []) ledger.set(m.batch_id, (ledger.get(m.batch_id) ?? 0) + m.quantity_delta);
    const mismatched = (batches ?? []).filter((b) => (ledger.get(b.id) ?? 0) !== b.quantity_available);
    console.log(
      `\n${code}: ${movements?.length ?? 0} ledger rows, ${batches?.length ?? 0} batches, ` +
        `${mismatched.length === 0 ? "reconciles exactly ✓" : `${mismatched.length} MISMATCHED ✗`}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
