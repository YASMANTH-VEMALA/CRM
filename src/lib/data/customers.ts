import "server-only";
import { getScope } from "./scope";
import { formatDate, formatTZS } from "@/app/dashboard/views/shared";
import type { Customer } from "@/lib/types";

export type CustomersData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
  // Parallel to `rows` — the customer's raw segment value, used by the view to
  // power the "Segments" tab without inventing a dedicated segments table.
  segments: (string | null)[];
};

export async function getCustomersData(): Promise<CustomersData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let customerQuery = supabase.from("customers").select("*").order("created_at", { ascending: false });
  if (entityId) customerQuery = customerQuery.eq("branch_id", entityId);

  let salesQuery = supabase
    .from("sales")
    .select("customer_id, total, status, sold_at")
    .not("customer_id", "is", null);
  if (entityId) salesQuery = salesQuery.eq("branch_id", entityId);

  const [{ data: customers }, { data: sales }] = await Promise.all([customerQuery, salesQuery]);

  const allCustomers = (customers ?? []) as Customer[];

  type CustomerSalesAgg = { total: number; lastPurchase: string | null; count: number };
  const salesByCustomer = new Map<string, CustomerSalesAgg>();
  (sales ?? []).forEach((sale) => {
    const customerId = sale.customer_id as string;
    const entry = salesByCustomer.get(customerId) ?? { total: 0, lastPurchase: null, count: 0 };
    entry.count += 1;
    if (sale.status !== "reversed") entry.total += sale.total;
    if (!entry.lastPurchase || new Date(sale.sold_at) > new Date(entry.lastPurchase)) {
      entry.lastPurchase = sale.sold_at;
    }
    salesByCustomer.set(customerId, entry);
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newThisMonth = allCustomers.filter((c) => new Date(c.created_at) >= monthStart).length;
  const returning = allCustomers.filter((c) => (salesByCustomer.get(c.id)?.count ?? 0) > 1).length;
  const loyaltyOutstanding = allCustomers.reduce((sum, c) => sum + c.loyalty_points, 0);

  const stats: Array<[string, string, string]> = [
    ["Registered", String(allCustomers.length), scope.entityName],
    [
      "New this month",
      String(newThisMonth),
      allCustomers.length > 0 ? `${((newThisMonth / allCustomers.length) * 100).toFixed(1)}% of total` : "0%",
    ],
    [
      "Returning",
      String(returning),
      allCustomers.length > 0 ? `${((returning / allCustomers.length) * 100).toFixed(1)}%` : "0%",
    ],
    ["Loyalty points", loyaltyOutstanding.toLocaleString("en-US"), "Outstanding"],
  ];

  const rows = allCustomers.map((c) => {
    const agg = salesByCustomer.get(c.id);
    return [
      c.name,
      c.phone ?? "—",
      agg?.lastPurchase ? formatDate(agg.lastPurchase) : "—",
      formatTZS(agg?.total ?? 0),
      c.loyalty_points.toLocaleString("en-US"),
      formatTZS(c.credit_balance),
    ];
  });

  return { stats, rows, segments: allCustomers.map((c) => c.segment) };
}
