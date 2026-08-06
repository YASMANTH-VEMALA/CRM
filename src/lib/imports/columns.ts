/**
 * Import column definitions. Pure data shared by the template builder (which
 * writes the header row) and the validators (which read it back), so the two
 * can never drift apart.
 */

export type ImportKind = "products" | "opening_stock" | "stock_inward";

export type TemplateColumn = {
  key: string;
  header: string;
  width?: number;
  required?: boolean;
  hint: string;
};

export const PRODUCT_TEMPLATE: TemplateColumn[] = [
  { key: "name", header: "name", required: true, hint: "Paracetamol 500mg", width: 26 },
  { key: "sku", header: "sku", hint: "MED-00041 (blank = generated)", width: 18 },
  { key: "barcode", header: "barcode", hint: "6201100184812", width: 18 },
  { key: "category", header: "category", hint: "Pain relief", width: 18 },
  { key: "manufacturer", header: "manufacturer", hint: "Shelys", width: 20 },
  { key: "unit", header: "unit", hint: "Pack of 100", width: 16 },
  { key: "supplier", header: "supplier", hint: "Phillips Pharma", width: 20 },
  { key: "purchase_cost", header: "purchase_cost", required: true, hint: "2500", width: 16 },
  { key: "pricing_method", header: "pricing_method", hint: "FIXED or COST_PLUS_MARGIN", width: 22 },
  { key: "margin_percent", header: "margin_percent", hint: "40 (used by COST_PLUS_MARGIN)", width: 18 },
  { key: "selling_price", header: "selling_price", hint: "5000 (used by FIXED)", width: 16 },
  { key: "max_discount_percent", header: "max_discount_percent", hint: "10", width: 20 },
  { key: "minimum_stock", header: "minimum_stock", hint: "50", width: 16 },
  { key: "restock_target", header: "restock_target", hint: "200", width: 16 },
];

export const OPENING_STOCK_TEMPLATE: TemplateColumn[] = [
  { key: "sku", header: "sku", required: true, hint: "MED-00041", width: 18 },
  { key: "batch_number", header: "batch_number", required: true, hint: "PCM-24081", width: 18 },
  { key: "expiry_date", header: "expiry_date", hint: "2027-06-24", width: 16 },
  { key: "quantity", header: "quantity", required: true, hint: "100", width: 14 },
  { key: "purchase_cost", header: "purchase_cost", required: true, hint: "2500", width: 16 },
  { key: "selling_price", header: "selling_price", hint: "5000", width: 16 },
];

export const STOCK_INWARD_TEMPLATE: TemplateColumn[] = [
  { key: "sku", header: "sku", required: true, hint: "MED-00041", width: 18 },
  { key: "batch_number", header: "batch_number", required: true, hint: "PCM-25012", width: 18 },
  { key: "expiry_date", header: "expiry_date", hint: "2027-06-24", width: 16 },
  { key: "quantity", header: "quantity", required: true, hint: "100", width: 14 },
  { key: "free_quantity", header: "free_quantity", hint: "10", width: 16 },
  { key: "unit_cost", header: "unit_cost", required: true, hint: "2500", width: 14 },
];

export const TEMPLATES: Record<ImportKind, { title: string; columns: TemplateColumn[] }> = {
  products: { title: "Product import template", columns: PRODUCT_TEMPLATE },
  opening_stock: { title: "Opening stock import template", columns: OPENING_STOCK_TEMPLATE },
  stock_inward: { title: "Stock inward import template", columns: STOCK_INWARD_TEMPLATE },
};

export function isImportKind(value: string): value is ImportKind {
  return value === "products" || value === "opening_stock" || value === "stock_inward";
}
