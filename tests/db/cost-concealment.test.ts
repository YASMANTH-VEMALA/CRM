import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createUser, hasCredentials, setupFixture, type Fixture, type TestUser } from "./helpers";

/**
 * Regression tests for audit finding HIGH-1.
 *
 * Purchase cost used to be concealed only in the application layer: the
 * loaders nulled buy_price / unit_cost for users without view_purchase_cost,
 * but the browser holds the anon key and the user's JWT, so a sales user could
 * read the real figures straight from PostgREST. Both of these returned live
 * values during the audit:
 *
 *   GET /rest/v1/products?select=buy_price
 *   GET /rest/v1/product_batches?select=unit_cost
 *
 * Migration 0015 revokes SELECT on those two columns from `authenticated` and
 * re-exposes them through the product_costs / batch_costs views, which check
 * has_entity_access AND has_perm('view_purchase_cost') themselves.
 */
describe("purchase cost concealment", { skip: !hasCredentials && "no Supabase credentials" }, () => {
  let fx: Fixture;
  let salesUser: TestUser;
  let entityAdmin: TestUser;
  let adminB: TestUser;

  before(async () => {
    fx = await setupFixture();
    salesUser = await createUser(fx.db, fx.runId, {
      label: "cost-sales",
      role: "sales_user",
      branchId: fx.entityA,
      maxDiscountPercent: 5,
    });
    entityAdmin = await createUser(fx.db, fx.runId, {
      label: "cost-admin",
      role: "entity_admin",
      branchId: fx.entityA,
      maxDiscountPercent: 50,
    });
    adminB = await createUser(fx.db, fx.runId, {
      label: "cost-admin-b",
      role: "entity_admin",
      branchId: fx.entityB,
      maxDiscountPercent: 50,
    });
    fx.users.push(salesUser, entityAdmin, adminB);
  });

  after(async () => {
    await fx?.cleanup();
  });

  // -------------------------------------------------------------------------
  // The direct API routes that used to leak
  // -------------------------------------------------------------------------

  test("HIGH-1: a sales user cannot select products.buy_price", async () => {
    const { data, error } = await salesUser.client.from("products").select("id, buy_price").eq("id", fx.productA);
    assert.ok(error, "selecting the cost column must be refused outright");
    assert.equal(data, null);
  });

  test("HIGH-1: a sales user cannot select product_batches.unit_cost", async () => {
    const { data, error } = await salesUser.client
      .from("product_batches")
      .select("id, unit_cost")
      .eq("id", fx.batchA);
    assert.ok(error, "selecting the cost column must be refused outright");
    assert.equal(data, null);
  });

  test("HIGH-1: `select *` does not smuggle cost through either", async () => {
    const products = await salesUser.client.from("products").select("*").eq("id", fx.productA);
    assert.ok(products.error, "a wildcard select must be refused while cost is revoked");

    const batches = await salesUser.client.from("product_batches").select("*").eq("id", fx.batchA);
    assert.ok(batches.error, "a wildcard select must be refused while cost is revoked");
  });

  test("HIGH-1: the cost views return nothing to a sales user", async () => {
    const products = await salesUser.client.from("product_costs").select("product_id, buy_price");
    assert.deepEqual(products.data ?? [], [], "product_costs must be empty without the permission");

    const batches = await salesUser.client.from("batch_costs").select("batch_id, unit_cost");
    assert.deepEqual(batches.data ?? [], [], "batch_costs must be empty without the permission");
  });

  test("HIGH-1: a sales user still sees everything they legitimately need", async () => {
    const { data, error } = await salesUser.client
      .from("products")
      .select("id, sku, name, sell_price, max_discount_percent")
      .eq("id", fx.productA);
    assert.equal(error, null, error?.message);
    assert.equal(data?.length, 1, "selling price and product detail stay readable");
    assert.equal(Number(data![0].sell_price), 2000);
  });

  test("HIGH-1: price history does not leak cost to a sales user", async () => {
    await fx.db.from("product_price_history").insert([
      {
        product_id: fx.productA,
        branch_id: fx.entityA,
        field: "buy_price",
        previous_value: "1000",
        new_value: "1300",
        change_type: "manual",
      },
      {
        product_id: fx.productA,
        branch_id: fx.entityA,
        field: "sell_price",
        previous_value: "2000",
        new_value: "2400",
        change_type: "manual",
      },
    ]);

    const { data } = await salesUser.client
      .from("product_price_history")
      .select("field, new_value")
      .eq("product_id", fx.productA);

    const fields = (data ?? []).map((row) => row.field);
    assert.ok(!fields.includes("buy_price"), "cost-change rows must be hidden");
    assert.ok(fields.includes("sell_price"), "selling-price history stays visible");
  });

  // -------------------------------------------------------------------------
  // Authorised users still get the real numbers
  // -------------------------------------------------------------------------

  test("HIGH-1: an entity admin reads cost through the views", async () => {
    const products = await entityAdmin.client
      .from("product_costs")
      .select("product_id, buy_price")
      .eq("product_id", fx.productA);
    assert.equal(products.data?.length, 1, products.error?.message);
    assert.equal(Number(products.data![0].buy_price), 1000, "the real purchase cost");

    const batches = await entityAdmin.client
      .from("batch_costs")
      .select("batch_id, unit_cost")
      .eq("batch_id", fx.batchA);
    assert.equal(batches.data?.length, 1, batches.error?.message);
    assert.equal(Number(batches.data![0].unit_cost), 1000, "the real unit cost");
  });

  test("HIGH-1: the views are entity-scoped, not just permission-scoped", async () => {
    // Entity A's admin has view_purchase_cost but no claim on Entity B.
    const crossProduct = await entityAdmin.client
      .from("product_costs")
      .select("product_id")
      .eq("product_id", fx.productB);
    assert.deepEqual(crossProduct.data ?? [], [], "another entity's cost stays invisible");

    const crossBatch = await entityAdmin.client
      .from("batch_costs")
      .select("batch_id")
      .eq("batch_id", fx.batchB);
    assert.deepEqual(crossBatch.data ?? [], [], "another entity's batch cost stays invisible");

    // And the mirror image, so this is not an artefact of one direction.
    const ownB = await adminB.client.from("product_costs").select("product_id").eq("product_id", fx.productB);
    assert.equal(ownB.data?.length, 1, "Entity B's admin sees Entity B's cost");
  });

  test("HIGH-1: revoking the permission by override closes the views immediately", async () => {
    await fx.db
      .from("employees")
      .update({ permission_overrides: { view_purchase_cost: false } })
      .eq("id", entityAdmin.employeeId);

    const { data } = await entityAdmin.client.from("product_costs").select("product_id");
    assert.deepEqual(data ?? [], [], "an override that revokes the permission closes the view");

    await fx.db.from("employees").update({ permission_overrides: {} }).eq("id", entityAdmin.employeeId);
  });

  test("HIGH-1: writes are untouched — cost can still be set and changed", async () => {
    const { error: insertError } = await entityAdmin.client.from("products").insert({
      branch_id: fx.entityA,
      sku: `COSTW-${fx.runId}`,
      name: `Cost write ${fx.runId}`,
      buy_price: 777,
      sell_price: 1500,
      status: "active",
    });
    assert.equal(insertError, null, "revoking SELECT must not block INSERT of the column");

    const { data: created } = await fx.db
      .from("products")
      .select("id, buy_price")
      .eq("sku", `COSTW-${fx.runId}`)
      .single();
    assert.equal(Number(created!.buy_price), 777, "the value really was written");

    const { error: updateError } = await entityAdmin.client
      .from("products")
      .update({ buy_price: 888 })
      .eq("id", created!.id);
    assert.equal(updateError, null, "revoking SELECT must not block UPDATE of the column");

    const { data: updated } = await fx.db
      .from("products")
      .select("buy_price")
      .eq("id", created!.id)
      .single();
    assert.equal(Number(updated!.buy_price), 888);
  });

  test("HIGH-1: anonymous callers get nothing from either view", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { SUPABASE_URL, ANON_KEY } = await import("./helpers");
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

    const products = await anon.from("product_costs").select("buy_price").limit(1);
    assert.ok(products.error || (products.data ?? []).length === 0, "anon must not read cost");

    const batches = await anon.from("batch_costs").select("unit_cost").limit(1);
    assert.ok(batches.error || (batches.data ?? []).length === 0, "anon must not read cost");
  });
});
