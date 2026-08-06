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
 * Regression tests for audit finding HIGH-2.
 *
 * The ledger was append-only but not append-controlled: movements_insert let
 * any holder of create_stock_inward / adjust_inventory / create_stock_outward
 * POST arbitrary rows to stock_movements. An inventory user could forge a
 * "+99999 purchase" entry — quantities stayed right, but every ledger-derived
 * report and the audit trail itself could be poisoned.
 *
 * Migration 0014 drops that policy and revokes INSERT/UPDATE/DELETE on the
 * table from `authenticated`, so the only remaining writer is fn_post_movement
 * inside a SECURITY DEFINER erp_* RPC.
 *
 * The suite proves both halves: forgery is impossible, and every legitimate
 * stock operation still writes its ledger entry.
 */
describe("inventory ledger integrity", { skip: !hasCredentials && "no Supabase credentials" }, () => {
  let fx: Fixture;
  let inventoryUser: TestUser;
  let entityAdmin: TestUser;
  let salesUser: TestUser;

  before(async () => {
    fx = await setupFixture();
    inventoryUser = await createUser(fx.db, fx.runId, {
      label: "led-inv",
      role: "inventory_user",
      branchId: fx.entityA,
    });
    entityAdmin = await createUser(fx.db, fx.runId, {
      label: "led-admin",
      role: "entity_admin",
      branchId: fx.entityA,
      maxDiscountPercent: 50,
    });
    salesUser = await createUser(fx.db, fx.runId, {
      label: "led-sales",
      role: "sales_user",
      branchId: fx.entityA,
      maxDiscountPercent: 5,
    });
    fx.users.push(inventoryUser, entityAdmin, salesUser);
  });

  after(async () => {
    await fx?.cleanup();
  });

  // -------------------------------------------------------------------------
  // Forgery is impossible
  // -------------------------------------------------------------------------

  test("HIGH-2: an inventory user cannot forge a ledger row", async () => {
    const { data, error } = await inventoryUser.client
      .from("stock_movements")
      .insert({
        product_id: fx.productA,
        batch_id: fx.batchA,
        branch_id: fx.entityA,
        movement_type: "purchase",
        quantity_delta: 99999,
        balance_after: 99999,
      })
      .select("id");

    assert.ok(error, "a direct ledger insert must be refused");
    assert.deepEqual(data ?? [], [], "no row may be returned");

    const { data: forged } = await fx.db
      .from("stock_movements")
      .select("id")
      .eq("batch_id", fx.batchA)
      .eq("quantity_delta", 99999);
    assert.deepEqual(forged ?? [], [], "no forged row may exist");
  });

  test("HIGH-2: no role can insert into the ledger directly", async () => {
    for (const user of [
      { name: "inventory_user", client: inventoryUser.client },
      { name: "entity_admin", client: entityAdmin.client },
      { name: "sales_user", client: salesUser.client },
    ]) {
      const { error } = await user.client.from("stock_movements").insert({
        product_id: fx.productA,
        batch_id: fx.batchA,
        branch_id: fx.entityA,
        movement_type: "stock_correction",
        quantity_delta: 5,
        balance_after: 5,
      });
      assert.ok(error, `${user.name} must not be able to write the ledger`);
    }
  });

  test("HIGH-2: ledger rows still cannot be updated or deleted", async () => {
    const { data: movement } = await fx.db
      .from("stock_movements")
      .select("id, quantity_delta")
      .eq("branch_id", fx.entityA)
      .limit(1)
      .maybeSingle();

    if (!movement) {
      // Nothing in the ledger yet for this fixture; create one legitimately.
      await entityAdmin.client.rpc("erp_stock_correction", {
        p_batch_id: fx.batchA,
        p_new_qty: 49,
        p_reason: "seed a ledger row for the immutability check",
      });
    }

    const { data: row } = await fx.db
      .from("stock_movements")
      .select("id, quantity_delta")
      .eq("branch_id", fx.entityA)
      .limit(1)
      .single();

    await entityAdmin.client.from("stock_movements").update({ quantity_delta: 0 }).eq("id", row!.id);
    await entityAdmin.client.from("stock_movements").delete().eq("id", row!.id);

    const { data: after } = await fx.db
      .from("stock_movements")
      .select("id, quantity_delta")
      .eq("id", row!.id)
      .maybeSingle();
    assert.ok(after, "the ledger row must still exist");
    assert.equal(after!.quantity_delta, row!.quantity_delta, "and be unchanged");
  });

  test("HIGH-2: batch quantities cannot be overwritten to match a forged ledger", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    await inventoryUser.client
      .from("product_batches")
      .update({ quantity_available: 99999 })
      .eq("id", fx.batchA);
    assert.equal(
      await batchQuantity(fx.db, fx.batchA),
      before,
      "quantity_available is ledger-derived and must not be directly writable"
    );
  });

  // -------------------------------------------------------------------------
  // Legitimate operations still write the ledger
  // -------------------------------------------------------------------------

  test("HIGH-2 regression guard: a stock correction still writes a ledger entry", async () => {
    const target = 42;
    const { error } = await entityAdmin.client.rpc("erp_stock_correction", {
      p_batch_id: fx.batchA,
      p_new_qty: target,
      p_reason: "regression guard",
    });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), target);
    const movements = await movementsFor(fx.db, fx.batchA);
    const correction = movements.filter((m) => m.movement_type === "stock_correction").at(-1);
    assert.ok(correction, "the correction must appear in the ledger");
    assert.equal(correction!.balance_after, target, "with the correct balance after");
  });

  test("HIGH-2 regression guard: a sale still writes a ledger entry", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const { error } = await salesUser.client.rpc("erp_complete_sale", {
      p: {
        customer_id: null,
        payment_method: "Cash",
        discount: 0,
        items: [{ product_id: fx.productA, batch_id: fx.batchA, quantity: 2, discount: 0 }],
      },
    });
    assert.equal(error, null, error?.message);

    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 2);
    const sale = (await movementsFor(fx.db, fx.batchA)).filter((m) => m.movement_type === "sale").at(-1);
    assert.ok(sale, "the sale must appear in the ledger");
    assert.equal(sale!.quantity_delta, -2);
    assert.equal(sale!.balance_after, before - 2);
  });

  test("HIGH-2 regression guard: a stock transfer posts both ledger legs", async () => {
    // The transfer flow used to insert its two ledger rows from application
    // code; it now goes through erp_transfer_stock.
    await fx.db
      .from("employee_entities")
      .insert({ employee_id: entityAdmin.employeeId, branch_id: fx.entityB });

    const sourceBefore = await batchQuantity(fx.db, fx.batchA);
    const { data, error } = await entityAdmin.client.rpc("erp_transfer_stock", {
      p_batch_id: fx.batchA,
      p_to_branch: fx.entityB,
      p_quantity: 4,
    });
    assert.equal(error, null, error?.message);

    const destBatch = (data as { destination_batch: string }).destination_batch;
    assert.equal(await batchQuantity(fx.db, fx.batchA), sourceBefore - 4, "source falls by 4");
    assert.equal(await batchQuantity(fx.db, destBatch), 4, "destination gains 4");

    const out = (await movementsFor(fx.db, fx.batchA)).filter((m) => m.movement_type === "transfer_out").at(-1);
    const into = (await movementsFor(fx.db, destBatch)).filter((m) => m.movement_type === "transfer_in").at(-1);
    assert.ok(out, "transfer_out must be in the ledger");
    assert.ok(into, "transfer_in must be in the ledger");
    assert.equal(out!.quantity_delta, -4);
    assert.equal(into!.quantity_delta, 4);
    assert.equal(into!.balance_after, 4);

    await fx.db
      .from("employee_entities")
      .delete()
      .eq("employee_id", entityAdmin.employeeId)
      .eq("branch_id", fx.entityB);
  });

  test("HIGH-2: a transfer into an entity you cannot reach is refused", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);
    const { error } = await entityAdmin.client.rpc("erp_transfer_stock", {
      p_batch_id: fx.batchA,
      p_to_branch: fx.entityB,
      p_quantity: 1,
    });
    assert.ok(error, "transferring into a foreign entity must be refused");
    assert.match(error!.message, /access to the destination entity/i);
    assert.equal(await batchQuantity(fx.db, fx.batchA), before, "no stock may move");
  });

  test("HIGH-2: the ledger still reconciles exactly with batch quantity", async () => {
    const movements = await movementsFor(fx.db, fx.batchA);
    const ledgerSum = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
    // batchA is seeded at 50 outside the ledger by the fixture, so reconcile
    // against the running balance the ledger itself reports.
    const last = movements.at(-1);
    assert.ok(last, "there must be ledger history by now");
    assert.equal(
      last!.balance_after,
      await batchQuantity(fx.db, fx.batchA),
      "the last balance_after must equal the batch's live quantity"
    );

    let running = movements[0].balance_after! - movements[0].quantity_delta;
    for (const m of movements) {
      running += m.quantity_delta;
      assert.equal(m.balance_after, running, `balance_after drifted at ${m.movement_type}`);
    }
    assert.equal(
      running - (movements[0].balance_after! - movements[0].quantity_delta),
      ledgerSum,
      "the ledger deltas must sum to the net change"
    );
  });
});
