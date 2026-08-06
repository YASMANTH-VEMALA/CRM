import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { batchQuantity, createUser, hasCredentials, setupFixture, type Fixture, type TestUser } from "./helpers";

/**
 * Regression tests for the three critical findings of the Phase 1 security
 * audit. Each test performs the exact attack that succeeded before the fix and
 * asserts that it is now refused AND that no state changed.
 *
 *   CRIT-1  A manage_users holder rewrote their own branch_id / overrides and
 *           walked into another entity.                    (migration 0012)
 *   CRIT-2  permission_overrides accepted master-tier keys, so an entity admin
 *           could mint manage_entities for anyone.         (migration 0011)
 *   CRIT-3  Stock RPCs never checked that the batch/product a document pointed
 *           at lived in the document's entity.             (migration 0013)
 *
 * Every attack runs through a signed-in user against PostgREST, not through the
 * UI, so these prove the server refuses it rather than that a button is hidden.
 */
describe("critical security regressions", { skip: !hasCredentials && "no Supabase credentials" }, () => {
  let fx: Fixture;
  let adminA: TestUser;
  let adminB: TestUser;
  let salesA: TestUser;
  let staffA: TestUser;

  before(async () => {
    fx = await setupFixture();
    adminA = await createUser(fx.db, fx.runId, {
      label: "reg-admin-a",
      role: "entity_admin",
      branchId: fx.entityA,
      maxDiscountPercent: 50,
    });
    adminB = await createUser(fx.db, fx.runId, {
      label: "reg-admin-b",
      role: "entity_admin",
      branchId: fx.entityB,
      maxDiscountPercent: 50,
    });
    salesA = await createUser(fx.db, fx.runId, {
      label: "reg-sales-a",
      role: "sales_user",
      branchId: fx.entityA,
      maxDiscountPercent: 5,
    });
    staffA = await createUser(fx.db, fx.runId, {
      label: "reg-staff-a",
      role: "inventory_user",
      branchId: fx.entityA,
    });
    fx.users.push(adminA, adminB, salesA, staffA);
  });

  after(async () => {
    await fx?.cleanup();
  });

  // -------------------------------------------------------------------------
  // CRIT-1 — self-privilege escalation and tenancy escape
  // -------------------------------------------------------------------------

  test("CRIT-1: an entity admin cannot move themselves into another entity", async () => {
    const { error } = await adminA.client
      .from("employees")
      .update({ branch_id: fx.entityB })
      .eq("id", adminA.employeeId);
    assert.ok(error, "re-homing yourself into another entity must be refused");

    const { data } = await fx.db
      .from("employees")
      .select("branch_id")
      .eq("id", adminA.employeeId)
      .single();
    assert.equal(data!.branch_id, fx.entityA, "the admin must still belong to Entity A");
  });

  test("CRIT-1: the escape is closed end to end — Entity B stays invisible", async () => {
    await adminA.client.from("employees").update({ branch_id: fx.entityB }).eq("id", adminA.employeeId);

    const products = await adminA.client.from("products").select("id").eq("id", fx.productB);
    assert.deepEqual(products.data, [], "Entity B products must remain unreadable");

    const branches = await adminA.client.from("branches").select("id").eq("id", fx.entityB);
    assert.deepEqual(branches.data, [], "Entity B itself must remain invisible");

    const batches = await adminA.client.from("product_batches").select("id").eq("id", fx.batchB);
    assert.deepEqual(batches.data, [], "Entity B stock must remain unreadable");
  });

  test("CRIT-1: an entity admin cannot grant themselves an override", async () => {
    const { error } = await adminA.client
      .from("employees")
      .update({ permission_overrides: { view_profit: true } })
      .eq("id", adminA.employeeId);
    assert.ok(error, "editing your own overrides must be refused even with manage_users");

    const { data } = await fx.db
      .from("employees")
      .select("permission_overrides")
      .eq("id", adminA.employeeId)
      .single();
    assert.deepEqual(data!.permission_overrides, {}, "overrides must be untouched");
  });

  test("CRIT-1: an entity admin cannot change their own role, status or discount ceiling", async () => {
    for (const patch of [
      { role: "master_admin" },
      { status: "disabled" },
      { max_discount_percent: 100 },
      { approval_limit: 999999 },
    ]) {
      const { error } = await adminA.client
        .from("employees")
        .update(patch)
        .eq("id", adminA.employeeId);
      assert.ok(error, `self-editing ${Object.keys(patch)[0]} must be refused`);
    }

    const { data } = await fx.db
      .from("employees")
      .select("role, status, max_discount_percent")
      .eq("id", adminA.employeeId)
      .single();
    assert.equal(data!.role, "entity_admin");
    assert.equal(data!.status, "active");
    assert.equal(Number(data!.max_discount_percent), 50);
  });

  test("CRIT-1: an entity admin cannot push another user into a foreign entity", async () => {
    const { error } = await adminA.client
      .from("employees")
      .update({ branch_id: fx.entityB })
      .eq("id", salesA.employeeId);
    assert.ok(error, "moving a colleague into an entity you cannot reach must be refused");

    const { data } = await fx.db
      .from("employees")
      .select("branch_id")
      .eq("id", salesA.employeeId)
      .single();
    assert.equal(data!.branch_id, fx.entityA);
  });

  test("CRIT-1: an entity admin cannot steal another employee's login", async () => {
    const { error } = await adminA.client
      .from("employees")
      .update({ auth_user_id: adminA.authId })
      .eq("id", staffA.employeeId);
    assert.ok(error, "re-pointing an employee at another login must be refused");

    const { data } = await fx.db
      .from("employees")
      .select("auth_user_id")
      .eq("id", staffA.employeeId)
      .single();
    assert.equal(data!.auth_user_id, staffA.authId, "the login mapping must be unchanged");
  });

  // The fix must not break legitimate user administration.
  test("CRIT-1 regression guard: an entity admin can still administer their own entity", async () => {
    const { error } = await adminA.client
      .from("employees")
      .update({ max_discount_percent: 15, permission_overrides: { view_purchase_cost: true } })
      .eq("id", salesA.employeeId);
    assert.equal(error, null, error?.message);

    const { data } = await fx.db
      .from("employees")
      .select("max_discount_percent, permission_overrides")
      .eq("id", salesA.employeeId)
      .single();
    assert.equal(Number(data!.max_discount_percent), 15);
    assert.deepEqual(data!.permission_overrides, { view_purchase_cost: true });

    await fx.db
      .from("employees")
      .update({ max_discount_percent: 5, permission_overrides: {} })
      .eq("id", salesA.employeeId);
  });

  test("CRIT-1 regression guard: a user can still update their own non-privileged fields", async () => {
    const { error } = await salesA.client
      .from("employees")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", salesA.employeeId);
    assert.equal(error, null, "sign-in bookkeeping must keep working");
  });

  // -------------------------------------------------------------------------
  // CRIT-2 — master-tier permissions granted through overrides
  // -------------------------------------------------------------------------

  test("CRIT-2: an entity admin cannot grant a colleague master-tier permissions", async () => {
    for (const permission of ["manage_entities", "access_multiple_entities", "manage_users"]) {
      const { error } = await adminA.client
        .from("employees")
        .update({ permission_overrides: { [permission]: true } })
        .eq("id", salesA.employeeId);
      assert.ok(error, `${permission} must not be grantable as an override`);
    }

    const { data } = await fx.db
      .from("employees")
      .select("permission_overrides")
      .eq("id", salesA.employeeId)
      .single();
    assert.deepEqual(data!.permission_overrides, {}, "no master-tier override may be stored");
  });

  test("CRIT-2: the sales user gains no master-tier capability", async () => {
    for (const permission of ["manage_entities", "access_multiple_entities", "manage_users"]) {
      const { data } = await salesA.client.rpc("has_perm", { p: permission });
      assert.equal(data, false, `${permission} must remain denied`);
    }

    const rename = await salesA.client
      .from("branches")
      .update({ name: `HIJACKED ${fx.runId}` })
      .eq("id", fx.entityA)
      .select("id");
    assert.deepEqual(rename.data ?? [], [], "a sales user must not be able to rename the entity");

    const { data: entity } = await fx.db.from("branches").select("name").eq("id", fx.entityA).single();
    assert.ok(!entity!.name.startsWith("HIJACKED"), "the entity name must be untouched");
  });

  test("CRIT-2: even the service role cannot plant a master-tier override", async () => {
    const { error } = await fx.db
      .from("employees")
      .update({ permission_overrides: { manage_entities: true } })
      .eq("id", salesA.employeeId);
    assert.ok(error, "the trigger guards every write path, service role included");
  });

  test("CRIT-2: unknown and non-boolean override values are rejected", async () => {
    const unknown = await adminA.client
      .from("employees")
      .update({ permission_overrides: { totally_made_up: true } })
      .eq("id", salesA.employeeId);
    assert.ok(unknown.error, "an unknown permission key must be refused");

    const nonBoolean = await adminA.client
      .from("employees")
      .update({ permission_overrides: { view_profit: "yes" } })
      .eq("id", salesA.employeeId);
    assert.ok(nonBoolean.error, "a non-boolean override value must be refused");
  });

  test("CRIT-2 regression guard: ordinary overrides still grant and revoke", async () => {
    const granted = await adminA.client
      .from("employees")
      .update({ permission_overrides: { view_profit: true } })
      .eq("id", salesA.employeeId);
    assert.equal(granted.error, null, granted.error?.message);
    assert.equal((await salesA.client.rpc("has_perm", { p: "view_profit" })).data, true);

    const revoked = await adminA.client
      .from("employees")
      .update({ permission_overrides: { view_products: false } })
      .eq("id", salesA.employeeId);
    assert.equal(revoked.error, null, revoked.error?.message);
    assert.equal((await salesA.client.rpc("has_perm", { p: "view_products" })).data, false);

    await fx.db.from("employees").update({ permission_overrides: {} }).eq("id", salesA.employeeId);
  });

  // -------------------------------------------------------------------------
  // CRIT-3 — cross-entity stock movement through the RPCs
  // -------------------------------------------------------------------------

  test("CRIT-3: an Entity A stock-out cannot destroy an Entity B batch", async () => {
    const before = await batchQuantity(fx.db, fx.batchB);

    // The attack RLS permits: a document stamped with the attacker's own
    // entity, pointing at a batch in someone else's.
    const { data: doc, error: insertError } = await adminA.client
      .from("returns")
      .insert({
        reference: `XREG-${fx.runId}`,
        type: "damaged",
        branch_id: fx.entityA,
        product_id: fx.productB,
        batch_id: fx.batchB,
        quantity: 7,
        reason: "cross-entity regression probe",
        requested_by: adminA.employeeId,
        status: "pending",
      })
      .select("id")
      .single();
    assert.equal(insertError, null, "RLS still allows the document itself — the RPC is the guard");

    const { error } = await adminA.client.rpc("erp_approve_stock_out", { p_return_id: doc!.id });
    assert.ok(error, "approving a foreign-entity batch must be refused");
    assert.match(error!.message, /different entity/i);

    assert.equal(await batchQuantity(fx.db, fx.batchB), before, "Entity B stock must be untouched");

    const { data: movements } = await fx.db
      .from("stock_movements")
      .select("id")
      .eq("batch_id", fx.batchB);
    assert.deepEqual(movements ?? [], [], "no ledger entry may be written");

    const { data: after } = await fx.db.from("returns").select("status").eq("id", doc!.id).single();
    assert.equal(after!.status, "pending", "the document must stay unapproved");
  });

  test("CRIT-3: a stock-out whose batch belongs to a different product is refused", async () => {
    const { data: other } = await fx.db
      .from("product_batches")
      .insert({
        product_id: fx.productA,
        branch_id: fx.entityA,
        batch_number: `MISMATCH-${fx.runId}`,
        quantity_received: 10,
        quantity_available: 10,
        unit_cost: 100,
        expiry_date: "2030-01-01",
        status: "active",
      })
      .select("id")
      .single();

    const { data: decoy } = await fx.db
      .from("products")
      .insert({
        branch_id: fx.entityA,
        sku: `DECOY-${fx.runId}`,
        name: `Decoy ${fx.runId}`,
        buy_price: 1,
        sell_price: 2,
        status: "active",
      })
      .select("id")
      .single();

    const { data: doc } = await adminA.client
      .from("returns")
      .insert({
        reference: `MISREG-${fx.runId}`,
        type: "damaged",
        branch_id: fx.entityA,
        product_id: decoy!.id,
        batch_id: other!.id,
        quantity: 2,
        reason: "product mismatch probe",
        requested_by: adminA.employeeId,
        status: "pending",
      })
      .select("id")
      .single();

    const { error } = await adminA.client.rpc("erp_approve_stock_out", { p_return_id: doc!.id });
    assert.ok(error, "a batch that belongs to another product must be refused");
    assert.equal(await batchQuantity(fx.db, other!.id), 10, "stock must be untouched");
  });

  test("CRIT-3: stock inward cannot receive a foreign entity's product", async () => {
    const { data: doc } = await adminA.client
      .from("stock_inwards")
      .insert({
        reference: `INREG-${fx.runId}`,
        branch_id: fx.entityA,
        supplier_id: fx.supplierA,
        inward_type: "purchase_from_external",
        status: "draft",
        created_by: adminA.employeeId,
      })
      .select("id")
      .single();

    const { error: itemError } = await adminA.client.from("stock_inward_items").insert({
      inward_id: doc!.id,
      product_id: fx.productB, // belongs to Entity B
      batch_number: `INREG-B-${fx.runId}`,
      quantity: 5,
      unit_cost: 100,
    });
    assert.equal(itemError, null, "RLS still allows the line — the RPC is the guard");

    const { error } = await adminA.client.rpc("erp_confirm_stock_inward", { p_id: doc!.id });
    assert.ok(error, "confirming a foreign-entity product must be refused");
    assert.match(error!.message, /different entity/i);

    const { data: batches } = await fx.db
      .from("product_batches")
      .select("id")
      .eq("product_id", fx.productB)
      .eq("branch_id", fx.entityA);
    assert.deepEqual(batches ?? [], [], "no batch may be created for the foreign product");

    const { data: status } = await fx.db
      .from("stock_inwards")
      .select("status")
      .eq("id", doc!.id)
      .single();
    assert.equal(status!.status, "draft", "the document must stay a draft");
  });

  test("CRIT-3: opening stock cannot open a foreign entity's product", async () => {
    const { data: entry } = await adminA.client
      .from("opening_stock_entries")
      .insert({
        reference: `OPREG-${fx.runId}`,
        branch_id: fx.entityA,
        status: "draft",
        created_by: adminA.employeeId,
      })
      .select("id")
      .single();

    await adminA.client.from("opening_stock_items").insert({
      entry_id: entry!.id,
      product_id: fx.productB, // belongs to Entity B
      batch_number: `OPREG-B-${fx.runId}`,
      quantity: 9,
      unit_cost: 100,
    });

    const { error } = await adminA.client.rpc("erp_confirm_opening_stock", { p_id: entry!.id });
    assert.ok(error, "opening stock for a foreign-entity product must be refused");
    assert.match(error!.message, /different entity/i);

    const { data: status } = await fx.db
      .from("opening_stock_entries")
      .select("status")
      .eq("id", entry!.id)
      .single();
    assert.equal(status!.status, "draft", "the entry must stay a draft");
  });

  test("CRIT-3 regression guard: a well-formed stock-out still works", async () => {
    const before = await batchQuantity(fx.db, fx.batchA);

    const { data: doc } = await adminA.client
      .from("returns")
      .insert({
        reference: `OKREG-${fx.runId}`,
        type: "damaged",
        branch_id: fx.entityA,
        product_id: fx.productA,
        batch_id: fx.batchA,
        quantity: 3,
        reason: "legitimate write-off",
        requested_by: adminA.employeeId,
        status: "pending",
      })
      .select("id")
      .single();

    const { error } = await adminA.client.rpc("erp_approve_stock_out", { p_return_id: doc!.id });
    assert.equal(error, null, error?.message);
    assert.equal(await batchQuantity(fx.db, fx.batchA), before - 3, "stock must fall by exactly 3");
  });

  test("CRIT-3 regression guard: a same-entity inward still confirms", async () => {
    const { data: doc } = await adminA.client
      .from("stock_inwards")
      .insert({
        reference: `OKIN-${fx.runId}`,
        branch_id: fx.entityA,
        supplier_id: fx.supplierA,
        inward_type: "purchase_from_external",
        status: "draft",
        created_by: adminA.employeeId,
      })
      .select("id")
      .single();

    await adminA.client.from("stock_inward_items").insert({
      inward_id: doc!.id,
      product_id: fx.productA,
      batch_number: `OKIN-A-${fx.runId}`,
      quantity: 12,
      unit_cost: 100,
    });

    const { error } = await adminA.client.rpc("erp_confirm_stock_inward", { p_id: doc!.id });
    assert.equal(error, null, error?.message);

    const { data: items } = await fx.db
      .from("stock_inward_items")
      .select("batch_id")
      .eq("inward_id", doc!.id);
    assert.equal(await batchQuantity(fx.db, items![0].batch_id!), 12);
  });
});
