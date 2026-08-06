import "server-only";
import { getScope } from "./scope";
import { PRODUCT_COLUMNS, productCostMap } from "./costs";
import { effectiveMarginPercent, reorderQuantity } from "@/lib/pricing";
import type { PricingMethod } from "@/lib/types";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  unit: string | null;
  imageUrl: string | null;
  /** null when the viewer lacks view_purchase_cost. */
  buyPrice: number | null;
  sellPrice: number;
  pricingMethod: PricingMethod;
  marginPercent: number;
  /** null when the viewer lacks view_profit. */
  marginValue: number | null;
  maxDiscountPercent: number;
  reorderLevel: number;
  restockTarget: number;
  available: number;
  reorderQuantity: number;
  status: "active" | "discontinued" | "quarantined";
  stockStatus: "Active" | "Low stock" | "Out of stock" | "Discontinued" | "Quarantined";
  entityName: string | null;
};

export type PriceHistoryRow = {
  id: string;
  productId: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  changeType: string;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
};

export type ProductsData = {
  products: ProductRow[];
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  priceHistory: PriceHistoryRow[];
  stats: Array<[string, string, string]>;
  canViewCost: boolean;
  canViewProfit: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canImport: boolean;
  pendingDrafts: number;
  entityName: string;
};

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

export async function getProductsData(): Promise<ProductsData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  // Explicit column list: buy_price is not readable by `authenticated` and a
  // `*` select would be rejected outright. Cost comes from product_costs.
  let productQuery = supabase
    .from("products")
    .select(`${PRODUCT_COLUMNS}, categories(name), suppliers(name), branches(name)`)
    .order("name");
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  let batchQuery = supabase
    .from("product_batches")
    .select("product_id, quantity_available")
    .eq("status", "active");
  if (entityId) batchQuery = batchQuery.eq("branch_id", entityId);

  let supplierQuery = supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
  if (entityId) supplierQuery = supplierQuery.eq("branch_id", entityId);

  let historyQuery = supabase
    .from("product_price_history")
    .select("*, employees(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (entityId) historyQuery = historyQuery.eq("branch_id", entityId);

  let draftQuery = supabase
    .from("draft_products")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (entityId) draftQuery = draftQuery.eq("branch_id", entityId);

  const [
    { data: products },
    { data: batches },
    { data: categories },
    { data: suppliers },
    { data: history },
    { count: pendingDrafts },
  ] = await Promise.all([
    productQuery,
    batchQuery,
    supabase.from("categories").select("id, name").eq("is_active", true).order("name"),
    supplierQuery,
    historyQuery,
    draftQuery,
  ]);

  const availableByProduct = new Map<string, number>();
  for (const batch of batches ?? []) {
    availableByProduct.set(
      batch.product_id,
      (availableByProduct.get(batch.product_id) ?? 0) + Math.max(0, batch.quantity_available)
    );
  }

  // Empty for anyone without view_purchase_cost, so buyPrice and marginValue
  // fall to null below without the loader having to decide.
  const costs = await productCostMap(supabase, entityId);

  const rows: ProductRow[] = (products ?? []).map((product) => {
    const available = availableByProduct.get(product.id) ?? 0;
    const buyPrice = costs.get(product.id) ?? null;
    const sellPrice = Number(product.sell_price);

    const stockStatus: ProductRow["stockStatus"] =
      product.status === "discontinued"
        ? "Discontinued"
        : product.status === "quarantined"
          ? "Quarantined"
          : available <= 0
            ? "Out of stock"
            : available <= product.reorder_level
              ? "Low stock"
              : "Active";

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      genericName: product.generic_name,
      strength: product.strength,
      form: product.form,
      manufacturer: product.manufacturer,
      barcode: product.barcode,
      categoryId: product.category_id,
      categoryName: one<{ name: string }>(product.categories)?.name ?? null,
      supplierId: product.supplier_id,
      supplierName: one<{ name: string }>(product.suppliers)?.name ?? null,
      unit: product.unit,
      imageUrl: product.image_url,
      // Cost never reaches the payload for an unauthorised user because the
      // database will not hand it to this request in the first place.
      buyPrice,
      sellPrice,
      pricingMethod: product.pricing_method,
      marginPercent: Number(product.margin_percent),
      marginValue: scope.canViewProfit && buyPrice !== null ? sellPrice - buyPrice : null,
      maxDiscountPercent: Number(product.max_discount_percent),
      reorderLevel: product.reorder_level,
      restockTarget: product.restock_target,
      available,
      reorderQuantity: reorderQuantity(available, product.restock_target),
      status: product.status,
      stockStatus,
      entityName: one<{ name: string }>(product.branches)?.name ?? null,
    };
  });

  const active = rows.filter((row) => row.status === "active").length;
  const lowStock = rows.filter((row) => row.stockStatus === "Low stock").length;
  const outOfStock = rows.filter((row) => row.stockStatus === "Out of stock").length;

  const stats: Array<[string, string, string]> = [
    ["All products", String(rows.length), `${(categories ?? []).length} categories`],
    ["Active", String(active), rows.length > 0 ? `${((active / rows.length) * 100).toFixed(0)}% of catalogue` : "—"],
    ["Low stock", String(lowStock), "At or below minimum"],
    ["Out of stock", String(outOfStock), `${pendingDrafts ?? 0} drafts awaiting review`],
  ];

  const priceHistory: PriceHistoryRow[] = (history ?? []).map((entry) => ({
    id: entry.id,
    productId: entry.product_id,
    field: entry.field,
    previousValue: entry.previous_value,
    newValue: entry.new_value,
    changeType: entry.change_type,
    changedBy: one<{ full_name: string }>(entry.employees)?.full_name ?? null,
    reason: entry.reason,
    createdAt: entry.created_at,
  }));

  return {
    products: rows,
    categories: categories ?? [],
    suppliers: suppliers ?? [],
    // Price history exposes purchase cost movements, so it is withheld from
    // users who may not see cost at all.
    priceHistory: scope.canViewCost ? priceHistory : [],
    stats,
    canViewCost: scope.canViewCost,
    canViewProfit: scope.canViewProfit,
    canCreate: scope.employee?.permissions.includes("create_products") ?? false,
    canEdit: scope.employee?.permissions.includes("edit_products") ?? false,
    canImport: scope.employee?.permissions.includes("import_products") ?? false,
    pendingDrafts: pendingDrafts ?? 0,
    entityName: scope.entityName,
  };
}

export { effectiveMarginPercent };
