import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createUser, hasCredentials, setupFixture, type Fixture, type TestUser } from "./helpers";

/**
 * Required scenario 14 plus the draft-product lifecycle: an import must never
 * be applied twice, and imported rows must not become sellable products until
 * a human confirms them.
 */
describe("product imports and drafts", { skip: !hasCredentials && "no Supabase credentials" }, () => {
  let fx: Fixture;
  let entityAdmin: TestUser;
  let salesUser: TestUser;

  before(async () => {
    fx = await setupFixture();
    entityAdmin = await createUser(fx.db, fx.runId, {
      label: "import-admin",
      role: "entity_admin",
      branchId: fx.entityA,
    });
    salesUser = await createUser(fx.db, fx.runId, {
      label: "import-sales",
      role: "sales_user",
      branchId: fx.entityA,
    });
    fx.users.push(entityAdmin, salesUser);
  });

  after(async () => {
    await fx?.cleanup();
  });

  function importRow(hash: string, filename = "products.xlsx") {
    return {
      branch_id: fx.entityA,
      filename,
      file_hash: hash,
      kind: "products",
      total_rows: 3,
      valid_rows: 3,
      invalid_rows: 0,
      status: "committed",
      error_report: [],
      created_by: entityAdmin.employeeId,
    };
  }

  // Scenario 14
  test("Importing the identical file twice into one entity is blocked", async () => {
    const hash = `hash-${fx.runId}-a`;

    const first = await entityAdmin.client.from("product_imports").insert(importRow(hash));
    assert.equal(first.error, null, first.error?.message);

    const second = await entityAdmin.client.from("product_imports").insert(importRow(hash));
    assert.ok(second.error, "the same file hash must be rejected on a second import");
    assert.match(second.error!.message, /duplicate/i);

    const { data } = await fx.db
      .from("product_imports")
      .select("id")
      .eq("branch_id", fx.entityA)
      .eq("file_hash", hash);
    assert.equal(data?.length, 1, "only one import record may exist");
  });

  test("A renamed copy of the same file is still blocked", async () => {
    const hash = `hash-${fx.runId}-b`;
    await entityAdmin.client.from("product_imports").insert(importRow(hash, "january.xlsx"));

    const renamed = await entityAdmin.client
      .from("product_imports")
      .insert(importRow(hash, "january-copy.xlsx"));
    assert.ok(renamed.error, "duplicate detection is by content, not filename");
  });

  test("The same file may be imported into a different entity", async () => {
    const hash = `hash-${fx.runId}-c`;
    await entityAdmin.client.from("product_imports").insert(importRow(hash));

    // Entity B is a separate pharmacy with its own catalogue, so the same
    // supplier price list is legitimately importable there too.
    const { error } = await fx.db
      .from("product_imports")
      .insert({ ...importRow(hash), branch_id: fx.entityB });
    assert.equal(error, null, "the per-entity uniqueness must not be global");
  });

  test("A sales user cannot record an import", async () => {
    const { error } = await salesUser.client
      .from("product_imports")
      .insert(importRow(`hash-${fx.runId}-d`));
    assert.ok(error, "importing requires import_products");
  });

  test("A draft product is not sellable until it is confirmed", async () => {
    const { data: draft } = await fx.db
      .from("draft_products")
      .insert({
        branch_id: fx.entityA,
        name: `Draft Item ${fx.runId}`,
        sku: `DRAFT-${fx.runId}`,
        buy_price: 800,
        pricing_method: "fixed",
        sell_price: 1600,
        status: "pending",
      })
      .select("id, name")
      .single();

    const { data: products } = await fx.db
      .from("products")
      .select("id")
      .eq("branch_id", fx.entityA)
      .eq("name", draft!.name);
    assert.deepEqual(products, [], "a pending draft creates no product row");

    const { data: batches } = await fx.db
      .from("product_batches")
      .select("id")
      .eq("branch_id", fx.entityA)
      .eq("batch_number", `DRAFT-${fx.runId}`);
    assert.deepEqual(batches, [], "and no stock");
  });

  test("Drafts are entity-scoped like every other record", async () => {
    await fx.db.from("draft_products").insert({
      branch_id: fx.entityB,
      name: `Entity B Draft ${fx.runId}`,
      buy_price: 100,
      pricing_method: "fixed",
      sell_price: 200,
      status: "pending",
    });

    const { data } = await entityAdmin.client
      .from("draft_products")
      .select("id")
      .eq("branch_id", fx.entityB);
    assert.deepEqual(data, [], "an Entity A admin cannot see Entity B drafts");
  });

  function commitArgs(hash: string, drafts: unknown[], filename = "commit.xlsx") {
    return {
      p_branch_id: fx.entityA,
      p_filename: filename,
      p_file_hash: hash,
      p_total_rows: drafts.length,
      p_invalid_rows: 0,
      p_error_report: [],
      p_drafts: drafts,
    };
  }

  test("The atomic commit writes the import record and its drafts together", async () => {
    const hash = `hash-${fx.runId}-commit`;
    const { data, error } = await entityAdmin.client.rpc(
      "erp_commit_product_import",
      commitArgs(hash, [
        {
          name: `Imported One ${fx.runId}`,
          sku: `IMP1-${fx.runId}`,
          buyPrice: 1000,
          pricingMethod: "fixed",
          sellPrice: 2000,
          marginPercent: 0,
          maxDiscountPercent: 5,
          reorderLevel: 10,
          restockTarget: 50,
        },
        {
          name: `Imported Two ${fx.runId}`,
          sku: `IMP2-${fx.runId}`,
          buyPrice: 500,
          pricingMethod: "cost_plus_margin",
          sellPrice: 700,
          marginPercent: 40,
          maxDiscountPercent: 0,
          reorderLevel: 5,
          restockTarget: 20,
        },
      ])
    );
    assert.equal(error, null, error?.message);
    assert.equal((data as { drafts: number }).drafts, 2);

    const { data: drafts } = await fx.db
      .from("draft_products")
      .select("name, status, sell_price")
      .eq("import_id", (data as { import_id: string }).import_id)
      .order("name");
    assert.equal(drafts?.length, 2);
    assert.ok(drafts!.every((d) => d.status === "pending"), "imported rows land as drafts, not products");
  });

  test("A failed commit leaves neither an import record nor drafts, so the file can be retried", async () => {
    const hash = `hash-${fx.runId}-atomic`;

    // A row with a null name violates draft_products.name NOT NULL, which
    // aborts the whole function after the import row has been inserted.
    const { error } = await entityAdmin.client.rpc(
      "erp_commit_product_import",
      commitArgs(hash, [{ sku: `BAD-${fx.runId}`, buyPrice: 100, sellPrice: 200 }])
    );
    assert.ok(error, "the invalid row must abort the commit");

    const { data: records } = await fx.db
      .from("product_imports")
      .select("id")
      .eq("branch_id", fx.entityA)
      .eq("file_hash", hash);
    assert.deepEqual(records, [], "the import record was rolled back");

    const retry = await entityAdmin.client.rpc(
      "erp_commit_product_import",
      commitArgs(hash, [
        {
          name: `Retry Product ${fx.runId}`,
          sku: `RETRY-${fx.runId}`,
          buyPrice: 100,
          pricingMethod: "fixed",
          sellPrice: 200,
        },
      ])
    );
    assert.equal(retry.error, null, "the same file can be imported after a rolled-back attempt");
  });

  test("The atomic commit refuses an entity the user cannot access", async () => {
    const { error } = await entityAdmin.client.rpc("erp_commit_product_import", {
      ...commitArgs(`hash-${fx.runId}-cross`, [
        { name: `Cross Entity ${fx.runId}`, buyPrice: 1, pricingMethod: "fixed", sellPrice: 2 },
      ]),
      p_branch_id: fx.entityB,
    });
    assert.ok(error, "importing into another entity must be rejected");

    const { data } = await fx.db
      .from("product_imports")
      .select("id")
      .eq("branch_id", fx.entityB)
      .eq("file_hash", `hash-${fx.runId}-cross`);
    assert.deepEqual(data, []);
  });

  test("A sales user cannot run the atomic import commit", async () => {
    const { error } = await salesUser.client.rpc(
      "erp_commit_product_import",
      commitArgs(`hash-${fx.runId}-sales`, [
        { name: `Sales Import ${fx.runId}`, buyPrice: 1, pricingMethod: "fixed", sellPrice: 2 },
      ])
    );
    assert.ok(error);
    assert.match(error!.message, /permission to import/i);
  });
});
