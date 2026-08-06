import "server-only";
import { getScope } from "./scope";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

export type POSBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string | null;
  quantityAvailable: number;
};

export type POSProduct = {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  sellPrice: number;
  unit: string | null;
  barcode: string | null;
  category: string | null;
  /** Highest discount value allowed on one unit, derived server-side. */
  maxDiscountPercent: number;
  totalAvailable: number;
  batches: POSBatch[];
};

export type POSCustomer = { id: string; name: string; loyaltyPoints: number };

export type POSData = {
  products: POSProduct[];
  customers: POSCustomer[];
  entityName: string;
  currency: string;
  /** The signed-in user's own discount ceiling, for client-side pre-checks. */
  maxDiscountPercent: number;
  canApplyDiscount: boolean;
  canSell: boolean;
  preventExpiredSales: boolean;
  cashierName: string;
};

/**
 * POS payload. Purchase cost is deliberately absent from every field here:
 * dispensing staff see product, availability, selling price and their
 * permitted discount, and nothing else.
 */
export async function getPOSData(): Promise<POSData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let productQuery = supabase
    .from("products")
    .select(
      "id, sku, name, generic_name, sell_price, unit, barcode, max_discount_percent, categories(name), product_batches(id, batch_number, expiry_date, quantity_available, status, branch_id)"
    )
    .eq("status", "active")
    .order("name");
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  let customerQuery = supabase.from("customers").select("id, name, loyalty_points").order("name");
  if (entityId) customerQuery = customerQuery.eq("branch_id", entityId);

  const [{ data: products }, { data: customers }, { data: toggles }] = await Promise.all([
    productQuery,
    customerQuery,
    supabase.from("settings").select("value, branch_id").eq("key", "toggles"),
  ]);

  const entityToggles = (toggles ?? []).find((row) => row.branch_id === entityId)?.value as
    | Record<string, boolean>
    | undefined;
  const globalToggles = (toggles ?? []).find((row) => row.branch_id === null)?.value as
    | Record<string, boolean>
    | undefined;
  const preventExpiredSales = Boolean(
    entityToggles?.prevent_expired_sales ?? globalToggles?.prevent_expired_sales ?? false
  );
  const today = new Date().toISOString().slice(0, 10);

  const posProducts: POSProduct[] = (products ?? []).map((product) => {
    const rawBatches = (product.product_batches ?? []) as Array<{
      id: string;
      batch_number: string;
      expiry_date: string | null;
      quantity_available: number;
      status: string;
      branch_id: string;
    }>;

    const batches = rawBatches
      .filter((batch) => {
        if (batch.status !== "active" || batch.quantity_available <= 0) return false;
        if (entityId && batch.branch_id !== entityId) return false;
        if (preventExpiredSales && batch.expiry_date && batch.expiry_date < today) return false;
        return true;
      })
      // FEFO: earliest expiry first, so the default allocation sells the
      // stock that would otherwise expire on the shelf.
      .sort((a, b) =>
        (a.expiry_date ?? "9999-12-31").localeCompare(b.expiry_date ?? "9999-12-31")
      );

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      genericName: product.generic_name,
      sellPrice: Number(product.sell_price),
      unit: product.unit,
      barcode: product.barcode,
      category: one<{ name: string }>(product.categories)?.name ?? null,
      maxDiscountPercent: Number(product.max_discount_percent),
      totalAvailable: batches.reduce((sum, batch) => sum + batch.quantity_available, 0),
      batches: batches.map((batch) => ({
        id: batch.id,
        batchNumber: batch.batch_number,
        expiryDate: batch.expiry_date,
        quantityAvailable: batch.quantity_available,
      })),
    };
  });

  return {
    products: posProducts,
    customers: (customers ?? []).map((customer) => ({
      id: customer.id,
      name: customer.name,
      loyaltyPoints: customer.loyalty_points,
    })),
    entityName: scope.entityName,
    currency: scope.currency,
    maxDiscountPercent: scope.employee?.maxDiscountPercent ?? 0,
    canApplyDiscount: scope.employee?.permissions.includes("apply_discount") ?? false,
    canSell: scope.employee?.permissions.includes("create_sales") ?? false,
    preventExpiredSales,
    cashierName: scope.employee?.full_name ?? "—",
  };
}

export type SaleLine = {
  productName: string;
  sku: string;
  batchNumber: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
};

export type SaleRecord = {
  id: string;
  invoiceNumber: string;
  customerName: string | null;
  cashierName: string | null;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  total: number;
  status: "completed" | "returned" | "reversed";
  reversalReason: string | null;
  soldAt: string;
  entityName: string | null;
  lines: SaleLine[];
};

export type SalesHistoryData = {
  sales: SaleRecord[];
  stats: Array<[string, string, string]>;
  canCancel: boolean;
  canExport: boolean;
  entityName: string;
  currency: string;
};

export async function getSalesHistoryData(): Promise<SalesHistoryData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let query = supabase
    .from("sales")
    .select(
      "*, branches(name), customers(name), employees!sales_cashier_id_fkey(full_name), sale_items(quantity, unit_price, discount, line_total, products(name, sku), product_batches(batch_number))"
    )
    .order("sold_at", { ascending: false })
    .limit(200);
  if (entityId) query = query.eq("branch_id", entityId);

  const { data } = await query;
  const allSales = data ?? [];

  const sales: SaleRecord[] = allSales.map((sale) => {
    const rawLines = (sale.sale_items ?? []) as Array<{
      quantity: number;
      unit_price: number;
      discount: number;
      line_total: number;
      products: unknown;
      product_batches: unknown;
    }>;

    return {
      id: sale.id,
      invoiceNumber: sale.invoice_number,
      customerName: one<{ name: string }>(sale.customers)?.name ?? null,
      cashierName: one<{ full_name: string }>(sale.employees)?.full_name ?? null,
      paymentMethod: sale.payment_method,
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      total: Number(sale.total),
      status: sale.status,
      reversalReason: sale.reversal_reason,
      soldAt: sale.sold_at,
      entityName: one<{ name: string }>(sale.branches)?.name ?? null,
      lines: rawLines.map((line) => {
        const product = one<{ name: string; sku: string }>(line.products);
        return {
          productName: product?.name ?? "—",
          sku: product?.sku ?? "—",
          batchNumber: one<{ batch_number: string }>(line.product_batches)?.batch_number ?? null,
          quantity: line.quantity,
          unitPrice: Number(line.unit_price),
          discount: Number(line.discount),
          lineTotal: Number(line.line_total),
        };
      }),
    };
  });

  const completed = sales.filter((sale) => sale.status === "completed");
  const reversed = sales.filter((sale) => sale.status === "reversed");
  const revenue = completed.reduce((sum, sale) => sum + sale.total, 0);
  const discountTotal = completed.reduce((sum, sale) => sum + sale.discount, 0);

  const stats: Array<[string, string, string]> = [
    ["Transactions", String(sales.length), scope.entityName],
    ["Completed", String(completed.length), `${reversed.length} reversed`],
    ["Revenue", Math.round(revenue).toLocaleString("en-US"), scope.currency],
    ["Discount given", Math.round(discountTotal).toLocaleString("en-US"), scope.currency],
  ];

  return {
    sales,
    stats,
    canCancel: scope.employee?.permissions.includes("cancel_sales") ?? false,
    canExport: scope.canExport,
    entityName: scope.entityName,
    currency: scope.currency,
  };
}
