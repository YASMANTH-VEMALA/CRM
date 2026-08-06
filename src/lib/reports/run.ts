import "server-only";
import { getScope, type LoaderScope } from "@/lib/data/scope";
import { batchCostMap, batchCostMapAllEntities, productCostMap } from "@/lib/data/costs";
import { effectiveMarginPercent, reorderQuantity } from "@/lib/pricing";
import { getReportDefinition } from "./definitions";
import type { ReportColumn, ReportFilters, ReportResult, ReportRow } from "./types";

const ROW_LIMIT = 5000;

export class ReportPermissionError extends Error {}

/**
 * Runs one report definition with the supplied filters.
 *
 * Entity isolation: RLS restricts every underlying table to entities the user
 * can access. On top of that, an explicit entity filter (or the active entity)
 * narrows to a single pharmacy; only master admins ever see consolidated rows.
 */
export async function runReport(reportId: string, filters: ReportFilters): Promise<ReportResult> {
  const definition = getReportDefinition(reportId);
  if (!definition) throw new ReportPermissionError("Unknown report.");

  const scope = await getScope();
  if (!scope.employee) throw new ReportPermissionError("Not signed in.");
  if (!scope.employee.permissions.includes(definition.permission)) {
    throw new ReportPermissionError("You do not have permission to view this report.");
  }
  if (definition.sensitive === "cost" && !scope.canViewCost) {
    throw new ReportPermissionError("You do not have permission to view purchase cost.");
  }
  if (definition.sensitive === "profit" && !scope.canViewProfit) {
    throw new ReportPermissionError("You do not have permission to view profit figures.");
  }

  // A requested entity is only honoured when the user can actually read it;
  // RLS makes the lookup return nothing otherwise.
  let entityId = scope.entityId;
  if (filters.entity) {
    const { data } = await scope.supabase
      .from("branches")
      .select("id")
      .eq("id", filters.entity)
      .maybeSingle();
    if (!data) throw new ReportPermissionError("You do not have access to that entity.");
    entityId = filters.entity;
  }

  const ctx: ReportContext = { scope, filters, entityId };

  switch (reportId) {
    case "current-stock":
      return currentStock(ctx);
    case "opening-stock":
      return openingStock(ctx);
    case "stock-inward":
      return stockInward(ctx);
    case "stock-outward":
      return stockOutward(ctx);
    case "stock-ledger":
      return stockLedger(ctx);
    case "low-stock":
      return lowOrOutOfStock(ctx, "low");
    case "out-of-stock":
      return lowOrOutOfStock(ctx, "out");
    case "stock-requirement":
      return stockRequirement(ctx);
    case "supplier-purchases":
      return supplierPurchases(ctx);
    case "supplier-returns":
      return supplierReturns(ctx);
    case "free-goods":
      return movementReport(ctx, ["foc"], "Free goods received");
    case "replacement-goods":
      return movementReport(ctx, ["replacement_in"], "Replacement stock received");
    case "daily-sales":
      return dailySales(ctx);
    case "product-sales":
      return productSales(ctx);
    case "employee-sales":
      return employeeSales(ctx);
    case "entity-sales":
      return entitySales(ctx);
    case "daily-revenue":
      return dailyRevenue(ctx);
    case "gross-profit":
      return grossProfit(ctx);
    case "discount-report":
      return discountReport(ctx);
    case "cost-vs-price":
      return costVsPrice(ctx);
    case "consolidated":
      return consolidated(ctx);
    default:
      throw new ReportPermissionError("This report has no query defined.");
  }
}

type ReportContext = {
  scope: LoaderScope;
  filters: ReportFilters;
  entityId: string | null;
};

// --- shared helpers -------------------------------------------------------

/**
 * Normalises a PostgREST embedded relation to a single record. The untyped
 * client infers one-to-one embeds as arrays, and the runtime shape differs
 * between `select("*")` and explicit column lists, so both are handled.
 */
function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function dayString(iso: string): string {
  return iso.slice(0, 10);
}

/** Inclusive end-of-day so a "to" date covers the whole day. */
function endOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function applyDateRange<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
  query: T,
  column: string,
  filters: ReportFilters
): T {
  let next = query;
  if (filters.dateFrom) next = next.gte(column, filters.dateFrom);
  if (filters.dateTo) next = next.lte(column, endOfDayIso(filters.dateTo));
  return next;
}

function summaryCount(label: string, count: number): [string, string] {
  return [label, count.toLocaleString("en-US")];
}

const MOVEMENT_LABELS: Record<string, string> = {
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

export const INWARD_MOVEMENTS = ["opening_stock", "purchase", "purchase_receipt", "foc", "replacement_in", "transfer_in"];
export const OUTWARD_MOVEMENTS = [
  "sale",
  "employee_consumption",
  "expiry",
  "damage",
  "supplier_return",
  "transfer_out",
  "disposal",
];

// --- Stock reports --------------------------------------------------------

async function currentStock({ scope, filters, entityId }: ReportContext): Promise<ReportResult> {
  let query = scope.supabase
    .from("product_batches")
    .select(
      "id, batch_number, quantity_available, expiry_date, status, branches(name), products!inner(name, sku, reorder_level), suppliers(name)"
    )
    .order("batch_number")
    .limit(ROW_LIMIT);

  if (entityId) query = query.eq("branch_id", entityId);
  if (filters.product) query = query.eq("product_id", filters.product);
  if (filters.supplier) query = query.eq("supplier_id", filters.supplier);

  const [{ data }, costs] = await Promise.all([query, batchCostMap(scope.supabase, entityId)]);
  const batches = data ?? [];

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "batch", header: "Batch" },
    { key: "expiry", header: "Expiry" },
    { key: "supplier", header: "Supplier", width: 22 },
    { key: "available", header: "Available", numeric: true },
    ...(scope.canViewCost
      ? [
          { key: "unitCost", header: "Unit cost", numeric: true, currency: true },
          { key: "value", header: "Stock value", numeric: true, currency: true },
        ]
      : []),
    { key: "status", header: "Status" },
  ];

  let totalUnits = 0;
  let totalValue = 0;
  const rows: ReportRow[] = batches.map((batch) => {
    const product = one<{ name: string; sku: string }>(batch.products);
    const available = Math.max(0, batch.quantity_available);
    const unitCost = costs.get(batch.id) ?? 0;
    totalUnits += available;
    totalValue += available * unitCost;
    return {
      entity: one<{ name: string }>(batch.branches)?.name ?? "—",
      sku: product?.sku ?? "—",
      product: product?.name ?? "—",
      batch: batch.batch_number,
      expiry: batch.expiry_date ?? "—",
      supplier: one<{ name: string }>(batch.suppliers)?.name ?? "—",
      available,
      unitCost: money(unitCost),
      value: money(available * unitCost),
      status: batch.status,
    };
  });

  const summary: Array<[string, string]> = [
    summaryCount("Batches", rows.length),
    summaryCount("Units on hand", totalUnits),
  ];
  if (scope.canViewCost) summary.push(["Stock value", money(totalValue).toLocaleString("en-US")]);

  return { columns, rows, summary, truncatedAt: rows.length >= ROW_LIMIT ? ROW_LIMIT : undefined };
}

