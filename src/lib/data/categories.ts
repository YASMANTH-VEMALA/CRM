import "server-only";
import { getScope } from "./scope";
import { formatTZS } from "@/app/dashboard/views/shared";

export type CategoriesData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
};

export async function getCategoriesData(): Promise<CategoriesData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let productQuery = supabase.from("products").select("id, category_id");
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  let batchQuery = supabase.from("product_batches").select("product_id, quantity_available, unit_cost");
  if (entityId) batchQuery = batchQuery.eq("branch_id", entityId);

  // The category catalogue itself is shared across the network — never scoped.
  const [{ data: categories }, { data: products }, { data: batches }] = await Promise.all([
    supabase.from("categories").select("*").order("code"),
    productQuery,
    batchQuery,
  ]);

  const allCategories = categories ?? [];
  const allProducts = products ?? [];
  const allBatches = batches ?? [];

  const categoryByProduct = new Map<string, string | null>();
  allProducts.forEach((p) => categoryByProduct.set(p.id, p.category_id));

  const productCountByCategory = new Map<string, number>();
  allProducts.forEach((p) => {
    if (!p.category_id) return;
    productCountByCategory.set(p.category_id, (productCountByCategory.get(p.category_id) ?? 0) + 1);
  });

  const stockValueByCategory = new Map<string, number>();
  if (scope.canViewCost) {
    allBatches.forEach((b) => {
      const categoryId = categoryByProduct.get(b.product_id);
      if (!categoryId) return;
      const value = b.quantity_available * b.unit_cost;
      stockValueByCategory.set(categoryId, (stockValueByCategory.get(categoryId) ?? 0) + value);
    });
  }

  const medicine = allCategories.filter((c) => c.type === "medicine");
  const supplies = allCategories.filter((c) => c.type === "supplies");
  const inactive = allCategories.filter((c) => !c.is_active);

  const medicineProducts = medicine.reduce((sum, c) => sum + (productCountByCategory.get(c.id) ?? 0), 0);
  const suppliesProducts = supplies.reduce((sum, c) => sum + (productCountByCategory.get(c.id) ?? 0), 0);

  const stats: Array<[string, string, string]> = [
    ["Categories", String(allCategories.length), "All catalogue"],
    ["Medicine", String(medicine.length), `${medicineProducts} products`],
    ["Supplies", String(supplies.length), `${suppliesProducts} products`],
    ["Inactive", String(inactive.length), "Archived"],
  ];

  const rows = allCategories.map((c) => [
    c.code,
    c.name,
    c.type === "medicine" ? "Medicine" : "Supplies",
    String(productCountByCategory.get(c.id) ?? 0),
    scope.canViewCost ? formatTZS(stockValueByCategory.get(c.id) ?? 0) : "—",
    "—",
    c.is_active ? "Active" : "Inactive",
  ]);

  return { stats, rows };
}
