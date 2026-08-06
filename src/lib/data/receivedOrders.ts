import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatTZS } from "@/app/dashboard/views/shared";

export type EligiblePurchaseOrder = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  items: Array<{ product_id: string; sku: string; name: string; quantity: number; unit_cost: number }>;
};

export type ReceivedOrdersData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
  eligiblePurchaseOrders: EligiblePurchaseOrder[];
};

function statusLabel(status: string): string {
  return status[0].toUpperCase() + status.slice(1);
}

export async function getReceivedOrdersData(): Promise<ReceivedOrdersData> {
  const supabase = await createClient();

  const [{ data: received }, { data: eligiblePOs }] = await Promise.all([
    supabase
      .from("received_orders")
      .select(
        "*, purchase_orders(po_number, suppliers(name)), employees(full_name), received_order_items(quantity_ordered, quantity_received, unit_cost, damaged_qty)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_orders")
      .select("id, po_number, supplier_id, suppliers(name), purchase_order_items(product_id, quantity, unit_cost, products(sku, name))")
      .in("status", ["approved", "partially_received"])
      .order("created_at", { ascending: false }),
  ]);

  const allReceived = received ?? [];
  const monthPrefix = new Date().toISOString().slice(0, 7);

  const receivedThisMonth = allReceived.filter((r) => (r.created_at as string).startsWith(monthPrefix));
  const receivedThisMonthValue = receivedThisMonth.reduce((sum, r) => {
    const items = (r.received_order_items as { quantity_received: number; unit_cost: number }[] | null) ?? [];
    return sum + items.reduce((itemSum, item) => itemSum + item.quantity_received * item.unit_cost, 0);
  }, 0);

  const fullyReceived = allReceived.filter((r) => r.status === "complete");
  const withVariances = allReceived.filter((r) => r.status === "variance");
  const damagedUnits = allReceived.reduce((sum, r) => {
    const items = (r.received_order_items as { damaged_qty: number }[] | null) ?? [];
    return sum + items.reduce((itemSum, item) => itemSum + item.damaged_qty, 0);
  }, 0);
  const damagedValue = allReceived.reduce((sum, r) => {
    const items = (r.received_order_items as { damaged_qty: number; unit_cost: number }[] | null) ?? [];
    return sum + items.reduce((itemSum, item) => itemSum + item.damaged_qty * item.unit_cost, 0);
  }, 0);

  const stats: Array<[string, string, string]> = [
    ["Received this month", String(receivedThisMonth.length), formatTZS(receivedThisMonthValue)],
    [
      "Fully received",
      String(fullyReceived.length),
      allReceived.length > 0 ? `${((fullyReceived.length / allReceived.length) * 100).toFixed(1)}%` : "0%",
    ],
    ["With variances", String(withVariances.length), "Needs review"],
    ["Damaged units", String(damagedUnits), formatTZS(damagedValue)],
  ];

  const rows = allReceived.map((r) => {
    const po = r.purchase_orders as { po_number: string; suppliers: { name: string } | null } | null;
    const items = (r.received_order_items as { quantity_ordered: number; quantity_received: number; damaged_qty: number }[] | null) ?? [];
    const batchCount = items.length;
    const totalReceived = items.reduce((sum, item) => sum + item.quantity_received, 0);
    const variance = items.reduce((sum, item) => sum + (item.quantity_received - item.quantity_ordered), 0);
    const damaged = items.reduce((sum, item) => sum + item.damaged_qty, 0);
    const varianceLabel = `${variance > 0 ? "+" : ""}${variance}${damaged > 0 ? ` / ${damaged} damaged` : ""}`;
    return [
      `${r.grn_number} / ${po?.po_number ?? "—"}`,
      r.supplier_invoice_number ?? "—",
      po?.suppliers?.name ?? "—",
      String(batchCount),
      `${totalReceived} units`,
      varianceLabel,
      (r.employees as { full_name: string } | null)?.full_name ?? "—",
      statusLabel(r.status),
    ];
  });

  const eligiblePurchaseOrders: EligiblePurchaseOrder[] = (eligiblePOs ?? []).map((po) => ({
    id: po.id as string,
    po_number: po.po_number as string,
    supplier_id: po.supplier_id as string | null,
    supplier_name: (po.suppliers as unknown as { name: string } | null)?.name ?? "—",
    items: ((po.purchase_order_items as unknown as
      | Array<{ product_id: string; quantity: number; unit_cost: number; products: { sku: string; name: string } | null }>
      | null) ?? []
    ).map((item) => ({
      product_id: item.product_id,
      sku: item.products?.sku ?? "—",
      name: item.products?.name ?? "—",
      quantity: item.quantity,
      unit_cost: item.unit_cost,
    })),
  }));

  return { stats, rows, eligiblePurchaseOrders };
}
