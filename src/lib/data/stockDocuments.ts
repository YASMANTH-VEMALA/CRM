import "server-only";
import { getScope } from "./scope";
import type { StockInwardType } from "@/lib/types";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

import { INWARD_TYPE_OPTIONS } from "@/lib/stock-vocabulary";

export type StockDocumentLine = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: number;
  freeQuantity: number;
  unitCost: number | null;
  totalCost: number | null;
};

export type StockInwardRow = {
  id: string;
  reference: string;
  inwardType: StockInwardType;
  inwardTypeLabel: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierReturnReference: string | null;
  documentUrl: string | null;
  notes: string | null;
  status: "draft" | "confirmed" | "cancelled";
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  entityName: string | null;
  lines: StockDocumentLine[];
  totalQuantity: number;
  totalFree: number;
  totalCost: number | null;
};

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
  unit: string | null;
  buyPrice: number | null;
};

export type StockInwardData = {
  documents: StockInwardRow[];
  products: ProductOption[];
  suppliers: { id: string; name: string; supplierType: string }[];
  openSupplierReturns: { id: string; reference: string; productName: string; quantity: number }[];
  stats: Array<[string, string, string]>;
  canCreate: boolean;
  canViewCost: boolean;
  entityName: string;
};

/** Products available for line entry, with cost pre-fill when permitted. */
async function loadProductOptions(
  supabase: Awaited<ReturnType<typeof getScope>>["supabase"],
  entityId: string | null,
  canViewCost: boolean
): Promise<ProductOption[]> {
  let query = supabase
    .from("products")
    .select("id, sku, name, unit, buy_price")
    .eq("status", "active")
    .order("name");
  if (entityId) query = query.eq("branch_id", entityId);

  const { data } = await query;
  return (data ?? []).map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    buyPrice: canViewCost ? Number(product.buy_price) : null,
  }));
}

export async function getStockInwardData(): Promise<StockInwardData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let docQuery = supabase
    .from("stock_inwards")
    .select(
      "*, branches(name), suppliers(name), returns(reference), created:employees!stock_inwards_created_by_fkey(full_name), confirmed:employees!stock_inwards_confirmed_by_fkey(full_name), stock_inward_items(id, product_id, batch_number, expiry_date, quantity, free_quantity, unit_cost, products(name, sku))"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (entityId) docQuery = docQuery.eq("branch_id", entityId);

  let supplierQuery = supabase
    .from("suppliers")
    .select("id, name, supplier_type")
    .eq("is_active", true)
    .order("name");
  if (entityId) supplierQuery = supplierQuery.eq("branch_id", entityId);

  let returnQuery = supabase
    .from("returns")
    .select("id, reference, quantity, products(name)")
    .eq("type", "supplier")
    .eq("resolution_type", "replacement")
    .order("created_at", { ascending: false })
    .limit(50);
  if (entityId) returnQuery = returnQuery.eq("branch_id", entityId);

  const [{ data: documents }, { data: suppliers }, { data: returns }, products] = await Promise.all([
    docQuery,
    supplierQuery,
    returnQuery,
    loadProductOptions(supabase, entityId, scope.canViewCost),
  ]);

  const rows: StockInwardRow[] = (documents ?? []).map((doc) => {
    const rawLines = (doc.stock_inward_items ?? []) as Array<{
      id: string;
      product_id: string;
      batch_number: string;
      expiry_date: string | null;
      quantity: number;
      free_quantity: number;
      unit_cost: number;
      products: unknown;
    }>;

    const lines: StockDocumentLine[] = rawLines.map((line) => {
      const product = one<{ name: string; sku: string }>(line.products);
      const unitCost = Number(line.unit_cost);
      return {
        id: line.id,
        productId: line.product_id,
        productName: product?.name ?? "—",
        sku: product?.sku ?? "—",
        batchNumber: line.batch_number,
        expiryDate: line.expiry_date,
        quantity: line.quantity,
        freeQuantity: line.free_quantity,
        unitCost: scope.canViewCost ? unitCost : null,
        totalCost: scope.canViewCost ? unitCost * line.quantity : null,
      };
    });

    return {
      id: doc.id,
      reference: doc.reference,
      inwardType: doc.inward_type,
      inwardTypeLabel:
        INWARD_TYPE_OPTIONS.find((option) => option.value === doc.inward_type)?.label ?? doc.inward_type,
      supplierName: one<{ name: string }>(doc.suppliers)?.name ?? null,
      invoiceNumber: doc.invoice_number,
      invoiceDate: doc.invoice_date,
      supplierReturnReference: one<{ reference: string }>(doc.returns)?.reference ?? null,
      documentUrl: doc.document_url,
      notes: doc.notes,
      status: doc.status,
      createdBy: one<{ full_name: string }>(doc.created)?.full_name ?? null,
      confirmedBy: one<{ full_name: string }>(doc.confirmed)?.full_name ?? null,
      confirmedAt: doc.confirmed_at,
      createdAt: doc.created_at,
      entityName: one<{ name: string }>(doc.branches)?.name ?? null,
      lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalFree: lines.reduce((sum, line) => sum + line.freeQuantity, 0),
      totalCost: scope.canViewCost
        ? lines.reduce((sum, line) => sum + (line.totalCost ?? 0), 0)
        : null,
    };
  });

  const drafts = rows.filter((row) => row.status === "draft").length;
  const confirmed = rows.filter((row) => row.status === "confirmed").length;
  const freeUnits = rows
    .filter((row) => row.status === "confirmed")
    .reduce((sum, row) => sum + row.totalFree, 0);

  const stats: Array<[string, string, string]> = [
    ["Documents", String(rows.length), scope.entityName],
    ["Drafts", String(drafts), "Awaiting confirmation"],
    ["Confirmed", String(confirmed), "Stock received"],
    ["Free units", String(freeUnits), "FOC and samples"],
  ];

  return {
    documents: rows,
    products,
    suppliers: (suppliers ?? []).map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      supplierType: supplier.supplier_type,
    })),
    openSupplierReturns: (returns ?? []).map((record) => ({
      id: record.id,
      reference: record.reference,
      productName: one<{ name: string }>(record.products)?.name ?? "—",
      quantity: record.quantity,
    })),
    stats,
    canCreate: scope.employee?.permissions.includes("create_stock_inward") ?? false,
    canViewCost: scope.canViewCost,
    entityName: scope.entityName,
  };
}