async function openingStock({ scope, filters, entityId }: ReportContext): Promise<ReportResult> {
  let query = scope.supabase
    .from("opening_stock_items")
    .select(
      "batch_number, expiry_date, quantity, unit_cost, sell_price, products!inner(name, sku), opening_stock_entries!inner(reference, opening_date, status, branch_id, branches(name))"
    )
    .limit(ROW_LIMIT);

  if (filters.product) query = query.eq("product_id", filters.product);

  const { data } = await query;
  let items = data ?? [];

  type Entry = { reference: string; opening_date: string; status: string; branch_id: string; branches: { name: string } | null };
  items = items.filter((item) => {
    const entry = one<Entry>(item.opening_stock_entries);
    if (!entry) return false;
    if (entityId && entry.branch_id !== entityId) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (filters.dateFrom && entry.opening_date < filters.dateFrom) return false;
    if (filters.dateTo && entry.opening_date > filters.dateTo) return false;
    return true;
  });

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "reference", header: "Reference" },
    { key: "openingDate", header: "Opening date" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "batch", header: "Batch" },
    { key: "expiry", header: "Expiry" },
    { key: "quantity", header: "Quantity", numeric: true },
    ...(scope.canViewCost
      ? [{ key: "unitCost", header: "Unit cost", numeric: true, currency: true }]
      : []),
    { key: "sellPrice", header: "Selling price", numeric: true, currency: true },
    { key: "status", header: "Status" },
  ];

  let totalQty = 0;
  const rows: ReportRow[] = items.map((item) => {
    const entry = one<Entry>(item.opening_stock_entries)!;
    const product = one<{ name: string; sku: string }>(item.products)!;
    totalQty += item.quantity;
    return {
      entity: one<{ name: string }>(entry.branches)?.name ?? "—",
      reference: entry.reference,
      openingDate: entry.opening_date,
      sku: product.sku,
      product: product.name,
      batch: item.batch_number,
      expiry: item.expiry_date ?? "—",
      quantity: item.quantity,
      unitCost: money(Number(item.unit_cost)),
      sellPrice: item.sell_price == null ? "—" : money(Number(item.sell_price)),
      status: entry.status,
    };
  });

  return {
    columns,
    rows,
    summary: [summaryCount("Lines", rows.length), summaryCount("Units", totalQty)],
  };
}

async function stockInward({ scope, filters, entityId }: ReportContext): Promise<ReportResult> {
  let query = scope.supabase
    .from("stock_inward_items")
    .select(
      "batch_number, expiry_date, quantity, free_quantity, unit_cost, products!inner(name, sku), stock_inwards!inner(reference, inward_type, invoice_number, invoice_date, status, branch_id, created_at, branches(name), suppliers(name))"
    )
    .limit(ROW_LIMIT);

  if (filters.product) query = query.eq("product_id", filters.product);

  const { data } = await query;
  type Doc = {
    reference: string;
    inward_type: string;
    invoice_number: string | null;
    invoice_date: string | null;
    status: string;
    branch_id: string;
    created_at: string;
    branches: { name: string } | null;
    suppliers: { name: string } | null;
  };

  const items = (data ?? []).filter((item) => {
    const doc = one<Doc>(item.stock_inwards);
    if (!doc) return false;
    if (entityId && doc.branch_id !== entityId) return false;
    if (filters.status && doc.status !== filters.status) return false;
    if (filters.transactionType && doc.inward_type !== filters.transactionType) return false;
    if (filters.supplier && one<{ name: string }>(doc.suppliers) === null) return false;
    const day = doc.invoice_date ?? dayString(doc.created_at);
    if (filters.dateFrom && day < filters.dateFrom) return false;
    if (filters.dateTo && day > filters.dateTo) return false;
    return true;
  });

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "reference", header: "Reference" },
    { key: "type", header: "Inward type", width: 22 },
    { key: "supplier", header: "Supplier", width: 22 },
    { key: "invoice", header: "Invoice no." },
    { key: "invoiceDate", header: "Invoice date" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "batch", header: "Batch" },
    { key: "expiry", header: "Expiry" },
    { key: "quantity", header: "Quantity", numeric: true },
    { key: "freeQuantity", header: "Free qty", numeric: true },
    ...(scope.canViewCost
      ? [
          { key: "unitCost", header: "Unit cost", numeric: true, currency: true },
          { key: "totalCost", header: "Total cost", numeric: true, currency: true },
        ]
      : []),
    { key: "status", header: "Status" },
  ];

  let totalQty = 0;
  let totalFree = 0;
  let totalCost = 0;
  const rows: ReportRow[] = items.map((item) => {
    const doc = one<Doc>(item.stock_inwards)!;
    const product = one<{ name: string; sku: string }>(item.products)!;
    totalQty += item.quantity;
    totalFree += item.free_quantity;
    totalCost += item.quantity * Number(item.unit_cost);
    return {
      entity: one<{ name: string }>(doc.branches)?.name ?? "—",
      reference: doc.reference,
      type: INWARD_TYPE_LABELS[doc.inward_type] ?? doc.inward_type,
      supplier: one<{ name: string }>(doc.suppliers)?.name ?? "—",
      invoice: doc.invoice_number ?? "—",
      invoiceDate: doc.invoice_date ?? "—",
      sku: product.sku,
      product: product.name,
      batch: item.batch_number,
      expiry: item.expiry_date ?? "—",
      quantity: item.quantity,
      freeQuantity: item.free_quantity,
      unitCost: money(Number(item.unit_cost)),
      totalCost: money(item.quantity * Number(item.unit_cost)),
      status: doc.status,
    };
  });

  const summary: Array<[string, string]> = [
    summaryCount("Lines", rows.length),
    summaryCount("Paid units", totalQty),
    summaryCount("Free units", totalFree),
  ];
  if (scope.canViewCost) summary.push(["Total cost", money(totalCost).toLocaleString("en-US")]);

  return { columns, rows, summary };
}

