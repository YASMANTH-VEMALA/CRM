import "server-only";
import { getScope } from "./scope";
import type { PricingMethod } from "@/lib/types";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

export type DraftProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryName: string | null;
  manufacturer: string | null;
  unit: string | null;
  supplierName: string | null;
  buyPrice: number | null;
  pricingMethod: PricingMethod;
  marginPercent: number;
  sellPrice: number;
  maxDiscountPercent: number;
  reorderLevel: number;
  restockTarget: number;
  imageUrl: string | null;
  duplicateOf: string | null;
  duplicateOfLabel: string | null;
  status: "pending" | "confirmed" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  importFilename: string | null;
  createdAt: string;
  /** Live products in this entity whose name or SKU looks like a match. */
  possibleMatches: Array<{ id: string; sku: string; name: string }>;
};

export type ImportHistoryRow = {
  id: string;
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  status: string;
  errorReport: Array<{ row: number; error: string }>;
  createdBy: string | null;
  createdAt: string;
};

export type DraftProductsData = {
  drafts: DraftProductRow[];
  imports: ImportHistoryRow[];
  existingProducts: Array<{ id: string; sku: string; name: string }>;
  stats: Array<[string, string, string]>;
  canImport: boolean;
  canConfirm: boolean;
  canViewCost: boolean;
  entityName: string;
  currency: string;
};

/** Loose match used to suggest a merge target when a draft looks familiar. */
function looksLikeMatch(
  draft: { name: string; sku: string | null },
  product: { name: string; sku: string }
): boolean {
  if (draft.sku && draft.sku.toLowerCase() === product.sku.toLowerCase()) return true;
  const draftName = draft.name.toLowerCase();
  const productName = product.name.toLowerCase();
  return draftName === productName || draftName.includes(productName) || productName.includes(draftName);
}

export async function getDraftProductsData(): Promise<DraftProductsData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let draftQuery = supabase
    .from("draft_products")
    .select("*, employees(full_name), product_imports(filename), products(sku, name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (entityId) draftQuery = draftQuery.eq("branch_id", entityId);

  let importQuery = supabase
    .from("product_imports")
    .select("*, employees(full_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (entityId) importQuery = importQuery.eq("branch_id", entityId);

  let productQuery = supabase.from("products").select("id, sku, name").order("name").limit(1000);
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  const [{ data: drafts }, { data: imports }, { data: products }] = await Promise.all([
    draftQuery,
    importQuery,
    productQuery,
  ]);

  const existingProducts = products ?? [];

  const rows: DraftProductRow[] = (drafts ?? []).map((draft) => {
    const candidate = { name: draft.name, sku: draft.sku };
    const duplicate = one<{ sku: string; name: string }>(draft.products);
    return {
      id: draft.id,
      name: draft.name,
      sku: draft.sku,
      barcode: draft.barcode,
      categoryName: draft.category_name,
      manufacturer: draft.manufacturer,
      unit: draft.unit,
      supplierName: draft.supplier_name,
      buyPrice: scope.canViewCost ? Number(draft.buy_price) : null,
      pricingMethod: draft.pricing_method,
      marginPercent: Number(draft.margin_percent),
      sellPrice: Number(draft.sell_price),
      maxDiscountPercent: Number(draft.max_discount_percent),
      reorderLevel: draft.reorder_level,
      restockTarget: draft.restock_target,
      imageUrl: draft.image_url,
      duplicateOf: draft.duplicate_of,
      duplicateOfLabel: duplicate ? `${duplicate.sku} · ${duplicate.name}` : null,
      status: draft.status,
      reviewedBy: one<{ full_name: string }>(draft.employees)?.full_name ?? null,
      reviewedAt: draft.reviewed_at,
      importFilename: one<{ filename: string }>(draft.product_imports)?.filename ?? null,
      createdAt: draft.created_at,
      possibleMatches:
        draft.status === "pending"
          ? existingProducts.filter((product) => looksLikeMatch(candidate, product)).slice(0, 5)
          : [],
    };
  });

  const pending = rows.filter((row) => row.status === "pending").length;
  const confirmed = rows.filter((row) => row.status === "confirmed").length;
  const rejected = rows.filter((row) => row.status === "rejected").length;

  const stats: Array<[string, string, string]> = [
    ["Awaiting review", String(pending), scope.entityName],
    ["Confirmed", String(confirmed), "Now active products"],
    ["Rejected", String(rejected), "Not imported"],
    ["Import runs", String((imports ?? []).length), "Most recent 50"],
  ];

  return {
    drafts: rows,
    imports: (imports ?? []).map((record) => ({
      id: record.id,
      filename: record.filename,
      totalRows: record.total_rows,
      validRows: record.valid_rows,
      invalidRows: record.invalid_rows,
      status: record.status,
      errorReport: (record.error_report ?? []) as Array<{ row: number; error: string }>,
      createdBy: one<{ full_name: string }>(record.employees)?.full_name ?? null,
      createdAt: record.created_at,
    })),
    existingProducts,
    stats,
    canImport: scope.employee?.permissions.includes("import_products") ?? false,
    canConfirm: scope.employee?.permissions.includes("create_products") ?? false,
    canViewCost: scope.canViewCost,
    entityName: scope.entityName,
    currency: scope.currency,
  };
}
