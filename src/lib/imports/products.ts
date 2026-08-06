import { calculateSellPrice } from "@/lib/pricing";
import type { PricingMethod } from "@/lib/types";
import {
  normaliseHeader,
  parseSheetNumber,
  parseSheetText,
  type ParsedSheet,
} from "@/lib/spreadsheet";
import { PRODUCT_TEMPLATE } from "./columns";

export type ProductImportRow = {
  /** 1-based row number as it appears in the spreadsheet (header = row 1). */
  rowNumber: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryName: string | null;
  manufacturer: string | null;
  unit: string | null;
  supplierName: string | null;
  buyPrice: number;
  pricingMethod: PricingMethod;
  marginPercent: number;
  sellPrice: number;
  maxDiscountPercent: number;
  reorderLevel: number;
  restockTarget: number;
};

export type RowError = { row: number; error: string };

export type DuplicateKind = "existing_product" | "duplicate_in_file" | "existing_draft";

export type ProductImportPreview = {
  valid: ProductImportRow[];
  errors: RowError[];
  duplicates: Array<{ row: number; name: string; sku: string | null; kind: DuplicateKind }>;
  totalRows: number;
  missingColumns: string[];
};

const toNumber = parseSheetNumber;
const text = parseSheetText;

/**
 * Validates every row of an uploaded product sheet without touching the
 * database beyond read-only duplicate lookups. Nothing is written until the
 * user confirms, so an invalid file can never corrupt the catalogue.
 */
export function validateProductRows(
  sheet: ParsedSheet,
  existing: { skus: Set<string>; names: Set<string>; barcodes: Set<string> },
  existingDraftNames: Set<string>
): ProductImportPreview {
  const requiredHeaders = PRODUCT_TEMPLATE.filter((column) => column.required).map((column) => column.header);
  const present = new Set(sheet.headers.map(normaliseHeader));
  const missingColumns = requiredHeaders.filter((header) => !present.has(header));

  if (missingColumns.length > 0) {
    return { valid: [], errors: [], duplicates: [], totalRows: sheet.rows.length, missingColumns };
  }

  const valid: ProductImportRow[] = [];
  const errors: RowError[] = [];
  const duplicates: ProductImportPreview["duplicates"] = [];
  const seenSkus = new Set<string>();
  const seenNames = new Set<string>();

  sheet.rows.forEach((raw, index) => {
    const rowNumber = index + 2; // header occupies row 1
    const name = text(raw.name);
    if (!name) {
      errors.push({ row: rowNumber, error: "Product name is required." });
      return;
    }

    const buyPrice = toNumber(raw.purchase_cost);
    if (buyPrice === null) {
      errors.push({ row: rowNumber, error: "Purchase cost is required and must be a number." });
      return;
    }
    if (buyPrice < 0) {
      errors.push({ row: rowNumber, error: "Purchase cost cannot be negative." });
      return;
    }

    const methodRaw = (text(raw.pricing_method) ?? "FIXED").toUpperCase().replace(/[\s-]/g, "_");
    let pricingMethod: PricingMethod;
    if (methodRaw === "FIXED") pricingMethod = "fixed";
    else if (methodRaw === "COST_PLUS_MARGIN") pricingMethod = "cost_plus_margin";
    else {
      errors.push({ row: rowNumber, error: `Pricing method must be FIXED or COST_PLUS_MARGIN (got "${raw.pricing_method}").` });
      return;
    }

    const marginPercent = toNumber(raw.margin_percent) ?? 0;
    const fixedPrice = toNumber(raw.selling_price) ?? 0;

    if (pricingMethod === "cost_plus_margin" && marginPercent <= 0) {
      errors.push({ row: rowNumber, error: "Margin percent is required when pricing method is COST_PLUS_MARGIN." });
      return;
    }
    if (pricingMethod === "fixed" && fixedPrice <= 0) {
      errors.push({ row: rowNumber, error: "Selling price is required when pricing method is FIXED." });
      return;
    }

    const sellPrice = calculateSellPrice(pricingMethod, buyPrice, marginPercent, fixedPrice);
    if (sellPrice <= 0) {
      errors.push({ row: rowNumber, error: "The calculated selling price must be greater than zero." });
      return;
    }

    const maxDiscountPercent = toNumber(raw.max_discount_percent) ?? 0;
    if (maxDiscountPercent < 0 || maxDiscountPercent > 100) {
      errors.push({ row: rowNumber, error: "Max discount percent must be between 0 and 100." });
      return;
    }

    const reorderLevel = toNumber(raw.minimum_stock) ?? 0;
    const restockTarget = toNumber(raw.restock_target) ?? 0;
    if (reorderLevel < 0 || restockTarget < 0) {
      errors.push({ row: rowNumber, error: "Stock levels cannot be negative." });
      return;
    }
    if (restockTarget > 0 && restockTarget < reorderLevel) {
      errors.push({ row: rowNumber, error: "Restock target must be at least the minimum stock quantity." });
      return;
    }

    const sku = text(raw.sku);
    const barcode = text(raw.barcode);
    const normalisedName = name.toLowerCase();

    // Duplicate detection: within the file first, then against live records.
    let duplicateKind: DuplicateKind | null = null;
    if ((sku && seenSkus.has(sku.toLowerCase())) || seenNames.has(normalisedName)) {
      duplicateKind = "duplicate_in_file";
    } else if ((sku && existing.skus.has(sku.toLowerCase())) || existing.names.has(normalisedName) || (barcode && existing.barcodes.has(barcode))) {
      duplicateKind = "existing_product";
    } else if (existingDraftNames.has(normalisedName)) {
      duplicateKind = "existing_draft";
    }

    if (sku) seenSkus.add(sku.toLowerCase());
    seenNames.add(normalisedName);

    if (duplicateKind) {
      duplicates.push({ row: rowNumber, name, sku, kind: duplicateKind });
      return;
    }

    valid.push({
      rowNumber,
      name,
      sku,
      barcode,
      categoryName: text(raw.category),
      manufacturer: text(raw.manufacturer),
      unit: text(raw.unit),
      supplierName: text(raw.supplier),
      buyPrice,
      pricingMethod,
      marginPercent,
      sellPrice,
      maxDiscountPercent,
      reorderLevel,
      restockTarget,
    });
  });

  return { valid, errors, duplicates, totalRows: sheet.rows.length, missingColumns: [] };
}

export const DUPLICATE_LABELS: Record<DuplicateKind, string> = {
  existing_product: "Already an active product",
  duplicate_in_file: "Repeated in this file",
  existing_draft: "Already awaiting review",
};