export const INWARD_TYPE_LABELS: Record<string, string> = {
  purchase_from_parent: "Purchase from parent",
  purchase_from_external: "Purchase from external supplier",
  foc_or_sample: "Free of charge / sample",
  replacement_in: "Replacement in",
};

async function stockOutward(ctx: ReportContext): Promise<ReportResult> {
  const requested = ctx.filters.transactionType;
  const types = requested && OUTWARD_MOVEMENTS.includes(requested) ? [requested] : OUTWARD_MOVEMENTS;
  return movementReport(ctx, types, "Stock out");
}

async function movementReport(
  { scope, filters, entityId }: ReportContext,
  movementTypes: string[],
  label: string
): Promise<ReportResult> {
  let query = scope.supabase
    .from("stock_movements")
    .select(
      "created_at, movement_type, quantity_delta, balance_after, reference_number, reason, branches(name), products(name, sku), product_batches(batch_number, expiry_date), employees(full_name)"
    )
    .in("movement_type", movementTypes)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (entityId) query = query.eq("branch_id", entityId);
  if (filters.product) query = query.eq("product_id", filters.product);
  query = applyDateRange(query, "created_at", filters);

  const { data } = await query;
  const movements = data ?? [];

  const columns: ReportColumn[] = [
    { key: "date", header: "Date" },
    { key: "entity", header: "Entity" },
    { key: "type", header: "Movement", width: 22 },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "batch", header: "Batch" },
    { key: "expiry", header: "Expiry" },
    { key: "quantityIn", header: "Qty in", numeric: true },
    { key: "quantityOut", header: "Qty out", numeric: true },
    { key: "balanceAfter", header: "Balance after", numeric: true },
    { key: "reference", header: "Reference" },
    { key: "user", header: "User", width: 20 },
    { key: "reason", header: "Reason", width: 30 },
  ];

  let totalIn = 0;
  let totalOut = 0;
  const rows: ReportRow[] = movements.map((movement) => {
    const delta = movement.quantity_delta;
    if (delta > 0) totalIn += delta;
    else totalOut += -delta;
    const product = one<{ name: string; sku: string }>(movement.products);
    const batch = one<{ batch_number: string; expiry_date: string | null }>(movement.product_batches);
    return {
      date: dayString(movement.created_at),
      entity: one<{ name: string }>(movement.branches)?.name ?? "—",
      type: MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type,
      sku: product?.sku ?? "—",
      product: product?.name ?? "—",
      batch: batch?.batch_number ?? "—",
      expiry: batch?.expiry_date ?? "—",
      quantityIn: delta > 0 ? delta : 0,
      quantityOut: delta < 0 ? -delta : 0,
      balanceAfter: movement.balance_after ?? "—",
      reference: movement.reference_number ?? "—",
      user: one<{ full_name: string }>(movement.employees)?.full_name ?? "—",
      reason: movement.reason ?? "—",
    };
  });

  return {
    columns,
    rows,
    summary: [
      summaryCount(`${label} movements`, rows.length),
      summaryCount("Units in", totalIn),
      summaryCount("Units out", totalOut),
    ],
    truncatedAt: rows.length >= ROW_LIMIT ? ROW_LIMIT : undefined,
  };
}

async function stockLedger(ctx: ReportContext): Promise<ReportResult> {
  const requested = ctx.filters.transactionType;
  const allTypes = [...INWARD_MOVEMENTS, ...OUTWARD_MOVEMENTS, "sale_reversal", "stock_correction", "adjustment", "return", "count_correction"];
  const types = requested && allTypes.includes(requested) ? [requested] : allTypes;
  return movementReport(ctx, types, "Ledger");
}

type ProductStockRow = {
  id: string;
  sku: string;
  name: string;
  reorder_level: number;
  restock_target: number;
  supplier_id: string | null;
  buy_price: number;
  sell_price: number;
  margin_percent: number;
  pricing_method: string;
  max_discount_percent: number;
  branches: { name: string } | null;
  suppliers: { name: string } | null;
};