export type OpeningStockRow = {
  id: string;
  reference: string;
  openingDate: string;
  notes: string | null;
  status: "draft" | "confirmed" | "cancelled";
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  entityName: string | null;
  lines: Array<StockDocumentLine & { sellPrice: number | null }>;
  totalQuantity: number;
  totalValue: number | null;
};

export type OpeningStockData = {
  entries: OpeningStockRow[];
  products: ProductOption[];
  stats: Array<[string, string, string]>;
  canCreate: boolean;
  canViewCost: boolean;
  entityName: string;
};

export async function getOpeningStockData(): Promise<OpeningStockData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let entryQuery = supabase
    .from("opening_stock_entries")
    .select(
      "*, branches(name), created:employees!opening_stock_entries_created_by_fkey(full_name), confirmed:employees!opening_stock_entries_confirmed_by_fkey(full_name), opening_stock_items(id, product_id, batch_number, expiry_date, quantity, unit_cost, sell_price, products(name, sku))"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (entityId) entryQuery = entryQuery.eq("branch_id", entityId);

  const [{ data: entries }, products] = await Promise.all([
    entryQuery,
    loadProductOptions(supabase, entityId, scope.canViewCost),
  ]);

  const rows: OpeningStockRow[] = (entries ?? []).map((entry) => {
    const rawLines = (entry.opening_stock_items ?? []) as Array<{
      id: string;
      product_id: string;
      batch_number: string;
      expiry_date: string | null;
      quantity: number;
      unit_cost: number;
      sell_price: number | null;
      products: unknown;
    }>;

    const lines = rawLines.map((line) => {
      const product = one<{ name: string; sku: string }>(line.products);
      const unitCost = Number(line.unit_cost);
      return {
        id: line.id,
        productId: line.product_id,
        productName: product?.name ?? "—",
        sku: product?.sku ?? "—",
        batchNumber: line.batch_number,
        expiryDate: line.expiry_date,
        quantity: line.quantity,
        freeQuantity: 0,
        unitCost: scope.canViewCost ? unitCost : null,
        totalCost: scope.canViewCost ? unitCost * line.quantity : null,
        sellPrice: line.sell_price == null ? null : Number(line.sell_price),
      };
    });

    return {
      id: entry.id,
      reference: entry.reference,
      openingDate: entry.opening_date,
      notes: entry.notes,
      status: entry.status,
      createdBy: one<{ full_name: string }>(entry.created)?.full_name ?? null,
      confirmedBy: one<{ full_name: string }>(entry.confirmed)?.full_name ?? null,
      confirmedAt: entry.confirmed_at,
      entityName: one<{ name: string }>(entry.branches)?.name ?? null,
      lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalValue: scope.canViewCost
        ? lines.reduce((sum, line) => sum + (line.totalCost ?? 0), 0)
        : null,
    };
  });

  const drafts = rows.filter((row) => row.status === "draft").length;
  const confirmed = rows.filter((row) => row.status === "confirmed").length;

  const stats: Array<[string, string, string]> = [
    ["Entries", String(rows.length), scope.entityName],
    ["Drafts", String(drafts), "Editable"],
    ["Confirmed", String(confirmed), "Locked"],
    ["Units", String(rows.reduce((sum, row) => sum + row.totalQuantity, 0)), "Opening quantity"],
  ];

  return {
    entries: rows,
    products,
    stats,
    canCreate: scope.employee?.permissions.includes("create_stock_inward") ?? false,
    canViewCost: scope.canViewCost,
    entityName: scope.entityName,
  };
}
