import "server-only";
import { getScope } from "./scope";
import { BATCH_COLUMNS, batchCostMap, productCostMap } from "./costs";
import { reorderQuantity } from "@/lib/pricing";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

export type BatchRow = {
  id: string;
  batchNumber: string;
  productId: string;
  productName: string;
  sku: string;
  supplierName: string | null;
  entityName: string | null;
  quantityReceived: number;
  quantityAvailable: number;
  /** null when the viewer lacks view_purchase_cost. */
  unitCost: number | null;
  stockValue: number | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  storageLocation: string | null;
  status: string;
  sourceType: string | null;
  receivedAt: string;
};

export type InventoryData = {
  batches: BatchRow[];
  entities: { id: string; name: string }[];
  stats: Array<[string, string, string]>;
  canAdjust: boolean;
  canViewCost: boolean;
  canExport: boolean;
  entityName: string;
  currency: string;
};

function daysBetween(target: string | null): number | null {
  if (!target) return null;
  const diff = new Date(target).getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export async function getInventoryData(): Promise<InventoryData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  // Explicit column list: unit_cost is not readable by `authenticated` and a
  // `*` select would be rejected outright. Cost comes from batch_costs.
  let batchQuery = supabase
    .from("product_batches")
    .select(`${BATCH_COLUMNS}, products(name, sku, reorder_level), suppliers(name), branches(name)`)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (entityId) batchQuery = batchQuery.eq("branch_id", entityId);

  const [{ data: batches }, { data: entities }, costs] = await Promise.all([
    batchQuery,
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    batchCostMap(supabase, entityId),
  ]);

  const rows: BatchRow[] = (batches ?? []).map((batch) => {
    const product = one<{ name: string; sku: string; reorder_level: number }>(batch.products);
    const unitCost = costs.get(batch.id) ?? null;
    const available = batch.quantity_available;

    return {
      id: batch.id,
      batchNumber: batch.batch_number,
      productId: batch.product_id,
      productName: product?.name ?? "—",
      sku: product?.sku ?? "—",
      supplierName: one<{ name: string }>(batch.suppliers)?.name ?? null,
      entityName: one<{ name: string }>(batch.branches)?.name ?? null,
      quantityReceived: batch.quantity_received,
      quantityAvailable: available,
      unitCost,
      stockValue: unitCost === null ? null : Math.max(0, available) * unitCost,
      expiryDate: batch.expiry_date,
      daysToExpiry: daysBetween(batch.expiry_date),
      storageLocation: batch.storage_location,
      status: batch.status,
      sourceType: batch.source_type,
      receivedAt: batch.received_at,
    };
  });

  const availableUnits = rows.reduce((sum, row) => sum + Math.max(0, row.quantityAvailable), 0);
  const value = rows.reduce((sum, row) => sum + (row.stockValue ?? 0), 0);
  const expiringSoon = rows.filter(
    (row) => row.daysToExpiry !== null && row.daysToExpiry >= 0 && row.daysToExpiry <= 90 && row.quantityAvailable > 0
  ).length;
  const expired = rows.filter(
    (row) => row.daysToExpiry !== null && row.daysToExpiry < 0 && row.quantityAvailable > 0
  ).length;

  const stats: Array<[string, string, string]> = [
    ["Available units", availableUnits.toLocaleString("en-US"), scope.entityName],
    scope.canViewCost
      ? ["Stock value", Math.round(value).toLocaleString("en-US"), scope.currency]
      : ["Batches", String(rows.length), `${rows.filter((r) => r.status === "active").length} active`],
    ["Expiring within 90 days", String(expiringSoon), "Needs attention"],
    ["Expired in stock", String(expired), "Write off"],
  ];

  return {
    batches: rows,
    entities: entities ?? [],
    stats,
    canAdjust: scope.employee?.permissions.includes("adjust_inventory") ?? false,
    canViewCost: scope.canViewCost,
    canExport: scope.canExport,
    entityName: scope.entityName,
    currency: scope.currency,
  };
}

export type LedgerRow = {
  id: string;
  createdAt: string;
  movementType: string;
  movementLabel: string;
  productName: string;
  sku: string;
  batchNumber: string | null;
  quantityIn: number;
  quantityOut: number;
  balanceAfter: number | null;
  referenceNumber: string | null;
  reason: string | null;
  userName: string | null;
  entityName: string | null;
};

export type StockLedgerData = {
  movements: LedgerRow[];
  products: { id: string; name: string; sku: string }[];
  movementTypes: Array<{ value: string; label: string }>;
  stats: Array<[string, string, string]>;
  canExport: boolean;
  entityName: string;
};

export const MOVEMENT_LABELS: Record<string, string> = {
  opening_stock: "Opening stock",
  purchase: "Purchase",
  purchase_receipt: "Purchase (legacy GRN)",
  foc: "Free goods / FOC",
  replacement_in: "Replacement in",
  sale: "Sale",
  sale_reversal: "Sale reversal",
  employee_consumption: "Employee consumption",
  expiry: "Expiry write-off",
  damage: "Damage write-off",
  supplier_return: "Supplier return",
  stock_correction: "Stock correction",
  adjustment: "Adjustment (legacy)",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  return: "Customer return",
  disposal: "Disposal (legacy)",
  count_correction: "Count correction (legacy)",
};

