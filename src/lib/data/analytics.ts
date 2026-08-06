import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatTZS } from "@/app/dashboard/views/shared";

export type TrendPoint = { label: string; salesPct: number; profitPct: number };

export type AnalyticsData = {
  stats: Array<[string, string, string]>;
  trend: TrendPoint[];
  trendTotal: string;
  trendNote: string;
  paymentMix: Array<[string, string, string]>;
  paymentMixGradient: string;
  paymentTotal: string;
  productPerformance: string[][];
};

// Fixed grayscale palette reused from the pharmacy CRM's monochrome design
// system (matches the donut ring in crm.css) — assigned by descending share.
const DONUT_PALETTE = ["#080808", "#4b4b4b", "#858585", "#b4b4b4", "#dddddd"];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
  const supabase = await createClient();

  // Seed data is sparse (a handful of transactions across a couple of
  // weeks), so — per project convention — every figure here is computed
  // over the full all-time history rather than a narrow recent window.
  const [{ data: sales }, { data: expenses }] = await Promise.all([
    supabase
      .from("sales")
      .select("total, payment_method, status, sold_at, sale_items(quantity, line_total, products(name, buy_price))")
      .order("sold_at", { ascending: true }),
    supabase.from("expenses").select("amount"),
  ]);

  const allSales = (sales ?? []).filter((s) => s.status !== "reversed");
  const transactionCount = allSales.length;
  const netSales = allSales.reduce((acc, s) => acc + Number(s.total), 0);

  let totalCost = 0;
  const productAgg = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  const dayAgg = new Map<string, { date: Date; sales: number; cost: number }>();
  const paymentAgg = new Map<string, number>();

  allSales.forEach((s) => {
    const soldAt = new Date(s.sold_at);
    const key = dayKey(soldAt);
    const dayEntry = dayAgg.get(key) ?? { date: soldAt, sales: 0, cost: 0 };
    dayEntry.sales += Number(s.total);
    paymentAgg.set(s.payment_method, (paymentAgg.get(s.payment_method) ?? 0) + Number(s.total));

    (s.sale_items ?? []).forEach((item) => {
      const product = item.products as unknown as { name: string; buy_price: number } | null;
      const quantity = Number(item.quantity);
      const name = product?.name ?? "Unknown product";
      const cost = (product?.buy_price ?? 0) * quantity;
      totalCost += cost;
      dayEntry.cost += cost;

      const existing = productAgg.get(name) ?? { name, qty: 0, revenue: 0, cost: 0 };
      existing.qty += quantity;
      existing.revenue += Number(item.line_total);
      existing.cost += cost;
      productAgg.set(name, existing);
    });

    dayAgg.set(key, dayEntry);
  });

  const grossProfit = netSales - totalCost;
  const expensesTotal = (expenses ?? []).reduce((acc, e) => acc + Number(e.amount), 0);
  const netProfit = grossProfit - expensesTotal;

  const stats: Array<[string, string, string]> = [
    ["Net sales", formatTZS(netSales), `${transactionCount} transaction${transactionCount === 1 ? "" : "s"}, all-time`],
    ["Gross profit", formatTZS(grossProfit), netSales > 0 ? `${((grossProfit / netSales) * 100).toFixed(1)}% margin` : "No sales yet"],
    ["Net profit", formatTZS(netProfit), netSales > 0 ? `${((netProfit / netSales) * 100).toFixed(1)}% margin` : "No sales yet"],
    ["Transactions", String(transactionCount), transactionCount > 0 ? `${formatTZS(netSales / transactionCount)} average` : "No sales yet"],
  ];

  // Sales & profit trend — group by calendar day, keep at most the last 12
  // days that actually have activity (this dataset rarely has more than a
  // couple of weeks of history), scaled 0-100 like the dashboard's hourlyBars.
  const sortedDayKeys = [...dayAgg.keys()].sort();
  const recentDayKeys = sortedDayKeys.slice(-12);
  const rawTrend = recentDayKeys.map((key) => {
    const entry = dayAgg.get(key)!;
    return { date: entry.date, sales: entry.sales, profit: Math.max(0, entry.sales - entry.cost) };
  });
  const maxTrendValue = Math.max(1, ...rawTrend.flatMap((t) => [t.sales, t.profit]));
  const dayLabelFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
  const trend: TrendPoint[] = rawTrend.map((t) => ({
    label: dayLabelFormatter.format(t.date),
    salesPct: t.sales > 0 ? Math.max(6, Math.round((t.sales / maxTrendValue) * 100)) : 0,
    profitPct: t.profit > 0 ? Math.max(6, Math.round((t.profit / maxTrendValue) * 100)) : 0,
  }));

  // Payment mix — share of net sales per payment method, plus a matching
  // conic-gradient string so the donut ring reflects the real proportions.
  const sortedPayments = [...paymentAgg.entries()].sort((a, b) => b[1] - a[1]);
  const paymentMix: Array<[string, string, string]> = [];
  const gradientStops: string[] = [];
  let cursor = 0;
  sortedPayments.forEach(([method, amount], index) => {
    const pct = netSales > 0 ? (amount / netSales) * 100 : 0;
    const color = DONUT_PALETTE[Math.min(index, DONUT_PALETTE.length - 1)];
    gradientStops.push(`${color} ${cursor.toFixed(1)}% ${(cursor + pct).toFixed(1)}%`);
    cursor += pct;
    paymentMix.push([method, `${pct.toFixed(1)}%`, formatTZS(amount)]);
  });
  const paymentMixGradient = gradientStops.length > 0 ? `conic-gradient(${gradientStops.join(", ")})` : "conic-gradient(#e4e4e1 0 100%)";

  const productPerformance = [...productAgg.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((p) => {
      const profit = p.revenue - p.cost;
      const margin = p.revenue > 0 ? `${((profit / p.revenue) * 100).toFixed(1)}%` : "0%";
      return [p.name, String(p.qty), formatTZS(p.revenue), formatTZS(p.cost), formatTZS(profit), margin];
    });

  return {
    stats,
    trend,
    trendTotal: formatTZS(netSales),
    trendNote: transactionCount > 0 ? `${transactionCount} transactions, all-time` : "No sales recorded yet",
    paymentMix,
    paymentMixGradient,
    paymentTotal: formatTZS(netSales),
    productPerformance,
  };
}
