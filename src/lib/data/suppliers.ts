import "server-only";
import { getScope } from "./scope";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

export type SupplierRow = {
  id: string;
  name: string;
  supplierType: "parent" | "external";
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  isActive: boolean;
  productCount: number;
  /** Confirmed purchase documents and their value (cost-gated). */
  purchaseCount: number;
  purchaseValue: number | null;
  freeGoodsUnits: number;
  replacementCount: number;
  openReturns: number;
  totalReturns: number;
};

export type SupplierHistoryEntry = {
  supplierId: string;
  kind: "purchase" | "free_goods" | "return" | "replacement";
  reference: string;
  date: string;
  detail: string;
  quantity: number;
  value: number | null;
  status: string;
};

export type SuppliersData = {
  suppliers: SupplierRow[];
  history: SupplierHistoryEntry[];
  stats: Array<[string, string, string]>;
  canManage: boolean;
  canViewCost: boolean;
  entityName: string;
  currency: string;
};

export async function getSuppliersData(): Promise<SuppliersData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let supplierQuery = supabase.from("suppliers").select("*").order("name");
  if (entityId) supplierQuery = supplierQuery.eq("branch_id", entityId);

  let productQuery = supabase.from("products").select("id, supplier_id");
  if (entityId) productQuery = productQuery.eq("branch_id", entityId);

  let inwardQuery = supabase
    .from("stock_inwards")
    .select(
      "id, reference, supplier_id, inward_type, invoice_number, invoice_date, status, created_at, stock_inward_items(quantity, free_quantity, unit_cost)"
    )
    .order("created_at", { ascending: false })
    .limit(400);
  if (entityId) inwardQuery = inwardQuery.eq("branch_id", entityId);

  let returnQuery = supabase
    .from("returns")
    .select(
      "id, reference, quantity, reason, resolution_type, status, created_at, product_batches(supplier_id, batch_number), products(name)"
    )
    .eq("type", "supplier")
    .order("created_at", { ascending: false })
    .limit(400);
  if (entityId) returnQuery = returnQuery.eq("branch_id", entityId);

  const [{ data: suppliers }, { data: products }, { data: inwards }, { data: returns }] =
    await Promise.all([supplierQuery, productQuery, inwardQuery, returnQuery]);

  const productCount = new Map<string, number>();
  for (const product of products ?? []) {
    if (!product.supplier_id) continue;
    productCount.set(product.supplier_id, (productCount.get(product.supplier_id) ?? 0) + 1);
  }

  const purchaseCount = new Map<string, number>();
  const purchaseValue = new Map<string, number>();
  const freeGoods = new Map<string, number>();
  const replacements = new Map<string, number>();
  const history: SupplierHistoryEntry[] = [];

  for (const doc of inwards ?? []) {
    if (!doc.supplier_id || doc.status !== "confirmed") continue;
    const items = (doc.stock_inward_items ?? []) as Array<{
      quantity: number;
      free_quantity: number;
      unit_cost: number;
    }>;
    const paidUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const freeUnits = items.reduce((sum, item) => sum + item.free_quantity, 0);
    const value = items.reduce((sum, item) => sum + item.quantity * Number(item.unit_cost), 0);

    if (doc.inward_type === "purchase_from_parent" || doc.inward_type === "purchase_from_external") {
      purchaseCount.set(doc.supplier_id, (purchaseCount.get(doc.supplier_id) ?? 0) + 1);
      purchaseValue.set(doc.supplier_id, (purchaseValue.get(doc.supplier_id) ?? 0) + value);
      history.push({
        supplierId: doc.supplier_id,
        kind: "purchase",
        reference: doc.reference,
        date: doc.invoice_date ?? doc.created_at.slice(0, 10),
        detail: doc.invoice_number ? `Invoice ${doc.invoice_number}` : "No invoice number",
        quantity: paidUnits,
        value: scope.canViewCost ? value : null,
        status: doc.status,
      });
    }

    if (doc.inward_type === "replacement_in") {
      replacements.set(doc.supplier_id, (replacements.get(doc.supplier_id) ?? 0) + 1);
      history.push({
        supplierId: doc.supplier_id,
        kind: "replacement",
        reference: doc.reference,
        date: doc.invoice_date ?? doc.created_at.slice(0, 10),
        detail: "Replacement received",
        quantity: paidUnits + freeUnits,
        value: scope.canViewCost ? value : null,
        status: doc.status,
      });
    }

    if (freeUnits > 0) {
      freeGoods.set(doc.supplier_id, (freeGoods.get(doc.supplier_id) ?? 0) + freeUnits);
      history.push({
        supplierId: doc.supplier_id,
        kind: "free_goods",
        reference: doc.reference,
        date: doc.invoice_date ?? doc.created_at.slice(0, 10),
        detail: doc.inward_type === "foc_or_sample" ? "Free of charge / sample" : "Free goods on purchase",
        quantity: freeUnits,
        value: null,
        status: doc.status,
      });
    }
  }

  const openReturns = new Map<string, number>();
  const totalReturns = new Map<string, number>();
  for (const record of returns ?? []) {
    const supplierId = one<{ supplier_id: string | null }>(record.product_batches)?.supplier_id;
    if (!supplierId) continue;
    totalReturns.set(supplierId, (totalReturns.get(supplierId) ?? 0) + 1);
    if (record.status === "pending") {
      openReturns.set(supplierId, (openReturns.get(supplierId) ?? 0) + 1);
    }
    history.push({
      supplierId,
      kind: "return",
      reference: record.reference,
      date: record.created_at.slice(0, 10),
      detail: `${one<{ name: string }>(record.products)?.name ?? "—"}${record.resolution_type ? ` · ${record.resolution_type}` : ""}`,
      quantity: record.quantity,
      value: null,
      status: record.status,
    });
  }

  const rows: SupplierRow[] = (suppliers ?? []).map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    supplierType: supplier.supplier_type,
    contactName: supplier.contact_name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    taxId: supplier.tax_id,
    registrationNumber: supplier.registration_number,
    paymentTerms: supplier.payment_terms,
    leadTimeDays: supplier.lead_time_days,
    isActive: supplier.is_active,
    productCount: productCount.get(supplier.id) ?? 0,
    purchaseCount: purchaseCount.get(supplier.id) ?? 0,
    purchaseValue: scope.canViewCost ? (purchaseValue.get(supplier.id) ?? 0) : null,
    freeGoodsUnits: freeGoods.get(supplier.id) ?? 0,
    replacementCount: replacements.get(supplier.id) ?? 0,
    openReturns: openReturns.get(supplier.id) ?? 0,
    totalReturns: totalReturns.get(supplier.id) ?? 0,
  }));

  const active = rows.filter((row) => row.isActive).length;
  const parent = rows.filter((row) => row.supplierType === "parent").length;
  const totalPurchaseValue = rows.reduce((sum, row) => sum + (row.purchaseValue ?? 0), 0);

  const stats: Array<[string, string, string]> = [
    ["Suppliers", String(rows.length), `${active} active`],
    ["Parent company", String(parent), `${rows.length - parent} external`],
    scope.canViewCost
      ? ["Purchase value", Math.round(totalPurchaseValue).toLocaleString("en-US"), scope.currency]
      : ["Free goods", String(rows.reduce((sum, row) => sum + row.freeGoodsUnits, 0)), "Units received"],
    ["Open returns", String(rows.reduce((sum, row) => sum + row.openReturns, 0)), "Awaiting resolution"],
  ];

  return {
    suppliers: rows,
    history: history.sort((a, b) => b.date.localeCompare(a.date)),
    stats,
    canManage: scope.employee?.permissions.includes("manage_suppliers") ?? false,
    canViewCost: scope.canViewCost,
    entityName: scope.entityName,
    currency: scope.currency,
  };
}
