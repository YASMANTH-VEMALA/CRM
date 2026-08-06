import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/dal";
import { formatDate, formatTZS } from "@/app/dashboard/views/shared";

export type PurchaseOrdersData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
  suppliers: { id: string; name: string }[];
  products: { id: string; sku: string; name: string; buy_price: number }[];
  employee: { id: string; full_name: string };
  pendingApprovals: Array<{ id: string; po_number: string; supplier: string; total: string }>;
};

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export async function getPurchaseOrdersData(): Promise<PurchaseOrdersData> {
  const employee = await requireUser();
  const supabase = await createClient();

  const [{ data: orders }, { data: suppliers }, { data: products }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, suppliers(name), employees(full_name), purchase_order_items(quantity)")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("products").select("id, sku, name, buy_price").eq("status", "active").order("name"),
  ]);

  const allOrders = orders ?? [];
  const todayIso = new Date().toISOString().slice(0, 10);

  const draftOrders = allOrders.filter((o) => o.status === "draft");
  const pendingOrders = allOrders.filter((o) => o.status === "pending_approval");
  const approvedOrders = allOrders.filter((o) => o.status === "approved");
  const delayedOrders = approvedOrders.filter((o) => o.expected_date && o.expected_date < todayIso);

  const stats: Array<[string, string, string]> = [
    ["Draft", String(draftOrders.length), formatTZS(draftOrders.reduce((sum, o) => sum + o.total, 0))],
    ["Pending approval", String(pendingOrders.length), formatTZS(pendingOrders.reduce((sum, o) => sum + o.total, 0))],
    ["Approved", String(approvedOrders.length), "Awaiting delivery"],
    ["Delayed", String(delayedOrders.length), "Needs follow-up"],
  ];

  const rows = allOrders.map((o) => {
    const items = (o.purchase_order_items as { quantity: number }[] | null) ?? [];
    const qty = items.reduce((sum, item) => sum + item.quantity, 0);
    return [
      o.po_number,
      (o.suppliers as { name: string } | null)?.name ?? "—",
      (o.employees as { full_name: string } | null)?.full_name ?? "—",
      String(qty),
      formatTZS(o.total),
      formatDate(o.expected_date),
      statusLabel(o.status),
    ];
  });

  const pendingApprovals = pendingOrders.map((o) => ({
    id: o.id as string,
    po_number: o.po_number as string,
    supplier: (o.suppliers as { name: string } | null)?.name ?? "—",
    total: formatTZS(o.total),
  }));

  return {
    stats,
    rows,
    suppliers: suppliers ?? [],
    products: products ?? [],
    employee: { id: employee.id, full_name: employee.full_name },
    pendingApprovals,
  };
}