export async function getStockLedgerData(): Promise<StockLedgerData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let movementQuery = supabase
    .from("stock_movements")
    .select(
      "*, products(name, sku), product_batches(batch_number), employees(full_name), branches(name)"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (entityId) movementQuery = movementQuery.eq("branch_id", entityId);

  let productQuery = supabase.from("products").select("id, name, sku").order("name");
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  const [{ data: movements }, { data: products }] = await Promise.all([movementQuery, productQuery]);

  const rows: LedgerRow[] = (movements ?? []).map((movement) => {
    const product = one<{ name: string; sku: string }>(movement.products);
    const delta = movement.quantity_delta;
    return {
      id: movement.id,
      createdAt: movement.created_at,
      movementType: movement.movement_type,
      movementLabel: MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type,
      productName: product?.name ?? "—",
      sku: product?.sku ?? "—",
      batchNumber: one<{ batch_number: string }>(movement.product_batches)?.batch_number ?? null,
      quantityIn: delta > 0 ? delta : 0,
      quantityOut: delta < 0 ? -delta : 0,
      balanceAfter: movement.balance_after,
      referenceNumber: movement.reference_number,
      reason: movement.reason,
      userName: one<{ full_name: string }>(movement.employees)?.full_name ?? null,
      entityName: one<{ name: string }>(movement.branches)?.name ?? null,
    };
  });

  const totalIn = rows.reduce((sum, row) => sum + row.quantityIn, 0);
  const totalOut = rows.reduce((sum, row) => sum + row.quantityOut, 0);
  const usedTypes = [...new Set(rows.map((row) => row.movementType))].sort();

  const stats: Array<[string, string, string]> = [
    ["Movements", String(rows.length), "Most recent 500"],
    ["Units in", totalIn.toLocaleString("en-US"), scope.entityName],
    ["Units out", totalOut.toLocaleString("en-US"), scope.entityName],
    ["Movement types", String(usedTypes.length), "In use"],
  ];

  return {
    movements: rows,
    products: products ?? [],
    movementTypes: Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label })),
    stats,
    canExport: scope.canExport,
    entityName: scope.entityName,
  };
}

export type ReorderRow = {
  productId: string;
  sku: string;
  name: string;
  supplierName: string;
  available: number;
  minimum: number;
  restockTarget: number;
  reorderQuantity: number;
  estimatedCost: number | null;
  entityName: string | null;
};

export type LowStockData = {
  lowStock: ReorderRow[];
  outOfStock: ReorderRow[];
  requirement: ReorderRow[];
  stats: Array<[string, string, string]>;
  canExport: boolean;
  canViewCost: boolean;
  entityName: string;
  currency: string;
};

export async function getLowStockData(): Promise<LowStockData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let productQuery = supabase
    .from("products")
    .select("id, sku, name, reorder_level, restock_target, suppliers(name), branches(name)")
    .eq("status", "active")
    .order("name");
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  let batchQuery = supabase
    .from("product_batches")
    .select("product_id, quantity_available")
    .eq("status", "active");
  if (entityId) batchQuery = batchQuery.eq("branch_id", entityId);

  const [{ data: products }, { data: batches }, costs] = await Promise.all([
    productQuery,
    batchQuery,
    productCostMap(supabase, entityId),
  ]);

  const availableByProduct = new Map<string, number>();
  for (const batch of batches ?? []) {
    availableByProduct.set(
      batch.product_id,
      (availableByProduct.get(batch.product_id) ?? 0) + Math.max(0, batch.quantity_available)
    );
  }

  const all: ReorderRow[] = (products ?? []).map((product) => {
    const available = availableByProduct.get(product.id) ?? 0;
    const reorder = reorderQuantity(available, product.restock_target);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      supplierName: one<{ name: string }>(product.suppliers)?.name ?? "Unassigned",
      available,
      minimum: product.reorder_level,
      restockTarget: product.restock_target,
      reorderQuantity: reorder,
      estimatedCost: costs.has(product.id) ? reorder * costs.get(product.id)! : null,
      entityName: one<{ name: string }>(product.branches)?.name ?? null,
    };
  });

  const outOfStock = all.filter((row) => row.available <= 0);
  const lowStock = all.filter((row) => row.available > 0 && row.available <= row.minimum);
  const requirement = all
    .filter((row) => row.available <= row.minimum && row.reorderQuantity > 0)
    .sort((a, b) => {
      const bySupplier = a.supplierName.localeCompare(b.supplierName);
      return bySupplier !== 0 ? bySupplier : a.name.localeCompare(b.name);
    });

  const estimatedTotal = requirement.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0);

  const stats: Array<[string, string, string]> = [
    ["Low stock", String(lowStock.length), scope.entityName],
    ["Out of stock", String(outOfStock.length), "No sellable quantity"],
    ["Units to reorder", requirement.reduce((sum, row) => sum + row.reorderQuantity, 0).toLocaleString("en-US"), "Restock target minus available"],
    scope.canViewCost
      ? ["Estimated cost", Math.round(estimatedTotal).toLocaleString("en-US"), scope.currency]
      : ["Suppliers", String(new Set(requirement.map((row) => row.supplierName)).size), "To order from"],
  ];

  return {
    lowStock,
    outOfStock,
    requirement,
    stats,
    canExport: scope.canExport,
    canViewCost: scope.canViewCost,
    entityName: scope.entityName,
    currency: scope.currency,
  };
}
