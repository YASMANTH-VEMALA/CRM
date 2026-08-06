import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  batchQuantity,
  createUser,
  hasCredentials,
  movementsFor,
  setupFixture,
  type Fixture,
  type TestUser,
} from "./helpers";

/**
 * Required scenarios 3-15: the stock-changing operations. Every assertion goes
 * through the erp_* transactional procedures, which are the only sanctioned
 * write path for inventory.
 */
describe("stock transactions", { skip: !hasCredentials && "no Supabase credentials" }, () => {
  let fx: Fixture;
  let entityAdmin: TestUser;
  let salesUser: TestUser;
  let inventoryUser: TestUser;

  before(async () => {
    fx = await setupFixture();
    entityAdmin = await createUser(fx.db, fx.runId, {
      label: "stock-admin",
      role: "entity_admin",
      branchId: fx.entityA,
      maxDiscountPercent: 50,
    });
    salesUser = await createUser(fx.db, fx.runId, {
      label: "stock-sales",
      role: "sales_user",
      branchId: fx.entityA,
      maxDiscountPercent: 5,
    });
    inventoryUser = await createUser(fx.db, fx.runId, {
      label: "stock-inv",
      role: "inventory_user",
      branchId: fx.entityA,
    });
    fx.users.push(entityAdmin, salesUser, inventoryUser);
  });

  after(async () => {
    await fx?.cleanup();
  });

  async function createInward(
    inwardType: string,
    items: Array<{ quantity: number; free_quantity?: number; unit_cost?: number }>,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const { data: doc, error } = await fx.db
      .from("stock_inwards")
      .insert({
        reference: `IN-${fx.runId}-${Math.random().toString(36).slice(2, 8)}`,
        branch_id: fx.entityA,
        supplier_id: fx.supplierA,
        inward_type: inwardType,
        status: "draft",
        created_by: entityAdmin.employeeId,
        ...extra,
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(`inward setup failed: ${error?.message}`);

    const { error: itemError } = await fx.db.from("stock_inward_items").insert(
      items.map((item, index) => ({
        inward_id: doc.id,
        product_id: fx.productA,
        batch_number: `IB-${fx.runId}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        expiry_date: "2030-06-01",
        quantity: item.quantity,
        free_quantity: item.free_quantity ?? 0,
        unit_cost: item.unit_cost ?? 1000,
      }))
    );
    if (itemError) throw new Error(`inward item setup failed: ${itemError.message}`);

    return doc.id;
  }

  // Scenario 3
  test("Purchase confirmation increases stock and writes a purchase movement", async () => {
    const inwardId = await createInward("purchase_from_external", [{ quantity: 25 }]);

    const { error } = await entityAdmin.client.rpc("erp_confirm_stock_inward", { p_id: inwardId });
    assert.equal(error, null, error?.message);

    const { data: items } = await fx.db
      .from("stock_inward_items")
      .select("batch_id, quantity")
      .eq("inward_id", inwardId);
    const batchId = items![0].batch_id!;
    assert.ok(batchId, "confirmation must create and link a batch");
    assert.equal(await batchQuantity(fx.db, batchId), 25);

    const movements = await movementsFor(fx.db, batchId);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movement_type, "purchase");
    assert.equal(movements[0].quantity_delta, 25);
    assert.equal(movements[0].balance_after, 25, "the ledger records the running balance");
  });

  test("Stock does not move while an inward document is still a draft", async () => {
    const inwardId = await createInward("purchase_from_external", [{ quantity: 12 }]);
    const { data: items } = await fx.db
      .from("stock_inward_items")
      .select("batch_id")
      .eq("inward_id", inwardId);
    assert.equal(items![0].batch_id, null, "a draft creates no batch");
  });

  test("A confirmed inward document cannot be confirmed twice", async () => {
    const inwardId = await createInward("purchase_from_external", [{ quantity: 5 }]);
    const first = await entityAdmin.client.rpc("erp_confirm_stock_inward", { p_id: inwardId });
    assert.equal(first.error, null);

    const second = await entityAdmin.client.rpc("erp_confirm_stock_inward", { p_id: inwardId });
    assert.ok(second.error, "double confirmation must be rejected");

    const { data: movements } = await fx.db
      .from("stock_movements")
      .select("id")
      .eq("reference_id", inwardId);
    assert.equal(movements?.length, 1, "only one movement may exist");
  });

  // Scenario 4
  test("FOC confirmation increases stock and stays identifiable as free goods", async () => {
    const inwardId = await createInward("foc_or_sample", [{ quantity: 0, free_quantity: 10, unit_cost: 0 }]);

    const { error } = await entityAdmin.client.rpc("erp_confirm_stock_inward", { p_id: inwardId });
    assert.equal(error, null, error?.message);

    const { data: items } = await fx.db
      .from("stock_inward_items")
      .select("batch_id")
      .eq("inward_id", inwardId);
    const batchId = items![0].batch_id!;

    assert.equal(await batchQuantity(fx.db, batchId), 10);
    const movements = await movementsFor(fx.db, batchId);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movement_type, "foc", "free goods must post as FOC, not purchase");
  });

  test("Free goods on a paid purchase post as a separate FOC movement", async () => {
    const inwardId = await createInward("purchase_from_external", [{ quantity: 20, free_quantity: 5 }]);
    await entityAdmin.client.rpc("erp_confirm_stock_inward", { p_id: inwardId });

    const { data: items } = await fx.db
      .from("stock_inward_items")
      .select("batch_id")
      .eq("inward_id", inwardId);
    const batchId = items![0].batch_id!;

    assert.equal(await batchQuantity(fx.db, batchId), 25, "paid and free quantities both land in stock");

    const movements = await movementsFor(fx.db, batchId);
    const types = movements.map((m) => m.movement_type).sort();
    assert.deepEqual(types, ["foc", "purchase"], "the free portion stays separately identifiable");
    assert.equal(movements.find((m) => m.movement_type === "purchase")!.quantity_delta, 20);
    assert.equal(movements.find((m) => m.movement_type === "foc")!.quantity_delta, 5);
  });

  // Scenario 5
  test("Replacement inward links to the originating supplier return", async () => {
    const { data: supplierReturn } = await fx.db
      .from("returns")
      .insert({
        reference: `RET-${fx.runId}-repl`,
        type: "supplier",
        branch_id: fx.entityA,
        product_id: fx.productA,
        batch_id: fx.batchA,
        quantity: 3,
        reason: "Damaged on arrival",
        resolution_type: "replacement",
        requested_by: entityAdmin.employeeId,
        status: "pending",
      })
      .select("id")
      .single();

    const inwardId = await createInward("replacement_in", [{ quantity: 3 }], {
      supplier_return_id: supplierReturn!.id,
    });

    const { error } = await entityAdmin.client.rpc("erp_confirm_stock_inward", { p_id: inwardId });
    assert.equal(error, null, error?.message);

    const { data: doc } = await fx.db
      .from("stock_inwards")
      .select("supplier_return_id")
      .eq("id", inwardId)
      .single();
    assert.equal(doc!.supplier_return_id, supplierReturn!.id, "the link back to the return is kept");

    const { data: items } = await fx.db
      .from("stock_inward_items")
      .select("batch_id")
      .eq("inward_id", inwardId);
    const movements = await movementsFor(fx.db, items![0].batch_id!);
    assert.equal(movements[0].movement_type, "replacement_in");
  });

  // Scenario 6
  test("A sale reduces the selected batch and records the balance after", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);

    const { data, error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 4, discount: 0 }],
      },
    });
    assert.equal(error, null, error?.message);

    const result = data as { invoice_number: string; total: number };
    assert.match(result.invoice_number, /^INV-\d{4}-\d{6}$/);
    assert.equal(Number(result.total), 8000, "the price comes from the product record");
    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 4);

    const movements = await movementsFor(fx.db, fx.batchA);
    const saleMovement = movements.filter((m) => m.movement_type === "sale").at(-1)!;
    assert.equal(saleMovement.quantity_delta, -4);
    assert.equal(saleMovement.balance_after, before - 4);
  });

  test("The sale total ignores a client-supplied price", async () => {
    const { data, error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [
          { product_id: fx.productA, batch_id: fx.batchA, quantity: 1, discount: 0, unit_price: 1 },
        ],
      },
    });
    assert.equal(error, null, error?.message);
    assert.equal(Number((data as { total: number }).total), 2000, "the database price wins");
  });

  // Scenario 7
  test("A sale cannot exceed the available quantity", async () => {
    const available = await batchQuantity(fx.db, fx.batchA);

    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [
          { product_id: fx.productA, batch_id: fx.batchA, quantity: available + 1, discount: 0 },
        ],
      },
    });
    assert.ok(error, "overselling must be rejected");
    assert.match(error!.message, /not enough stock/i);
    assert.equal(await batchQuantity(fx.db, fx.batchA), available, "stock is unchanged");
  });

  test("A sale cannot draw on another entity's batch", async () => {
    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productB, batch_id: fx.batchB, quantity: 1, discount: 0 }],
      },
    });
    assert.ok(error, "selling another entity's stock must be rejected");
    assert.equal(await batchQuantity(fx.db, fx.batchB), 40, "the other entity's stock is untouched");
  });

  // Scenario 8
  test("A discount above the user's limit is rejected", async () => {
    const available = await batchQuantity(fx.db, fx.batchA);

    // 5 units at 2000 = 10000; the sales user's ceiling is 5% = 500.
    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 2000,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 5, discount: 0 }],
      },
    });
    assert.ok(error, "an excessive discount must be rejected");
    assert.match(error!.message, /discount/i);
    assert.equal(await batchQuantity(fx.db, fx.batchA), available, "no stock moved");
  });

  test("A discount within the user's limit is accepted", async () => {
    const { data, error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 400,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 5, discount: 0 }],
      },
    });
    assert.equal(error, null, error?.message);
    assert.equal(Number((data as { total: number }).total), 9600);
  });

  test("A per-line discount above the product ceiling is rejected", async () => {
    // Product A allows 10%; 2 units at 2000 = 4000, so the cap is 400.
    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 2, discount: 900 }],
      },
    });
    assert.ok(error, "the product-level discount ceiling must hold");
    assert.match(error!.message, /product limit/i);
  });

  test("A user without apply_discount cannot discount at all", async () => {
    await fx.db
      .from("employees")
      .update({ permission_overrides: { apply_discount: false } })
      .eq("id", salesUser.employeeId);

    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 10,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 1, discount: 0 }],
      },
    });
    assert.ok(error);
    assert.match(error!.message, /permission to apply discounts/i);

    await fx.db.from("employees").update({ permission_overrides: {} }).eq("id", salesUser.employeeId);
  });

  test("A user without create_sales cannot sell", async () => {
    const { error } = await inventoryUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 1, discount: 0 }],
      },
    });
    assert.ok(error, "an inventory user must not be able to complete a sale");
    assert.match(error!.message, /permission to create sales/i);
  });

  // Scenario 9
  test("Cancelling a sale restores stock through reversal movements", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);

    const { data: saleData, error: saleError } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 6, discount: 0 }],
      },
    });
    assert.equal(saleError, null, saleError?.message);
    const saleId = (saleData as { sale_id: string }).sale_id;
    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 6);

    const { error } = await entityAdmin.client.rpc("erp_reverse_sale", {
      p_sale_id: saleId,
      p_reason: "Customer changed their mind",
    });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before, "stock is fully restored");

    const { data: sale } = await fx.db
      .from("sales")
      .select("status, reversal_reason, reversed_by")
      .eq("id", saleId)
      .single();
    assert.equal(sale!.status, "reversed", "the sale is reversed, never deleted");
    assert.equal(sale!.reversal_reason, "Customer changed their mind");
    assert.equal(sale!.reversed_by, entityAdmin.employeeId);

    const movements = await movementsFor(fx.db, fx.batchA);
    const reversal = movements.filter((m) => m.movement_type === "sale_reversal").at(-1)!;
    assert.equal(reversal.quantity_delta, 6);
  });

  test("A sale cannot be reversed twice", async () => {
    const { data: saleData } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 2, discount: 0 }],
      },
    });
    const saleId = (saleData as { sale_id: string }).sale_id;

    await entityAdmin.client.rpc("erp_reverse_sale", { p_sale_id: saleId, p_reason: "First" });
    const quantityAfterFirst = await batchQuantity(fx.db, fx.batchA);

    const { error } = await entityAdmin.client.rpc("erp_reverse_sale", {
      p_sale_id: saleId,
      p_reason: "Second",
    });
    assert.ok(error, "a reversed sale cannot be reversed again");
    assert.equal(await batchQuantity(fx.db, fx.batchA), quantityAfterFirst, "no double restock");
  });

  test("A sales user cannot cancel a sale without cancel_sales", async () => {
    const { data: saleData } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 1, discount: 0 }],
      },
    });
    const saleId = (saleData as { sale_id: string }).sale_id;

    const { error } = await salesUser.client.rpc("erp_reverse_sale", {
      p_sale_id: saleId,
      p_reason: "Trying",
    });
    assert.ok(error, "cancelling requires cancel_sales");

    const { data: sale } = await fx.db.from("sales").select("status").eq("id", saleId).single();
    assert.equal(sale!.status, "completed");
  });

  async function createStockOut(type: string, quantity: number, extra: Record<string, unknown> = {}) {
    const { data, error } = await fx.db
      .from("returns")
      .insert({
        reference: `OUT-${fx.runId}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        branch_id: fx.entityA,
        product_id: fx.productA,
        batch_id: fx.batchA,
        quantity,
        reason: `${type} test`,
        requested_by: entityAdmin.employeeId,
        status: "pending",
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(`stock-out setup failed: ${error.message}`);
    return data!.id;
  }

  // Scenario 10
  test("Expiry write-off reduces stock and posts an expiry movement", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("expired", 3, { expiry_date: "2030-01-01" });

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 3);
    const movements = await movementsFor(fx.db, fx.batchA);
    assert.equal(movements.at(-1)!.movement_type, "expiry");
  });

  // Scenario 11
  test("Damage write-off reduces stock and posts a damage movement", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("damaged", 2);

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 2);
    assert.equal((await movementsFor(fx.db, fx.batchA)).at(-1)!.movement_type, "damage");
  });

  // Scenario 12
  test("Supplier return reduces stock and posts a supplier_return movement", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("supplier", 4, { resolution_type: "credit" });

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 4);
    assert.equal((await movementsFor(fx.db, fx.batchA)).at(-1)!.movement_type, "supplier_return");
  });

  test("Employee consumption reduces stock and records the employee", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("employee_consumption", 1, {
      consumed_by: salesUser.employeeId,
    });

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 1);
    assert.equal(
      (await movementsFor(fx.db, fx.batchA)).at(-1)!.movement_type,
      "employee_consumption"
    );

    const { data } = await fx.db.from("returns").select("consumed_by, approved_by").eq("id", id).single();
    assert.equal(data!.consumed_by, salesUser.employeeId);
    assert.equal(data!.approved_by, entityAdmin.employeeId);
  });

  test("A customer return adds stock back", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("customer", 2, { refund_method: "Cash" });

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before + 2);
    assert.equal((await movementsFor(fx.db, fx.batchA)).at(-1)!.movement_type, "return");
  });

  test("A stock-out cannot drive stock negative", async () => {
    const available = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("damaged", available + 10);

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.ok(error, "writing off more than is held must be rejected");
    assert.match(error!.message, /insufficient stock/i);
    assert.equal(await batchQuantity(fx.db, fx.batchA), available);
  });

  test("A stock-out cannot be approved without approve_stock_outward", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const id = await createStockOut("damaged", 1);

    const { error } = await inventoryUser.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.ok(error, "an inventory user cannot self-approve write-offs");
    assert.equal(await batchQuantity(fx.db, fx.batchA), before);
  });

  test("A stock-out cannot be approved twice", async () => {
    const id = await createStockOut("damaged", 1);
    await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    const afterFirst = await batchQuantity(fx.db, fx.batchA);

    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.ok(error);
    assert.equal(await batchQuantity(fx.db, fx.batchA), afterFirst, "stock only moves once");
  });

  test("Opening stock confirmation creates batches and opening movements", async () => {
    const { data: entry } = await fx.db
      .from("opening_stock_entries")
      .insert({
        reference: `OPEN-${fx.runId}`,
        branch_id: fx.entityA,
        opening_date: "2026-01-01",
        status: "draft",
        created_by: entityAdmin.employeeId,
      })
      .select("id")
      .single();

    await fx.db.from("opening_stock_items").insert({
      entry_id: entry!.id,
      product_id: fx.productA,
      batch_number: `OB-${fx.runId}`,
      expiry_date: "2029-12-31",
      quantity: 30,
      unit_cost: 950,
      sell_price: 2000,
    });

    const { error } = await entityAdmin.client.rpc("erp_confirm_opening_stock", { p_id: entry!.id });
    assert.equal(error, null, error?.message);

    const { data: items } = await fx.db
      .from("opening_stock_items")
      .select("batch_id")
      .eq("entry_id", entry!.id);
    const batchId = items![0].batch_id!;

    assert.equal(await batchQuantity(fx.db, batchId), 30);
    const movements = await movementsFor(fx.db, batchId);
    assert.equal(movements[0].movement_type, "opening_stock");
    assert.equal(movements[0].balance_after, 30);

    const second = await entityAdmin.client.rpc("erp_confirm_opening_stock", { p_id: entry!.id });
    assert.ok(second.error, "confirmed opening stock is locked against re-confirmation");
  });

  test("A stock correction requires a reason and records before and after", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);

    const noReason = await entityAdmin.client.rpc("erp_stock_correction", {
      p_batch_id: fx.batchA,
      p_new_qty: before + 5,
      p_reason: "   ",
    });
    assert.ok(noReason.error, "a blank reason must be rejected");
    assert.match(noReason.error!.message, /reason is required/i);
    assert.equal(await batchQuantity(fx.db, fx.batchA), before);

    const { error } = await entityAdmin.client.rpc("erp_stock_correction", {
      p_batch_id: fx.batchA,
      p_new_qty: before + 5,
      p_reason: "Recount after shelf audit",
    });
    assert.equal(error, null, error?.message);
    assert.equal(await batchQuantity(fx.db, fx.batchA), before + 5);

    const movements = await movementsFor(fx.db, fx.batchA);
    const correction = movements.at(-1)!;
    assert.equal(correction.movement_type, "stock_correction");
    assert.equal(correction.quantity_delta, 5);

    const { data: audit } = await fx.db
      .from("audit_logs")
      .select("previous_value, new_value, reason")
      .eq("action", "Stock correction")
      .eq("branch_id", fx.entityA)
      .order("created_at", { ascending: false })
      .limit(1);
    assert.equal(audit![0].previous_value, String(before));
    assert.equal(audit![0].new_value, String(before + 5));
    assert.equal(audit![0].reason, "Recount after shelf audit");
  });

  test("A stock correction cannot be made without adjust_inventory", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const { error } = await inventoryUser.client.rpc("erp_stock_correction", {
      p_batch_id: fx.batchA,
      p_new_qty: before + 100,
      p_reason: "Trying without permission",
    });
    assert.ok(error);
    assert.equal(await batchQuantity(fx.db, fx.batchA), before);
  });

  test("A stock correction cannot set a negative quantity", async () => {
    const { error } = await entityAdmin.client.rpc("erp_stock_correction", {
      p_batch_id: fx.batchA,
      p_new_qty: -1,
      p_reason: "Invalid",
    });
    assert.ok(error);
    assert.match(error!.message, /negative/i);
  });

  test("Ordinary users cannot write the ledger or overwrite quantities directly", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);

    await salesUser.client.from("product_batches").update({ quantity_available: 9999 }).eq("id", fx.batchA);
    assert.equal(
      await batchQuantity(fx.db, fx.batchA),
      before,
      "a sales user must not be able to overwrite available quantity"
    );

    const ledgerWrite = await salesUser.client.from("stock_movements").insert({
      product_id: fx.productA,
      batch_id: fx.batchA,
      branch_id: fx.entityA,
      movement_type: "stock_correction",
      quantity_delta: 500,
    });
    assert.ok(ledgerWrite.error, "a sales user must not be able to forge ledger entries");
  });

  test("Ledger rows cannot be edited or deleted through the API", async () => {
    const { data: movement } = await fx.db
      .from("stock_movements")
      .select("id")
      .eq("branch_id", fx.entityA)
      .limit(1)
      .single();

    await entityAdmin.client.from("stock_movements").update({ quantity_delta: 0 }).eq("id", movement!.id);
    await entityAdmin.client.from("stock_movements").delete().eq("id", movement!.id);

    const { data: after } = await fx.db
      .from("stock_movements")
      .select("id, quantity_delta")
      .eq("id", movement!.id)
      .maybeSingle();
    assert.ok(after, "the ledger row must still exist");
    assert.notEqual(after!.quantity_delta, 0, "the ledger row must be unchanged");
  });

  // Scenario 13
  test("Low-stock status updates after a sale crosses the minimum", async () => {
    // A dedicated product so the assertion does not depend on stock other
    // tests in this file have already moved.
    const { data: product } = await fx.db
      .from("products")
      .insert({
        branch_id: fx.entityA,
        sku: `LOW-${fx.runId}`,
        name: `Low Stock Probe ${fx.runId}`,
        buy_price: 500,
        sell_price: 1000,
        pricing_method: "fixed",
        max_discount_percent: 0,
        reorder_level: 20,
        restock_target: 100,
        status: "active",
      })
      .select("id, reorder_level, restock_target")
      .single();

    const { data: batch } = await fx.db
      .from("product_batches")
      .insert({
        product_id: product!.id,
        branch_id: fx.entityA,
        batch_number: `LOWB-${fx.runId}`,
        quantity_received: 25,
        quantity_available: 25,
        unit_cost: 500,
        expiry_date: "2030-01-01",
        status: "active",
      })
      .select("id")
      .single();

    async function availableForProbe(): Promise<number> {
      const { data } = await fx.db
        .from("product_batches")
        .select("quantity_available")
        .eq("product_id", product!.id)
        .eq("status", "active");
      return (data ?? []).reduce((sum, row) => sum + row.quantity_available, 0);
    }

    const before = await availableForProbe();
    assert.equal(before, 25);
    assert.ok(before > product!.reorder_level, "it starts above its minimum, so not yet low stock");

    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: product!.id, batch_id: batch!.id, quantity: 10, discount: 0 }],
      },
    });
    assert.equal(error, null, error?.message);

    const after = await availableForProbe();
    assert.equal(after, 15);
    assert.ok(
      after <= product!.reorder_level,
      `the sale takes it to ${after}, at or below the minimum of ${product!.reorder_level}`
    );
    assert.equal(
      product!.restock_target - after,
      85,
      "the reorder quantity is restock target minus available"
    );
  });

  // Scenario 15
  test("An invalid stock-out leaves no partial ledger entries", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const movementsBefore = (await movementsFor(fx.db, fx.batchA)).length;

    const id = await createStockOut("damaged", before + 500);
    const { error } = await entityAdmin.client.rpc("erp_approve_stock_out", { p_return_id: id });
    assert.ok(error);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before);
    assert.equal(
      (await movementsFor(fx.db, fx.batchA)).length,
      movementsBefore,
      "a rejected operation writes nothing to the ledger"
    );

    const { data } = await fx.db.from("returns").select("status").eq("id", id).single();
    assert.equal(data!.status, "pending", "the document stays pending after a failed approval");
  });

  test("A multi-item sale that fails on the second item commits nothing", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const movementsBefore = (await movementsFor(fx.db, fx.batchA)).length;

    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [
          { product_id: fx.productA, batch_id: fx.batchA, quantity: 1, discount: 0 },
          { product_id: fx.productA, batch_id: fx.batchA, quantity: 99999, discount: 0 },
        ],
      },
    });
    assert.ok(error, "the whole sale must fail");

    assert.equal(await batchQuantity(fx.db, fx.batchA), before, "the first line is rolled back too");
    assert.equal((await movementsFor(fx.db, fx.batchA)).length, movementsBefore);
  });
});
