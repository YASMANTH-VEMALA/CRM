import "server-only";
import { getScope } from "./scope";
import { reorderQuantity } from "@/lib/pricing";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export type MetricTile = { label: string; value: string; note: string };

export type EntityDashboard = {
  kind: "entity";
  entityName: string;
  currency: string;
  metrics: MetricTile[];
  lowStock: Array<{ sku: string; name: string; available: number; minimum: number; reorder: number }>;
  outOfStock: Array<{ sku: string; name: string; supplierName: string }>;
  recentInward: Array<{ reference: string; type: string; supplier: string; units: number; status: string; date: string }>;
  recentSales: Array<{ invoice: string; customer: string; cashier: string; total: number; status: string; soldAt: string }>;
  topProducts: Array<{ name: string; sku: string; quantity: number; revenue: number }>;
  employeePerformance: Array<{ name: string; transactions: number; revenue: number }>;
  pendingSupplierReturns: Array<{ reference: string; product: string; quantity: number; resolution: string | null; status: string }>;
  canViewCost: boolean;
  canViewProfit: boolean;
};

export type MasterDashboard = {
  kind: "master";
  currency: string;
  metrics: MetricTile[];
  entities: Array<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    transactions: number;
    revenue: number;
    profit: number | null;
    stockValue: number | null;
    lowStock: number;
  }>;
  bestEntity: string | null;
  employeeComparison: Array<{ name: string; entity: string; transactions: number; revenue: number }>;
  canViewCost: boolean;
  canViewProfit: boolean;
};

export type DashboardData = EntityDashboard | MasterDashboard;

