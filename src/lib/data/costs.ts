import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Purchase cost lookup.
 *
 * `products.buy_price` and `product_batches.unit_cost` are not readable by the
 * `authenticated` role at all (migration 0015 revokes SELECT on those two
 * columns). Cost comes from the `product_costs` / `batch_costs` views, which
 * run with the view owner's rights and re-assert both guards themselves:
 *
 *   has_entity_access(branch_id)  — the same predicate as the table's RLS
 *   has_perm('view_purchase_cost')
 *
 * A user without the permission gets zero rows, so these helpers return an
 * empty map and every caller naturally renders no cost. That is the security
 * boundary; the `scope.canViewCost` checks that remain in the loaders are a UI
 * nicety, not the thing standing between a sales user and your margins.
 */

type Client = SupabaseClient;

/** product_id -> buy_price, empty when the caller may not see cost. */
export async function productCostMap(
  supabase: Client,
  entityId: string | null,
  productIds?: string[]
): Promise<Map<string, number>> {
  let query = supabase.from("product_costs").select("product_id, buy_price");
  if (entityId) query = query.eq("branch_id", entityId);
  if (productIds && productIds.length > 0) query = query.in("product_id", productIds);

  const { data } = await query;
  const map = new Map<string, number>();
  for (const row of data ?? []) map.set(row.product_id, Number(row.buy_price));
  return map;
}

/** batch_id -> unit_cost, empty when the caller may not see cost. */
export async function batchCostMap(
  supabase: Client,
  entityId: string | null,
  batchIds?: string[]
): Promise<Map<string, number>> {
  let query = supabase.from("batch_costs").select("batch_id, unit_cost");
  if (entityId) query = query.eq("branch_id", entityId);
  if (batchIds && batchIds.length > 0) query = query.in("batch_id", batchIds);

  const { data } = await query;
  const map = new Map<string, number>();
  for (const row of data ?? []) map.set(row.batch_id, Number(row.unit_cost));
  return map;
}

/**
 * batch_id -> unit_cost across every entity, for consolidated views where a
 * master admin is looking at all entities at once.
 */
export async function batchCostMapAllEntities(supabase: Client): Promise<Map<string, number>> {
  const { data } = await supabase.from("batch_costs").select("batch_id, unit_cost");
  const map = new Map<string, number>();
  for (const row of data ?? []) map.set(row.batch_id, Number(row.unit_cost));
  return map;
}

/** Columns of `products` that every authenticated user may read. */
export const PRODUCT_COLUMNS =
  "id, sku, name, generic_name, strength, form, category_id, supplier_id, " +
  "sell_price, unit, barcode, status, reorder_level, created_at, branch_id, " +
  "manufacturer, image_url, pricing_method, margin_percent, max_discount_percent, restock_target";

/** Columns of `product_batches` that every authenticated user may read. */
export const BATCH_COLUMNS =
  "id, product_id, batch_number, supplier_id, branch_id, quantity_received, " +
  "quantity_available, expiry_date, storage_location, status, received_at, " +
  "source_type, source_id";