async function loadProductsWithStock(
  { scope, filters, entityId }: ReportContext
): Promise<Array<ProductStockRow & { available: number }>> {
  let productQuery = scope.supabase
    .from("products")
    .select(
      "id, sku, name, reorder_level, restock_target, supplier_id, sell_price, margin_percent, pricing_method, max_discount_percent, branches(name), suppliers(name)"
    )
    .eq("status", "active")
    .order("name")
    .limit(ROW_LIMIT);

  if (entityId) productQuery = productQuery.eq("branch_id", entityId);
  if (filters.product) productQuery = productQuery.eq("id", filters.product);
  if (filters.supplier) productQuery = productQuery.eq("supplier_id", filters.supplier);

  let batchQuery = scope.supabase
    .from("product_batches")
    .select("product_id, quantity_available")
    .eq("status", "active");
  if (entityId) batchQuery = batchQuery.eq("branch_id", entityId);

  const [{ data: products }, { data: batches }, costs] = await Promise.all([
    productQuery,
    batchQuery,
    productCostMap(scope.supabase, entityId),
  ]);

  const availableByProduct = new Map<string, number>();
  for (const batch of batches ?? []) {
    availableByProduct.set(
      batch.product_id,
      (availableByProduct.get(batch.product_id) ?? 0) + Math.max(0, batch.quantity_available)
    );
  }

  // buy_price is not selectable; it is merged in from product_costs, which is
  // empty for a caller without view_purchase_cost.
  return ((products ?? []) as unknown as Array<Omit<ProductStockRow, "buy_price">>).map((product) => ({
    ...product,
    buy_price: costs.get(product.id) ?? 0,
    available: availableByProduct.get(product.id) ?? 0,
  }));
}

async function lowOrOutOfStock(ctx: ReportContext, mode: "low" | "out"): Promise<ReportResult> {
  const products = await loadProductsWithStock(ctx);
  const matching = products.filter((product) =>
    mode === "out" ? product.available <= 0 : product.available > 0 && product.available <= product.reorder_level
  );

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "supplier", header: "Default supplier", width: 22 },
    { key: "available", header: "Available", numeric: true },
    { key: "minimum", header: "Minimum", numeric: true },
    { key: "restockTarget", header: "Restock target", numeric: true },
    { key: "reorderQuantity", header: "Reorder qty", numeric: true },
  ];

  const rows: ReportRow[] = matching.map((product) => ({
    entity: product.branches?.name ?? "—",
    sku: product.sku,
    product: product.name,
    supplier: product.suppliers?.name ?? "—",
    available: product.available,
    minimum: product.reorder_level,
    restockTarget: product.restock_target,
    reorderQuantity: reorderQuantity(product.available, product.restock_target),
  }));

  return {
    columns,
    rows,
    summary: [
      summaryCount(mode === "out" ? "Out of stock" : "Low stock", rows.length),
      summaryCount("Units to reorder", rows.reduce((sum, row) => sum + Number(row.reorderQuantity), 0)),
    ],
  };
}

async function stockRequirement(ctx: ReportContext): Promise<ReportResult> {
  const products = await loadProductsWithStock(ctx);
  const needing = products
    .filter((product) => product.available <= product.reorder_level && product.restock_target > 0)
    .map((product) => ({
      ...product,
      reorder: reorderQuantity(product.available, product.restock_target),
    }))
    .filter((product) => product.reorder > 0)
    // Supplier grouping: same supplier's lines stay together for ordering.
    .sort((a, b) => {
      const supplierCompare = (a.suppliers?.name ?? "zzz").localeCompare(b.suppliers?.name ?? "zzz");
      return supplierCompare !== 0 ? supplierCompare : a.name.localeCompare(b.name);
    });

  const columns: ReportColumn[] = [
    { key: "supplier", header: "Supplier", width: 24 },
    { key: "entity", header: "Entity" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "available", header: "Available", numeric: true },
    { key: "minimum", header: "Minimum", numeric: true },
    { key: "restockTarget", header: "Restock target", numeric: true },
    { key: "reorderQuantity", header: "Reorder qty", numeric: true },
    ...(ctx.scope.canViewCost
      ? [{ key: "estimatedCost", header: "Estimated cost", numeric: true, currency: true }]
      : []),
  ];

  let estimatedTotal = 0;
  const rows: ReportRow[] = needing.map((product) => {
    const cost = product.reorder * Number(product.buy_price);
    estimatedTotal += cost;
    return {
      supplier: product.suppliers?.name ?? "Unassigned",
      entity: product.branches?.name ?? "—",
      sku: product.sku,
      product: product.name,
      available: product.available,
      minimum: product.reorder_level,
      restockTarget: product.restock_target,
      reorderQuantity: product.reorder,
      estimatedCost: money(cost),
    };
  });

  const summary: Array<[string, string]> = [
    summaryCount("Products to reorder", rows.length),
    summaryCount("Units required", needing.reduce((sum, product) => sum + product.reorder, 0)),
    summaryCount("Suppliers", new Set(rows.map((row) => row.supplier)).size),
  ];
  if (ctx.scope.canViewCost) {
    summary.push(["Estimated cost", money(estimatedTotal).toLocaleString("en-US")]);
  }

  return { columns, rows, summary };
}

async function costVsPrice(ctx: ReportContext): Promise<ReportResult> {
  const products = await loadProductsWithStock(ctx);

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "supplier", header: "Default supplier", width: 22 },
    { key: "pricingMethod", header: "Pricing method", width: 20 },
    { key: "buyPrice", header: "Purchase cost", numeric: true, currency: true },
    { key: "sellPrice", header: "Selling price", numeric: true, currency: true },
    { key: "marginValue", header: "Margin value", numeric: true, currency: true },
    { key: "marginPercent", header: "Margin %", numeric: true },
    { key: "maxDiscount", header: "Max discount %", numeric: true },
  ];

  const rows: ReportRow[] = products.map((product) => ({
    entity: product.branches?.name ?? "—",
    sku: product.sku,
    product: product.name,
    supplier: product.suppliers?.name ?? "—",
    pricingMethod: product.pricing_method === "cost_plus_margin" ? "Cost plus margin" : "Fixed",
    buyPrice: money(Number(product.buy_price)),
    sellPrice: money(Number(product.sell_price)),
    marginValue: money(Number(product.sell_price) - Number(product.buy_price)),
    marginPercent: money(effectiveMarginPercent(Number(product.buy_price), Number(product.sell_price))),
    maxDiscount: money(Number(product.max_discount_percent)),
  }));

  return { columns, rows, summary: [summaryCount("Products", rows.length)] };
}