/**
 * The dashboard follows the entity switcher: a specific entity renders the
 * operational view, "all entities" renders the consolidated master view.
 * Cost and profit tiles are omitted from the payload entirely for users
 * without the corresponding permission.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const scope = await getScope();
  return scope.entityId === null ? masterDashboard() : entityDashboard();
}

async function entityDashboard(): Promise<EntityDashboard> {
  const scope = await getScope();
  const { supabase, entityId } = scope;
  const today = startOfToday().toISOString();
  const monthStart = startOfMonth();

  // Each query applies the active-entity filter inline; a shared generic
  // wrapper makes PostgREST's builder types recurse past their depth limit.
  const anyEntity = entityId ?? "";

  let todaySalesQuery = supabase
    .from("sales")
    .select("total, discount, status")
    .gte("sold_at", today)
    .neq("status", "reversed");
  if (entityId) todaySalesQuery = todaySalesQuery.eq("branch_id", anyEntity);

  let productQuery = supabase
    .from("products")
    .select("id, sku, name, reorder_level, restock_target, suppliers(name)")
    .eq("status", "active");
  if (entityId) productQuery = productQuery.eq("branch_id", anyEntity);

  let batchQuery = supabase
    .from("product_batches")
    .select("product_id, quantity_available, unit_cost")
    .eq("status", "active");
  if (entityId) batchQuery = batchQuery.eq("branch_id", anyEntity);

  let recentSalesQuery = supabase
    .from("sales")
    .select("invoice_number, total, status, sold_at, customers(name), employees!sales_cashier_id_fkey(full_name)")
    .order("sold_at", { ascending: false })
    .limit(8);
  if (entityId) recentSalesQuery = recentSalesQuery.eq("branch_id", anyEntity);

  let inwardQuery = supabase
    .from("stock_inwards")
    .select("reference, inward_type, status, created_at, suppliers(name), stock_inward_items(quantity, free_quantity)")
    .order("created_at", { ascending: false })
    .limit(8);
  if (entityId) inwardQuery = inwardQuery.eq("branch_id", anyEntity);

  let supplierReturnQuery = supabase
    .from("returns")
    .select("reference, quantity, resolution_type, status, products(name)")
    .eq("type", "supplier")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(8);
  if (entityId) supplierReturnQuery = supplierReturnQuery.eq("branch_id", anyEntity);

  const [
    { data: todaySales },
    { data: products },
    { data: batches },
    { data: recentSales },
    { data: recentInward },
    { data: supplierReturns },
    { data: monthItems },
  ] = await Promise.all([
    todaySalesQuery,
    productQuery,
    batchQuery,
    recentSalesQuery,
    inwardQuery,
    supplierReturnQuery,
    supabase
      .from("sale_items")
      .select(
        "quantity, line_total, product_id, products(name, sku, buy_price), sales!inner(id, branch_id, status, sold_at, employees!sales_cashier_id_fkey(full_name))"
      )
      .limit(3000),
  ]);

  const availableByProduct = new Map<string, number>();
  let stockUnits = 0;
  let stockValue = 0;
  for (const batch of batches ?? []) {
    const available = Math.max(0, batch.quantity_available);
    availableByProduct.set(batch.product_id, (availableByProduct.get(batch.product_id) ?? 0) + available);
    stockUnits += available;
    stockValue += available * Number(batch.unit_cost);
  }

  const lowStock: EntityDashboard["lowStock"] = [];
  const outOfStock: EntityDashboard["outOfStock"] = [];
  for (const product of products ?? []) {
    const available = availableByProduct.get(product.id) ?? 0;
    if (available <= 0) {
      outOfStock.push({
        sku: product.sku,
        name: product.name,
        supplierName: one<{ name: string }>(product.suppliers)?.name ?? "Unassigned",
      });
    } else if (available <= product.reorder_level) {
      lowStock.push({
        sku: product.sku,
        name: product.name,
        available,
        minimum: product.reorder_level,
        reorder: reorderQuantity(available, product.restock_target),
      });
    }
  }

  const sales = todaySales ?? [];
  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const discount = sales.reduce((sum, sale) => sum + Number(sale.discount), 0);

  // Sale items carry the entity on their parent sale, so this-month scoping
  // happens in memory rather than in the query.
  type ItemRow = { quantity: number; line_total: number; product_id: string; products: unknown; sales: unknown };
  const scopedItems = ((monthItems ?? []) as unknown as ItemRow[]).filter((item) => {
    const sale = one<{ branch_id: string; status: string; sold_at: string }>(item.sales);
    if (!sale || sale.status === "reversed") return false;
    if (entityId && sale.branch_id !== entityId) return false;
    return new Date(sale.sold_at) >= monthStart;
  });

  const productTotals = new Map<string, { name: string; sku: string; quantity: number; revenue: number }>();
  const employeeTotals = new Map<string, { transactions: number; revenue: number; saleIds: Set<string> }>();
  let monthRevenue = 0;
  let monthCost = 0;

  for (const item of scopedItems) {
    const product = one<{ name: string; sku: string; buy_price: number }>(item.products);
    const bucket = productTotals.get(item.product_id) ?? {
      name: product?.name ?? "—",
      sku: product?.sku ?? "—",
      quantity: 0,
      revenue: 0,
    };
    bucket.quantity += item.quantity;
    bucket.revenue += Number(item.line_total);
    productTotals.set(item.product_id, bucket);

    monthRevenue += Number(item.line_total);
    monthCost += Number(product?.buy_price ?? 0) * item.quantity;

    const sale = one<{ id: string; employees: unknown }>(item.sales);
    const name = one<{ full_name: string }>(sale?.employees)?.full_name ?? "Unattributed";
    const employee = employeeTotals.get(name) ?? { transactions: 0, revenue: 0, saleIds: new Set<string>() };
    employee.revenue += Number(item.line_total);
    if (sale?.id) employee.saleIds.add(sale.id);
    employeeTotals.set(name, employee);
  }

  const metrics: MetricTile[] = [
    { label: "Today's transactions", value: String(sales.length), note: scope.entityName },
    {
      label: "Today's revenue",
      value: Math.round(revenue).toLocaleString("en-US"),
      note: `${scope.currency} · ${Math.round(discount).toLocaleString("en-US")} discount`,
    },
    {
      label: "Stock on hand",
      value: stockUnits.toLocaleString("en-US"),
      note: `${(batches ?? []).length} active batches`,
    },
  ];
  if (scope.canViewCost) {
    metrics.push({
      label: "Stock value",
      value: Math.round(stockValue).toLocaleString("en-US"),
      note: `${scope.currency} at cost`,
    });
  }
  if (scope.canViewProfit) {
    metrics.push({
      label: "Gross profit this month",
      value: Math.round(monthRevenue - monthCost).toLocaleString("en-US"),
      note: `${scope.currency} on ${Math.round(monthRevenue).toLocaleString("en-US")} revenue`,
    });
  }
  metrics.push(
    { label: "Low stock", value: String(lowStock.length), note: "At or below minimum" },
    { label: "Out of stock", value: String(outOfStock.length), note: "No sellable quantity" }
  );

  return {
    kind: "entity",
    entityName: scope.entityName,
    currency: scope.currency,
    metrics,
    lowStock: lowStock.slice(0, 8),
    outOfStock: outOfStock.slice(0, 8),
    recentInward: (recentInward ?? []).map((doc) => {
      const items = (doc.stock_inward_items ?? []) as Array<{ quantity: number; free_quantity: number }>;
      return {
        reference: doc.reference,
        type: doc.inward_type,
        supplier: one<{ name: string }>(doc.suppliers)?.name ?? "—",
        units: items.reduce((sum, item) => sum + item.quantity + item.free_quantity, 0),
        status: doc.status,
        date: doc.created_at,
      };
    }),
    recentSales: (recentSales ?? []).map((sale) => ({
      invoice: sale.invoice_number,
      customer: one<{ name: string }>(sale.customers)?.name ?? "Walk-in",
      cashier: one<{ full_name: string }>(sale.employees)?.full_name ?? "—",
      total: Number(sale.total),
      status: sale.status,
      soldAt: sale.sold_at,
    })),
    topProducts: [...productTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    employeePerformance: [...employeeTotals.entries()]
      .map(([name, bucket]) => ({ name, transactions: bucket.saleIds.size, revenue: bucket.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    pendingSupplierReturns: (supplierReturns ?? []).map((record) => ({
      reference: record.reference,
      product: one<{ name: string }>(record.products)?.name ?? "—",
      quantity: record.quantity,
      resolution: record.resolution_type,
      status: record.status,
    })),
    canViewCost: scope.canViewCost,
    canViewProfit: scope.canViewProfit,
  };
}

async function masterDashboard(): Promise<MasterDashboard> {
  const scope = await getScope();
  const { supabase } = scope;
  const monthStart = startOfMonth();

  const [{ data: entities }, { data: sales }, { data: batches }, { data: products }, { data: items }] =
    await Promise.all([
      supabase.from("branches").select("id, code, name, is_active").order("name"),
      supabase
        .from("sales")
        .select("branch_id, total, employees!sales_cashier_id_fkey(full_name), branches(name)")
        .gte("sold_at", monthStart.toISOString())
        .neq("status", "reversed"),
      supabase
        .from("product_batches")
        .select("branch_id, product_id, quantity_available, unit_cost")
        .eq("status", "active"),
      supabase.from("products").select("id, branch_id, reorder_level").eq("status", "active"),
      supabase
        .from("sale_items")
        .select("quantity, products(buy_price), sales!inner(branch_id, status, sold_at)")
        .limit(5000),
    ]);

  const stockValue = new Map<string, number>();
  const availableByProduct = new Map<string, number>();
  for (const batch of batches ?? []) {
    const available = Math.max(0, batch.quantity_available);
    stockValue.set(batch.branch_id, (stockValue.get(batch.branch_id) ?? 0) + available * Number(batch.unit_cost));
    availableByProduct.set(batch.product_id, (availableByProduct.get(batch.product_id) ?? 0) + available);
  }

  const lowStock = new Map<string, number>();
  for (const product of products ?? []) {
    if ((availableByProduct.get(product.id) ?? 0) <= product.reorder_level) {
      lowStock.set(product.branch_id, (lowStock.get(product.branch_id) ?? 0) + 1);
    }
  }

  const salesByEntity = new Map<string, { transactions: number; revenue: number }>();
  const employeeTotals = new Map<string, { entity: string; transactions: number; revenue: number }>();
  for (const sale of sales ?? []) {
    const bucket = salesByEntity.get(sale.branch_id) ?? { transactions: 0, revenue: 0 };
    bucket.transactions += 1;
    bucket.revenue += Number(sale.total);
    salesByEntity.set(sale.branch_id, bucket);

    const name = one<{ full_name: string }>(sale.employees)?.full_name ?? "Unattributed";
    const entityName = one<{ name: string }>(sale.branches)?.name ?? "—";
    const employee = employeeTotals.get(name) ?? { entity: entityName, transactions: 0, revenue: 0 };
    employee.transactions += 1;
    employee.revenue += Number(sale.total);
    employeeTotals.set(name, employee);
  }

  const costByEntity = new Map<string, number>();
  type ItemRow = { quantity: number; products: unknown; sales: unknown };
  for (const item of (items ?? []) as unknown as ItemRow[]) {
    const sale = one<{ branch_id: string; status: string; sold_at: string }>(item.sales);
    if (!sale || sale.status === "reversed") continue;
    if (new Date(sale.sold_at) < monthStart) continue;
    const buyPrice = Number(one<{ buy_price: number }>(item.products)?.buy_price ?? 0);
    costByEntity.set(sale.branch_id, (costByEntity.get(sale.branch_id) ?? 0) + buyPrice * item.quantity);
  }

  const rows = (entities ?? []).map((entity) => {
    const bucket = salesByEntity.get(entity.id) ?? { transactions: 0, revenue: 0 };
    const cost = costByEntity.get(entity.id) ?? 0;
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      isActive: entity.is_active,
      transactions: bucket.transactions,
      revenue: bucket.revenue,
      profit: scope.canViewProfit ? bucket.revenue - cost : null,
      stockValue: scope.canViewCost ? (stockValue.get(entity.id) ?? 0) : null,
      lowStock: lowStock.get(entity.id) ?? 0,
    };
  });

  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const best = [...rows].sort((a, b) => b.revenue - a.revenue)[0];

  const metrics: MetricTile[] = [
    { label: "Entities", value: String(rows.length), note: `${rows.filter((r) => r.isActive).length} active` },
    {
      label: "Combined transactions",
      value: rows.reduce((sum, row) => sum + row.transactions, 0).toLocaleString("en-US"),
      note: "This month",
    },
    {
      label: "Combined revenue",
      value: Math.round(totalRevenue).toLocaleString("en-US"),
      note: `${scope.currency} this month`,
    },
  ];
  if (scope.canViewProfit) {
    metrics.push({
      label: "Combined gross profit",
      value: Math.round(rows.reduce((sum, row) => sum + (row.profit ?? 0), 0)).toLocaleString("en-US"),
      note: `${scope.currency} this month`,
    });
  }
  if (scope.canViewCost) {
    metrics.push({
      label: "Combined stock value",
      value: Math.round(rows.reduce((sum, row) => sum + (row.stockValue ?? 0), 0)).toLocaleString("en-US"),
      note: `${scope.currency} at cost`,
    });
  }
  metrics.push({
    label: "Low stock across network",
    value: String(rows.reduce((sum, row) => sum + row.lowStock, 0)),
    note: "Products at or below minimum",
  });

  return {
    kind: "master",
    currency: scope.currency,
    metrics,
    entities: rows,
    bestEntity: best && best.revenue > 0 ? best.name : null,
    employeeComparison: [...employeeTotals.entries()]
      .map(([name, bucket]) => ({ name, ...bucket }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    canViewCost: scope.canViewCost,
    canViewProfit: scope.canViewProfit,
  };
}
