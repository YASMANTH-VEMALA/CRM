import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateProductRows } from "@/lib/imports/products";
import type { ParsedSheet } from "@/lib/spreadsheet";

const HEADERS = [
  "name",
  "sku",
  "barcode",
  "category",
  "manufacturer",
  "unit",
  "supplier",
  "purchase_cost",
  "pricing_method",
  "margin_percent",
  "selling_price",
  "max_discount_percent",
  "minimum_stock",
  "restock_target",
];

function sheet(rows: Array<Record<string, string>>): ParsedSheet {
  return { headers: HEADERS, rows };
}

const NO_EXISTING = { skus: new Set<string>(), names: new Set<string>(), barcodes: new Set<string>() };
const NO_DRAFTS = new Set<string>();

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: "Paracetamol 500mg",
    sku: "MED-90001",
    purchase_cost: "2500",
    pricing_method: "FIXED",
    selling_price: "5000",
    ...overrides,
  };
}

describe("required columns", () => {
  test("a file missing a required column is rejected before any row is read", () => {
    const result = validateProductRows(
      { headers: ["sku", "selling_price"], rows: [row()] },
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.deepEqual(result.missingColumns.sort(), ["name", "purchase_cost"].sort());
    assert.equal(result.valid.length, 0, "no rows are accepted from a malformed file");
  });
});

describe("row validation", () => {
  test("a well-formed FIXED row is accepted with the given selling price", () => {
    const result = validateProductRows(sheet([row()]), NO_EXISTING, NO_DRAFTS);
    assert.equal(result.errors.length, 0);
    assert.equal(result.valid.length, 1);
    assert.equal(result.valid[0].sellPrice, 5000);
    assert.equal(result.valid[0].pricingMethod, "fixed");
  });

  test("a COST_PLUS_MARGIN row derives the selling price from cost and margin", () => {
    const result = validateProductRows(
      sheet([row({ pricing_method: "COST_PLUS_MARGIN", margin_percent: "40", selling_price: "" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.valid[0].sellPrice, 3500);
  });

  test("row numbers in errors match the spreadsheet, counting the header as row 1", () => {
    const result = validateProductRows(
      sheet([
        row({ name: "Paracetamol 500mg", sku: "MED-90001" }),
        row({ name: "", sku: "MED-90002" }),
        row({ name: "Losartan 50mg", sku: "MED-90003" }),
      ]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].row, 3, "the second data row is spreadsheet row 3");
  });

  test("invalid rows are reported without discarding the valid ones", () => {
    const result = validateProductRows(
      sheet([
        row({ name: "Paracetamol 500mg", sku: "MED-90001" }),
        row({ name: "Metformin 500mg", sku: "MED-90002", purchase_cost: "not-a-number" }),
        row({ name: "Losartan 50mg", sku: "MED-90003" }),
      ]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.totalRows, 3);
  });

  test("a missing purchase cost is an error, not a silent zero", () => {
    const result = validateProductRows(sheet([row({ purchase_cost: "" })]), NO_EXISTING, NO_DRAFTS);
    assert.equal(result.valid.length, 0);
    assert.match(result.errors[0].error, /purchase cost/i);
  });

  test("a negative purchase cost is rejected", () => {
    const result = validateProductRows(sheet([row({ purchase_cost: "-100" })]), NO_EXISTING, NO_DRAFTS);
    assert.equal(result.valid.length, 0);
  });

  test("an unrecognised pricing method is rejected", () => {
    const result = validateProductRows(
      sheet([row({ pricing_method: "MAGIC" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 0);
    assert.match(result.errors[0].error, /FIXED or COST_PLUS_MARGIN/);
  });

  test("COST_PLUS_MARGIN without a margin is rejected", () => {
    const result = validateProductRows(
      sheet([row({ pricing_method: "COST_PLUS_MARGIN", margin_percent: "", selling_price: "" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 0);
    assert.match(result.errors[0].error, /margin/i);
  });

  test("FIXED without a selling price is rejected", () => {
    const result = validateProductRows(
      sheet([row({ selling_price: "" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 0);
    assert.match(result.errors[0].error, /selling price/i);
  });

  test("a discount above 100 percent is rejected", () => {
    const result = validateProductRows(
      sheet([row({ max_discount_percent: "150" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 0);
    assert.match(result.errors[0].error, /between 0 and 100/);
  });

  test("a restock target below the minimum stock level is rejected", () => {
    const result = validateProductRows(
      sheet([row({ minimum_stock: "100", restock_target: "50" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 0);
    assert.match(result.errors[0].error, /restock target/i);
  });

  test("thousands separators in numbers are accepted", () => {
    const result = validateProductRows(
      sheet([row({ purchase_cost: "24,000", selling_price: "35,000" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.valid[0].buyPrice, 24000);
    assert.equal(result.valid[0].sellPrice, 35000);
  });
});

describe("duplicate detection", () => {
  test("a SKU that already exists is flagged, not imported", () => {
    const result = validateProductRows(
      sheet([row({ sku: "MED-00041" })]),
      { ...NO_EXISTING, skus: new Set(["med-00041"]) },
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 0);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].kind, "existing_product");
  });

  test("an existing product name is flagged case-insensitively", () => {
    const result = validateProductRows(
      sheet([row({ name: "PARACETAMOL 500MG", sku: "MED-99999" })]),
      { ...NO_EXISTING, names: new Set(["paracetamol 500mg"]) },
      NO_DRAFTS
    );
    assert.equal(result.duplicates[0].kind, "existing_product");
  });

  test("an existing barcode is flagged", () => {
    const result = validateProductRows(
      sheet([row({ barcode: "6201100184812" })]),
      { ...NO_EXISTING, barcodes: new Set(["6201100184812"]) },
      NO_DRAFTS
    );
    assert.equal(result.duplicates[0].kind, "existing_product");
  });

  test("a row repeated inside the same file is imported once and flagged once", () => {
    const result = validateProductRows(
      sheet([row({ sku: "MED-90001" }), row({ sku: "MED-90001" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 1);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].kind, "duplicate_in_file");
  });

  test("a product already awaiting review is flagged as an existing draft", () => {
    const result = validateProductRows(
      sheet([row()]),
      NO_EXISTING,
      new Set(["paracetamol 500mg"])
    );
    assert.equal(result.valid.length, 0);
    assert.equal(result.duplicates[0].kind, "existing_draft");
  });

  test("rows without a SKU are still de-duplicated by name", () => {
    const result = validateProductRows(
      sheet([row({ sku: "" }), row({ sku: "" })]),
      NO_EXISTING,
      NO_DRAFTS
    );
    assert.equal(result.valid.length, 1);
    assert.equal(result.duplicates.length, 1);
  });
});