// --- Purchasing reports ---------------------------------------------------

async function supplierPurchases({ scope, filters, entityId }: ReportContext): Promise<ReportResult> {
  let query = scope.supabase
    .from("stock_inwards")
    .select(
      "reference, invoice_number, invoice_date, inward_type, status, created_at, branches(name), suppliers(name), stock_inward_items(quantity, free_quantity, unit_cost)"
    )
    .eq("status", "confirmed")
    .in("inward_type", ["purchase_from_parent", "purchase_from_external"])
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (entityId) query = query.eq("branch_id", entityId);
  if (filters.supplier) query = query.eq("supplier_id", filters.supplier);
  query = applyDateRange(query, "created_at", filters);

  const { data } = await query;

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "supplier", header: "Supplier", width: 24 },
    { key: "reference", header: "Reference" },
    { key: "invoice", header: "Invoice no." },
    { key: "invoiceDate", header: "Invoice date" },
    { key: "type", header: "Type", width: 22 },
    { key: "lines", header: "Lines", numeric: true },
    { key: "paidUnits", header: "Paid units", numeric: true },
    { key: "freeUnits", header: "Free units", numeric: true },
    { key: "totalCost", header: "Total cost", numeric: true, currency: true },
  ];

  let grandTotal = 0;
  const rows: ReportRow[] = (data ?? []).map((doc) => {
    const items = (doc.stock_inward_items ?? []) as Array<{
      quantity: number;
      free_quantity: number;
      unit_cost: number;
    }>;
    const total = items.reduce((sum, item) => sum + item.quantity * Number(item.unit_cost), 0);
    grandTotal += total;
    return {
      entity: one<{ name: string }>(doc.branches)?.name ?? "—",
      supplier: one<{ name: string }>(doc.suppliers)?.name ?? "—",
      reference: doc.reference,
      invoice: doc.invoice_number ?? "—",
      invoiceDate: doc.invoice_date ?? dayString(doc.created_at),
      type: INWARD_TYPE_LABELS[doc.inward_type] ?? doc.inward_type,
      lines: items.length,
      paidUnits: items.reduce((sum, item) => sum + item.quantity, 0),
      freeUnits: items.reduce((sum, item) => sum + item.free_quantity, 0),
      totalCost: money(total),
    };
  });

  return {
    columns,
    rows,
    summary: [
      summaryCount("Purchases", rows.length),
      ["Total cost", money(grandTotal).toLocaleString("en-US")],
    ],
  };
}

async function supplierReturns({ scope, filters, entityId }: ReportContext): Promise<ReportResult> {
  let query = scope.supabase
    .from("returns")
    .select(
      "reference, type, quantity, reason, resolution_type, status, created_at, approved_at, branches(name), products(name, sku), product_batches(batch_number, suppliers(name)), purchase_orders(po_number), employees!returns_requested_by_fkey(full_name)"
    )
    .eq("type", "supplier")
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (entityId) query = query.eq("branch_id", entityId);
  if (filters.status) query = query.eq("status", filters.status);
  query = applyDateRange(query, "created_at", filters);

  const { data } = await query;

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity" },
    { key: "reference", header: "Reference" },
    { key: "date", header: "Date" },
    { key: "supplier", header: "Supplier", width: 22 },
    { key: "originalPo", header: "Original PO" },
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "batch", header: "Batch" },
    { key: "quantity", header: "Quantity", numeric: true },
    { key: "resolution", header: "Resolution" },
    { key: "reason", header: "Reason", width: 30 },
    { key: "requestedBy", header: "Requested by", width: 20 },
    { key: "status", header: "Status" },
  ];

  const rows: ReportRow[] = (data ?? []).map((record) => {
    const batch = one<{ batch_number: string; suppliers: unknown }>(record.product_batches);
    const product = one<{ name: string; sku: string }>(record.products);
    return {
      entity: one<{ name: string }>(record.branches)?.name ?? "—",
      reference: record.reference,
      date: dayString(record.created_at),
      supplier: one<{ name: string }>(batch?.suppliers)?.name ?? "—",
      originalPo: one<{ po_number: string }>(record.purchase_orders)?.po_number ?? "—",
      sku: product?.sku ?? "—",
      product: product?.name ?? "—",
      batch: batch?.batch_number ?? "—",
      quantity: record.quantity,
      resolution: record.resolution_type ?? "—",
      reason: record.reason ?? "—",
      requestedBy: one<{ full_name: string }>(record.employees)?.full_name ?? "—",
      status: record.status,
    };
  });

  const pending = rows.filter((row) => row.status === "pending").length;
  return {
    columns,
    rows,
    summary: [
      summaryCount("Supplier returns", rows.length),
      summaryCount("Pending", pending),
      summaryCount("Units returned", rows.reduce((sum, row) => sum + Number(row.quantity), 0)),
    ],
  };
}

// --- Sales reports --------------------------------------------------------

type SaleRow = {
  invoice_number: string;
  sold_at: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string;
  status: string;
  branch_id: string;
  branches: { name: string } | null;
  employees: { full_name: string } | null;
};

