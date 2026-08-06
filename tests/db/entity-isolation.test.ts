import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createUser, hasCredentials, setupFixture, type Fixture, type TestUser } from "./helpers";

/**
 * Required scenarios 1, 2, 16, 17, 18: cross-entity isolation and the
 * field-level visibility rules, verified through RLS rather than the UI.
 */
describe("entity isolation and visibility", { skip: !hasCredentials && "no Supabase credentials" }, () => {
  let fx: Fixture;
  let entityAAdmin: TestUser;
  let entityBAdmin: TestUser;
  let salesUserA: TestUser;
  let masterAdmin: TestUser;

  before(async () => {
    fx = await setupFixture();
    entityAAdmin = await createUser(fx.db, fx.runId, {
      label: "admin-a",
      role: "entity_admin",
      branchId: fx.entityA,
      maxDiscountPercent: 50,
    });
    entityBAdmin = await createUser(fx.db, fx.runId, {
      label: "admin-b",
      role: "entity_admin",
      branchId: fx.entityB,
      maxDiscountPercent: 50,
    });
    salesUserA = await createUser(fx.db, fx.runId, {
      label: "sales-a",
      role: "sales_user",
      branchId: fx.entityA,
      maxDiscountPercent: 5,
    });
    masterAdmin = await createUser(fx.db, fx.runId, {
      label: "master",
      role: "master_admin",
      branchId: null,
      maxDiscountPercent: 100,
    });
    fx.users.push(entityAAdmin, entityBAdmin, salesUserA, masterAdmin);
  });

  after(async () => {
    await fx?.cleanup();
  });

  // Scenario 1
  test("Entity A user cannot read Entity B products", async () => {
    const { data } = await entityAAdmin.client.from("products").select("id").eq("id", fx.productB);
    assert.deepEqual(data, [], "Entity B's product must be invisible to an Entity A user");

    const own = await entityAAdmin.client.from("products").select("id").eq("id", fx.productA);
    assert.equal(own.data?.length, 1, "the user still sees their own entity's product");
  });

  test("Entity A user cannot read Entity B stock batches", async () => {
    const { data } = await entityAAdmin.client
      .from("product_batches")
      .select("id")
      .eq("id", fx.batchB);
    assert.deepEqual(data, []);
  });

  test("Entity A user cannot read Entity B suppliers or customers", async () => {
    const suppliers = await entityAAdmin.client
      .from("suppliers")
      .select("id, branch_id")
      .eq("branch_id", fx.entityB);
    assert.deepEqual(suppliers.data, []);
  });

  test("Entity A user cannot write into Entity B", async () => {
    const { error } = await entityAAdmin.client.from("products").insert({
      branch_id: fx.entityB,
      sku: `LEAK-${fx.runId}`,
      name: "Cross-entity leak attempt",
      buy_price: 1,
      sell_price: 2,
    });
    assert.ok(error, "inserting into another entity must be rejected");

    const { data } = await fx.db.from("products").select("id").eq("sku", `LEAK-${fx.runId}`);
    assert.deepEqual(data, [], "no row may be created in the other entity");
  });

  test("Entity A user cannot update an Entity B product even knowing its id", async () => {
    await entityAAdmin.client.from("products").update({ sell_price: 1 }).eq("id", fx.productB);
    const { data } = await fx.db.from("products").select("sell_price").eq("id", fx.productB).single();
    assert.equal(Number(data!.sell_price), 3000, "the price must be untouched");
  });

  test("Entity A user cannot see Entity B's entity record", async () => {
    const { data } = await entityAAdmin.client.from("branches").select("id").eq("id", fx.entityB);
    assert.deepEqual(data, []);
  });

  // Scenario 17
  test("Entity admin sees only their own entity in the entity list", async () => {
    const { data } = await entityAAdmin.client.from("branches").select("id");
    const ids = (data ?? []).map((row) => row.id);
    assert.ok(ids.includes(fx.entityA));
    assert.ok(!ids.includes(fx.entityB));
  });

  // Scenario 16
  test("Master admin can read both entities for consolidated reporting", async () => {
    const { data } = await masterAdmin.client.from("branches").select("id");
    const ids = (data ?? []).map((row) => row.id);
    assert.ok(ids.includes(fx.entityA), "master admin sees Entity A");
    assert.ok(ids.includes(fx.entityB), "master admin sees Entity B");

    const products = await masterAdmin.client
      .from("products")
      .select("id")
      .in("id", [fx.productA, fx.productB]);
    assert.equal(products.data?.length, 2, "master admin sees products from both entities");
  });

  // Scenario 2
  test("Sales user has no purchase-cost, profit or report permissions", async () => {
    const checks = await Promise.all([
      salesUserA.client.rpc("has_perm", { p: "view_purchase_cost" }),
      salesUserA.client.rpc("has_perm", { p: "view_profit" }),
      salesUserA.client.rpc("has_perm", { p: "view_management_reports" }),
      salesUserA.client.rpc("has_perm", { p: "access_multiple_entities" }),
    ]);
    for (const check of checks) {
      assert.equal(check.data, false, `expected permission to be denied: ${check.error?.message ?? ""}`);
    }
  });

  test("Sales user does have the permissions the POS needs", async () => {
    const sell = await salesUserA.client.rpc("has_perm", { p: "create_sales" });
    const view = await salesUserA.client.rpc("has_perm", { p: "view_products" });
    assert.equal(sell.data, true);
    assert.equal(view.data, true);
  });

  // Scenario 18
  test("Sales user cannot read the audit log, which carries cost changes", async () => {
    const { data } = await salesUserA.client.from("audit_logs").select("id").limit(5);
    assert.deepEqual(data, [], "audit history requires view_management_reports");
  });

  test("Sales user cannot create or edit products", async () => {
    const insert = await salesUserA.client.from("products").insert({
      branch_id: fx.entityA,
      sku: `SALES-${fx.runId}`,
      name: "Sales user product",
      buy_price: 1,
      sell_price: 2,
    });
    assert.ok(insert.error, "creating products requires create_products");

    await salesUserA.client.from("products").update({ sell_price: 1 }).eq("id", fx.productA);
    const { data } = await fx.db.from("products").select("sell_price").eq("id", fx.productA).single();
    assert.equal(Number(data!.sell_price), 2000, "the sales user must not change prices");
  });

  test("A permission override grants access without changing the role", async () => {
    await fx.db
      .from("employees")
      .update({ permission_overrides: { view_purchase_cost: true } })
      .eq("id", salesUserA.employeeId);

    const granted = await salesUserA.client.rpc("has_perm", { p: "view_purchase_cost" });
    assert.equal(granted.data, true, "the override must take effect");

    const stillNoProfit = await salesUserA.client.rpc("has_perm", { p: "view_profit" });
    assert.equal(stillNoProfit.data, false, "unrelated permissions stay denied");

    await fx.db
      .from("employees")
      .update({ permission_overrides: {} })
      .eq("id", salesUserA.employeeId);
  });

  test("A permission override can revoke a role default", async () => {
    await fx.db
      .from("employees")
      .update({ permission_overrides: { view_profit: false } })
      .eq("id", entityBAdmin.employeeId);

    const revoked = await entityBAdmin.client.rpc("has_perm", { p: "view_profit" });
    assert.equal(revoked.data, false, "an entity admin's profit access can be withdrawn");

    await fx.db
      .from("employees")
      .update({ permission_overrides: {} })
      .eq("id", entityBAdmin.employeeId);
  });

  test("A disabled employee loses all access", async () => {
    await fx.db.from("employees").update({ status: "disabled" }).eq("id", entityBAdmin.employeeId);

    const { data } = await entityBAdmin.client.from("products").select("id").eq("id", fx.productB);
    assert.deepEqual(data, [], "a disabled account must read nothing");

    await fx.db.from("employees").update({ status: "active" }).eq("id", entityBAdmin.employeeId);
  });

  test("A non-master user cannot escalate their own role", async () => {
    const { error } = await entityAAdmin.client
      .from("employees")
      .update({ role: "master_admin" })
      .eq("id", entityAAdmin.employeeId);
    assert.ok(error, "granting yourself master_admin must be blocked");

    const { data } = await fx.db
      .from("employees")
      .select("role")
      .eq("id", entityAAdmin.employeeId)
      .single();
    assert.equal(data!.role, "entity_admin", "the role must be unchanged");
  });

  test("A sales user cannot grant themselves permissions", async () => {
    const { error } = await salesUserA.client
      .from("employees")
      .update({ permission_overrides: { view_profit: true } })
      .eq("id", salesUserA.employeeId);
    assert.ok(error, "editing your own permission overrides must be blocked");

    const denied = await salesUserA.client.rpc("has_perm", { p: "view_profit" });
    assert.equal(denied.data, false);
  });

  test("A sales user cannot raise their own discount ceiling", async () => {
    const { error } = await salesUserA.client
      .from("employees")
      .update({ max_discount_percent: 100 })
      .eq("id", salesUserA.employeeId);
    assert.ok(error, "raising your own discount limit must be blocked");

    const { data } = await fx.db
      .from("employees")
      .select("max_discount_percent")
      .eq("id", salesUserA.employeeId)
      .single();
    assert.equal(Number(data!.max_discount_percent), 5);
  });

  test("Explicit multi-entity access opens exactly the granted entity", async () => {
    const before = await entityAAdmin.client.from("branches").select("id").eq("id", fx.entityB);
    assert.deepEqual(before.data, [], "no access before the grant");

    await fx.db
      .from("employee_entities")
      .insert({ employee_id: entityAAdmin.employeeId, branch_id: fx.entityB });

    const after = await entityAAdmin.client.from("branches").select("id").eq("id", fx.entityB);
    assert.equal(after.data?.length, 1, "the granted entity becomes visible");

    const products = await entityAAdmin.client.from("products").select("id").eq("id", fx.productB);
    assert.equal(products.data?.length, 1, "and so does its data");

    await fx.db
      .from("employee_entities")
      .delete()
      .eq("employee_id", entityAAdmin.employeeId)
      .eq("branch_id", fx.entityB);

    const revoked = await entityAAdmin.client.from("products").select("id").eq("id", fx.productB);
    assert.deepEqual(revoked.data, [], "revoking the grant closes access again");
  });
});
