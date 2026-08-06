import "server-only";
import { getScope } from "./scope";
import type { StockOutType } from "@/lib/types";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

import { STOCK_OUT_TYPES } from "@/lib/stock-vocabulary";

export type StockOutRow = {
  id: string;
  reference: string;
  type: StockOutType;
  typeLabel: string;
  productId: string | null;
  productName: string;
  sku: string;
  batchId: string | null;
  batchNumber: string | null;
  batchExpiry: string | null;
  quantity: number;
  reason: string | null;
  resolutionType: string | null;
  refundMethod: string | null;
  consumedByName: string | null;
  evidenceUrl: string | null;
  expiryDate: string | null;
  originalSaleInvoice: string | null;
  originalPoNumber: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  status: string;
  createdAt: string;
  entityName: string | null;
};

export type BatchOption = {
  id: string;
  productId: string;
  batchNumber: string;
  expiryDate: string | null;
  quantityAvailable: number;
};

export type ReturnsData = {
  records: StockOutRow[];
  products: { id: string; name: string; sku: string }[];
  batches: BatchOption[];
  employees: { id: string; name: string }[];
  sales: { id: string; invoiceNumber: string }[];
  purchaseOrders: { id: string; poNumber: string }[];
  stats: Array<[string, string, string]>;
  canCreate: boolean;
  canApprove: boolean;
  entityName: string;
};

export async function getReturnsData(): Promise<ReturnsData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  // Filters are applied inline per query; a shared generic wrapper makes
  // PostgREST's builder types recurse past their depth limit.
  const anyEntity = entityId ?? "";

  let recordQuery = supabase
    .from("returns")
    .select(
      "*, branches(name), products(name, sku), product_batches(batch_number, expiry_date), sales(invoice_number), purchase_orders(po_number), requester:employees!returns_requested_by_fkey(full_name), approver:employees!returns_approved_by_fkey(full_name), consumer:employees!returns_consumed_by_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (entityId) recordQuery = recordQuery.eq("branch_id", anyEntity);

  let productQuery = supabase
    .from("products")
    .select("id, name, sku")
    .eq("status", "active")
    .order("name");
  if (entityId) productQuery = productQuery.eq("branch_id", anyEntity);

  let batchQuery = supabase
    .from("product_batches")
    .select("id, product_id, batch_number, expiry_date, quantity_available")
    .eq("status", "active")
    .gt("quantity_available", 0)
    .order("expiry_date", { ascending: true, nullsFirst: false });
  if (entityId) batchQuery = batchQuery.eq("branch_id", anyEntity);

  let employeeQuery = supabase
    .from("employees")
    .select("id, full_name")
    .eq("status", "active")
    .order("full_name");
  if (entityId) employeeQuery = employeeQuery.eq("branch_id", anyEntity);

  let saleQuery = supabase
    .from("sales")
    .select("id, invoice_number")
    .eq("status", "completed")
    .order("sold_at", { ascending: false })
    .limit(100);
  if (entityId) saleQuery = saleQuery.eq("branch_id", anyEntity);

  let poQuery = supabase
    .from("purchase_orders")
    .select("id, po_number")
    .order("created_at", { ascending: false })
    .limit(100);
  if (entityId) poQuery = poQuery.eq("branch_id", anyEntity);

  const [
    { data: records },
    { data: products },
    { data: batches },
    { data: employees },
    { data: sales },
    { data: purchaseOrders },
  ] = await Promise.all([recordQuery, productQuery, batchQuery, employeeQuery, saleQuery, poQuery]);

  const rows: StockOutRow[] = (records ?? []).map((record) => {
    const product = one<{ name: string; sku: string }>(record.products);
    const batch = one<{ batch_number: string; expiry_date: string | null }>(record.product_batches);
    return {
      id: record.id,
      reference: record.reference,
      type: record.type,
      typeLabel: STOCK_OUT_TYPES.find((option) => option.value === record.type)?.label ?? record.type,
      productId: record.product_id,
      productName: product?.name ?? "—",
      sku: product?.sku ?? "—",
      batchId: record.batch_id,
      batchNumber: batch?.batch_number ?? null,
      batchExpiry: batch?.expiry_date ?? null,
      quantity: record.quantity,
      reason: record.reason,
      resolutionType: record.resolution_type,
      refundMethod: record.refund_method,
      consumedByName: one<{ full_name: string }>(record.consumer)?.full_name ?? null,
      evidenceUrl: record.evidence_url,
      expiryDate: record.expiry_date,
      originalSaleInvoice: one<{ invoice_number: string }>(record.sales)?.invoice_number ?? null,
      originalPoNumber: one<{ po_number: string }>(record.purchase_orders)?.po_number ?? null,
      requestedBy: one<{ full_name: string }>(record.requester)?.full_name ?? null,
      approvedBy: one<{ full_name: string }>(record.approver)?.full_name ?? null,
      approvedAt: record.approved_at,
      status: record.status,
      createdAt: record.created_at,
      entityName: one<{ name: string }>(record.branches)?.name ?? null,
    };
  });

  const pending = rows.filter((row) => row.status === "pending").length;
  const approved = rows.filter((row) => row.status === "approved").length;
  const unitsOut = rows
    .filter((row) => row.status === "approved" && row.type !== "customer")
    .reduce((sum, row) => sum + row.quantity, 0);

  const stats: Array<[string, string, string]> = [
    ["Stock-out records", String(rows.length), scope.entityName],
    ["Pending approval", String(pending), "Stock not yet moved"],
    ["Approved", String(approved), "Posted to the ledger"],
    ["Units written out", unitsOut.toLocaleString("en-US"), "Excluding customer returns"],
  ];

  return {
    records: rows,
    products: products ?? [],
    batches: (batches ?? []).map((batch) => ({
      id: batch.id,
      productId: batch.product_id,
      batchNumber: batch.batch_number,
      expiryDate: batch.expiry_date,
      quantityAvailable: batch.quantity_available,
    })),
    employees: (employees ?? []).map((employee) => ({ id: employee.id, name: employee.full_name })),
    sales: (sales ?? []).map((sale) => ({ id: sale.id, invoiceNumber: sale.invoice_number })),
    purchaseOrders: (purchaseOrders ?? []).map((po) => ({ id: po.id, poNumber: po.po_number })),
    stats,
    canCreate: scope.employee?.permissions.includes("create_stock_outward") ?? false,
    canApprove: scope.employee?.permissions.includes("approve_stock_outward") ?? false,
    entityName: scope.entityName,
  };
}