async function loadSales(
  { scope, filters, entityId }: ReportContext,
  options?: { includeReversed?: boolean }
): Promise<SaleRow[]> {
  let query = scope.supabase
    .from("sales")
    .select(
      "invoice_number, sold_at, subtotal, discount, total, payment_method, status, branch_id, branches(name), employees!sales_cashier_id_fkey(full_name)"
    )
    .order("sold_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (entityId) query = query.eq("branch_id", entityId);
  if (filters.employee) query = query.eq("cashier_id", filters.employee);
  if (filters.status) query = query.eq("status", filters.status);
  else if (!options?.includeReversed) query = query.neq("status", "reversed");
  query = applyDateRange(query, "sold_at", filters);

  const { data } = await query;
  return (data ?? []) as unknown as SaleRow[];
}

async function dailySales(ctx: ReportContext): Promise<ReportResult> {
  const sales = await loadSales(ctx);

  const byDay = new Map<string, { count: number; subtotal: number; discount: number; total: number }>();
  for (const sale of sales) {
    const day = dayString(sale.sold_at);
    const bucket = byDay.get(day) ?? { count: 0, subtotal: 0, discount: 0, total: 0 };
    bucket.count += 1;
    bucket.subtotal += Number(sale.subtotal);
    bucket.discount += Number(sale.discount);
    bucket.total += Number(sale.total);
    byDay.set(day, bucket);
  }

  const columns: ReportColumn[] = [
    { key: "date", header: "Date" },
    { key: "transactions", header: "Transactions", numeric: true },
    { key: "subtotal", header: "Gross", numeric: true, currency: true },
    { key: "discount", header: "Discount", numeric: true, currency: true },
    { key: "revenue", header: "Net revenue", numeric: true, currency: true },
  ];

  const rows: ReportRow[] = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, bucket]) => ({
      date,
      transactions: bucket.count,
      subtotal: money(bucket.subtotal),
      discount: money(bucket.discount),
      revenue: money(bucket.total),
    }));

  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  return {
    columns,
    rows,
    summary: [
      summaryCount("Days", rows.length),
      summaryCount("Transactions", sales.length),
      ["Net revenue", money(revenue).toLocaleString("en-US")],
    ],
  };
}

async function dailyRevenue(ctx: ReportContext): Promise<ReportResult> {
  const sales = await loadSales(ctx);
  const methods = [...new Set(sales.map((sale) => sale.payment_method))].sort();

  const byDay = new Map<string, Map<string, number>>();
  for (const sale of sales) {
    const day = dayString(sale.sold_at);
    const bucket = byDay.get(day) ?? new Map<string, number>();
    bucket.set(sale.payment_method, (bucket.get(sale.payment_method) ?? 0) + Number(sale.total));
    byDay.set(day, bucket);
  }

  const columns: ReportColumn[] = [
    { key: "date", header: "Date" },
    ...methods.map((method) => ({ key: method, header: method, numeric: true, currency: true })),
    { key: "total", header: "Total", numeric: true, currency: true },
  ];

  const rows: ReportRow[] = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, bucket]) => {
      const row: ReportRow = { date };
      let total = 0;
      for (const method of methods) {
        const value = bucket.get(method) ?? 0;
        row[method] = money(value);
        total += value;
      }
      row.total = money(total);
      return row;
    });

  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  return {
    columns,
    rows,
    summary: [summaryCount("Days", rows.length), ["Revenue", money(revenue).toLocaleString("en-US")]],
  };
}

type SaleItemRow = {
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  product_id: string;
  products: { name: string; sku: string; buy_price: number } | null;
  sales: { sold_at: string; status: string; branch_id: string; cashier_id: string | null } | null;
};

async function loadSaleItems({ scope, filters, entityId }: ReportContext): Promise<SaleItemRow[]> {
  let query = scope.supabase
    .from("sale_items")
    .select(
      "quantity, unit_price, discount, line_total, product_id, products(name, sku), sales!inner(sold_at, status, branch_id, cashier_id)"
    )
    .limit(ROW_LIMIT);

  if (filters.product) query = query.eq("product_id", filters.product);

  // PostgREST cannot embed the cost view, so buy_price is merged in by
  // product_id. Empty for a caller without view_purchase_cost, which zeroes
  // cost of goods sold rather than leaking it.
  const [{ data }, costs] = await Promise.all([query, productCostMap(scope.supabase, entityId)]);
  const withCost = ((data ?? []) as unknown as Array<Omit<SaleItemRow, "products"> & { products: { name: string; sku: string } | null }>).map(
    (item) => ({
      ...item,
      products: item.products
        ? { ...item.products, buy_price: costs.get(item.product_id) ?? 0 }
        : null,
    })
  );
  return (withCost as unknown as SaleItemRow[]).filter((item) => {
    const sale = item.sales;
    if (!sale) return false;
    if (sale.status === "reversed") return false;
    if (entityId && sale.branch_id !== entityId) return false;
    if (filters.employee && sale.cashier_id !== filters.employee) return false;
    const day = dayString(sale.sold_at);
    if (filters.dateFrom && day < filters.dateFrom) return false;
    if (filters.dateTo && day > filters.dateTo) return false;
    return true;
  });
}

async function productSales(ctx: ReportContext): Promise<ReportResult> {
  const items = await loadSaleItems(ctx);

  const byProduct = new Map<string, { sku: string; name: string; quantity: number; revenue: number; discount: number }>();
  for (const item of items) {
    const key = item.product_id;
    const bucket =
      byProduct.get(key) ??
      { sku: item.products?.sku ?? "—", name: item.products?.name ?? "—", quantity: 0, revenue: 0, discount: 0 };
    bucket.quantity += item.quantity;
    bucket.revenue += Number(item.line_total);
    bucket.discount += Number(item.discount);
    byProduct.set(key, bucket);
  }

  const columns: ReportColumn[] = [
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "quantity", header: "Quantity sold", numeric: true },
    { key: "discount", header: "Discount", numeric: true, currency: true },
    { key: "revenue", header: "Revenue", numeric: true, currency: true },
  ];

  const rows: ReportRow[] = [...byProduct.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map((bucket) => ({
      sku: bucket.sku,
      product: bucket.name,
      quantity: bucket.quantity,
      discount: money(bucket.discount),
      revenue: money(bucket.revenue),
    }));

  return {
    columns,
    rows,
    summary: [
      summaryCount("Products sold", rows.length),
      summaryCount("Units", rows.reduce((sum, row) => sum + Number(row.quantity), 0)),
      ["Revenue", money(rows.reduce((sum, row) => sum + Number(row.revenue), 0)).toLocaleString("en-US")],
    ],
  };
}

async function employeeSales(ctx: ReportContext): Promise<ReportResult> {
  const sales = await loadSales(ctx);

  const byEmployee = new Map<string, { count: number; discount: number; revenue: number }>();
  for (const sale of sales) {
    const name = sale.employees?.full_name ?? "Unattributed";
    const bucket = byEmployee.get(name) ?? { count: 0, discount: 0, revenue: 0 };
    bucket.count += 1;
    bucket.discount += Number(sale.discount);
    bucket.revenue += Number(sale.total);
    byEmployee.set(name, bucket);
  }

  const columns: ReportColumn[] = [
    { key: "employee", header: "Employee", width: 26 },
    { key: "transactions", header: "Transactions", numeric: true },
    { key: "discount", header: "Discount given", numeric: true, currency: true },
    { key: "revenue", header: "Revenue", numeric: true, currency: true },
    { key: "average", header: "Average sale", numeric: true, currency: true },
  ];

  const rows: ReportRow[] = [...byEmployee.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([employee, bucket]) => ({
      employee,
      transactions: bucket.count,
      discount: money(bucket.discount),
      revenue: money(bucket.revenue),
      average: money(bucket.count > 0 ? bucket.revenue / bucket.count : 0),
    }));

  return {
    columns,
    rows,
    summary: [
      summaryCount("Employees", rows.length),
      summaryCount("Transactions", sales.length),
      ["Revenue", money(sales.reduce((sum, sale) => sum + Number(sale.total), 0)).toLocaleString("en-US")],
    ],
  };
}

async function entitySales(ctx: ReportContext): Promise<ReportResult> {
  // Deliberately unscoped by active entity: the point of this report is the
  // comparison. RLS still limits it to entities the user may read.
  const sales = await loadSales({ ...ctx, entityId: null });

  const byEntity = new Map<string, { count: number; discount: number; revenue: number }>();
  for (const sale of sales) {
    const name = sale.branches?.name ?? "Unassigned";
    const bucket = byEntity.get(name) ?? { count: 0, discount: 0, revenue: 0 };
    bucket.count += 1;
    bucket.discount += Number(sale.discount);
    bucket.revenue += Number(sale.total);
    byEntity.set(name, bucket);
  }

  const columns: ReportColumn[] = [
    { key: "entity", header: "Entity", width: 26 },
    { key: "transactions", header: "Transactions", numeric: true },
    { key: "discount", header: "Discount", numeric: true, currency: true },
    { key: "revenue", header: "Revenue", numeric: true, currency: true },
    { key: "share", header: "Share of revenue %", numeric: true },
  ];

  const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const rows: ReportRow[] = [...byEntity.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([entity, bucket]) => ({
      entity,
      transactions: bucket.count,
      discount: money(bucket.discount),
      revenue: money(bucket.revenue),
      share: money(totalRevenue > 0 ? (bucket.revenue / totalRevenue) * 100 : 0),
    }));

  return {
    columns,
    rows,
    summary: [
      summaryCount("Entities", rows.length),
      ["Combined revenue", money(totalRevenue).toLocaleString("en-US")],
      ["Best performer", rows[0]?.entity != null ? String(rows[0].entity) : "—"],
    ],
  };
}

async function grossProfit(ctx: ReportContext): Promise<ReportResult> {
  const items = await loadSaleItems(ctx);

  const byProduct = new Map<
    string,
    { sku: string; name: string; quantity: number; revenue: number; cost: number }
  >();
  for (const item of items) {
    const key = item.product_id;
    const bucket =
      byProduct.get(key) ??
      { sku: item.products?.sku ?? "—", name: item.products?.name ?? "—", quantity: 0, revenue: 0, cost: 0 };
    bucket.quantity += item.quantity;
    bucket.revenue += Number(item.line_total);
    // Configured purchase cost is the costing basis; batch-level weighted cost
    // is a Phase 2 refinement.
    bucket.cost += Number(item.products?.buy_price ?? 0) * item.quantity;
    byProduct.set(key, bucket);
  }

  const columns: ReportColumn[] = [
    { key: "sku", header: "SKU" },
    { key: "product", header: "Product", width: 28 },
    { key: "quantity", header: "Quantity", numeric: true },
    { key: "revenue", header: "Revenue", numeric: true, currency: true },
    { key: "cost", header: "Cost of goods", numeric: true, currency: true },
    { key: "profit", header: "Gross profit", numeric: true, currency: true },
    { key: "marginPercent", header: "Margin %", numeric: true },
  ];

  let totalRevenue = 0;
  let totalCost = 0;
  const rows: ReportRow[] = [...byProduct.values()]
    .map((bucket) => {
      totalRevenue += bucket.revenue;
      totalCost += bucket.cost;
      return {
        sku: bucket.sku,
        product: bucket.name,
        quantity: bucket.quantity,
        revenue: money(bucket.revenue),
        cost: money(bucket.cost),
        profit: money(bucket.revenue - bucket.cost),
        marginPercent: money(effectiveMarginPercent(bucket.cost, bucket.revenue)),
      };
    })
    .sort((a, b) => Number(b.profit) - Number(a.profit));

  return {
    columns,
    rows,
    summary: [
      ["Revenue", money(totalRevenue).toLocaleString("en-US")],
      ["Cost of goods", money(totalCost).toLocaleString("en-US")],
      ["Gross profit", money(totalRevenue - totalCost).toLocaleString("en-US")],
      ["Margin", `${money(effectiveMarginPercent(totalCost, totalRevenue))}%`],
    ],
  };
}

async function discountReport(ctx: ReportContext): Promise<ReportResult> {
  const sales = (await loadSales(ctx)).filter((sale) => Number(sale.discount) > 0);

  const columns: ReportColumn[] = [
    { key: "date", header: "Date" },
    { key: "entity", header: "Entity" },
    { key: "invoice", header: "Invoice" },
    { key: "employee", header: "Employee", width: 24 },
    { key: "gross", header: "Gross", numeric: true, currency: true },
    { key: "discount", header: "Discount", numeric: true, currency: true },
    { key: "discountPercent", header: "Discount %", numeric: true },
    { key: "net", header: "Net", numeric: true, currency: true },
  ];

  const rows: ReportRow[] = sales.map((sale) => {
    const gross = Number(sale.subtotal);
    const discount = Number(sale.discount);
    return {
      date: dayString(sale.sold_at),
      entity: sale.branches?.name ?? "—",
      invoice: sale.invoice_number,
      employee: sale.employees?.full_name ?? "—",
      gross: money(gross),
      discount: money(discount),
      discountPercent: money(gross > 0 ? (discount / gross) * 100 : 0),
      net: money(Number(sale.total)),
    };
  });

  const totalDiscount = sales.reduce((sum, sale) => sum + Number(sale.discount), 0);
  const totalGross = sales.reduce((sum, sale) => sum + Number(sale.subtotal), 0);
  return {
    columns,
    rows,
    summary: [
      summaryCount("Discounted sales", rows.length),
      ["Total discount", money(totalDiscount).toLocaleString("en-US")],
      ["Average discount", `${money(totalGross > 0 ? (totalDiscount / totalGross) * 100 : 0)}%`],
    ],
  };
}

async function consolidated(ctx: ReportContext): Promise<ReportResult> {
  const { scope, filters } = ctx;
  const { data: entities } = await scope.supabase
    .from("branches")
    .select("id, name, code, is_active")
    .order("name");

  const sales = await loadSales({ ...ctx, entityId: null });
  const items = await loadSaleItems({ ...ctx, entityId: null, filters: { ...filters, product: undefined } });

  const { data: batches } = await scope.supabase
    .from("product_batches")
    .select("id, branch_id, product_id, quantity_available")
    .eq("status", "active");

  const { data: products } = await scope.supabase
    .from("products")
    .select("id, branch_id, reorder_level")
    .eq("status", "active");

  // Consolidated view spans every entity, so cost is fetched unscoped.
  const batchCosts = await batchCostMapAllEntities(scope.supabase);

  const stockValueByEntity = new Map<string, number>();
  const availableByProduct = new Map<string, number>();
  for (const batch of batches ?? []) {
    const available = Math.max(0, batch.quantity_available);
    stockValueByEntity.set(
      batch.branch_id,
      (stockValueByEntity.get(batch.branch_id) ?? 0) + available * (batchCosts.get(batch.id) ?? 0)
    );
    availableByProduct.set(
      batch.product_id,
      (availableByProduct.get(batch.product_id) ?? 0) + available
    );
  }

  const lowStockByEntity = new Map<string, number>();
  for (const product of products ?? []) {
    const available = availableByProduct.get(product.id) ?? 0;
    if (available <= product.reorder_level) {
      lowStockByEntity.set(product.branch_id, (lowStockByEntity.get(product.branch_id) ?? 0) + 1);
    }
  }

  const salesByEntity = new Map<string, { count: number; revenue: number; discount: number }>();
  for (const sale of sales) {
    const bucket = salesByEntity.get(sale.branch_id) ?? { count: 0, revenue: 0, discount: 0 };
    bucket.count += 1;
    bucket.revenue += Number(sale.total);
    bucket.discount += Number(sale.discount);
    salesByEntity.set(sale.branch_id, bucket);
  }

  const costByEntity = new Map<string, number>();
  for (const item of items) {
    const branch = item.sales?.branch_id;
    if (!branch) continue;
    costByEntity.set(
      branch,
      (costByEntity.get(branch) ?? 0) + Number(item.products?.buy_price ?? 0) * item.quantity
    );
  }

  const columns: ReportColumn[] = [
    { key: "code", header: "Code" },
    { key: "entity", header: "Entity", width: 26 },
    { key: "status", header: "Status" },
    { key: "transactions", header: "Transactions", numeric: true },
    { key: "revenue", header: "Revenue", numeric: true, currency: true },
    { key: "discount", header: "Discount", numeric: true, currency: true },
    { key: "cost", header: "Cost of goods", numeric: true, currency: true },
    { key: "profit", header: "Gross profit", numeric: true, currency: true },
    { key: "stockValue", header: "Stock value", numeric: true, currency: true },
    { key: "lowStock", header: "Low-stock products", numeric: true },
  ];

  let totalRevenue = 0;
  let totalProfit = 0;
  const rows: ReportRow[] = (entities ?? []).map((entity) => {
    const bucket = salesByEntity.get(entity.id) ?? { count: 0, revenue: 0, discount: 0 };
    const cost = costByEntity.get(entity.id) ?? 0;
    totalRevenue += bucket.revenue;
    totalProfit += bucket.revenue - cost;
    return {
      code: entity.code,
      entity: entity.name,
      status: entity.is_active ? "Active" : "Inactive",
      transactions: bucket.count,
      revenue: money(bucket.revenue),
      discount: money(bucket.discount),
      cost: money(cost),
      profit: money(bucket.revenue - cost),
      stockValue: money(stockValueByEntity.get(entity.id) ?? 0),
      lowStock: lowStockByEntity.get(entity.id) ?? 0,
    };
  });

  const best = [...rows].sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];
  return {
    columns,
    rows,
    summary: [
      summaryCount("Entities", rows.length),
      ["Combined revenue", money(totalRevenue).toLocaleString("en-US")],
      ["Combined gross profit", money(totalProfit).toLocaleString("en-US")],
      ["Best performer", best?.entity != null ? String(best.entity) : "—"],
    ],
  };
}
