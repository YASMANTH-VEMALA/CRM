import "server-only";
import { createClient } from "@/lib/supabase/server";
import { batchCostMapAllEntities } from "@/lib/data/costs";
import { formatTZS } from "@/app/dashboard/views/shared";

export type BranchesData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
};

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export async function getBranchesData(): Promise<BranchesData> {
  const supabase = await createClient();
  const today = startOfDay(new Date());

  const [{ data: branches }, { data: employees }, { data: batches }, { data: sales }] = await Promise.all([
    supabase.from("branches").select("*").order("name"),
    supabase.from("employees").select("id, branch_id"),
    supabase.from("product_batches").select("id, branch_id, quantity_available"),
    supabase
      .from("sales")
      .select("branch_id, total, status, sold_at")
      .gte("sold_at", today.toISOString())
      .neq("status", "reversed"),
  ]);

  const allBranches = branches ?? [];
  const allEmployees = employees ?? [];
  const allBatches = batches ?? [];
  const todaySales = sales ?? [];

  const employeeCountByBranch = new Map<string, number>();
  allEmployees.forEach((e) => {
    if (!e.branch_id) return;
    employeeCountByBranch.set(e.branch_id, (employeeCountByBranch.get(e.branch_id) ?? 0) + 1);
  });

  // Cost comes from batch_costs, which yields nothing without
  // view_purchase_cost — so inventory value is simply absent for those users.
  const costs = await batchCostMapAllEntities(supabase);
  const inventoryValueByBranch = new Map<string, number>();
  allBatches.forEach((b) => {
    if (!b.branch_id) return;
    const unitCost = costs.get(b.id);
    if (unitCost === undefined) return;
    inventoryValueByBranch.set(
      b.branch_id,
      (inventoryValueByBranch.get(b.branch_id) ?? 0) + b.quantity_available * unitCost
    );
  });

  const todaySalesByBranch = new Map<string, number>();
  todaySales.forEach((s) => {
    if (!s.branch_id) return;
    todaySalesByBranch.set(s.branch_id, (todaySalesByBranch.get(s.branch_id) ?? 0) + Number(s.total));
  });

  const activeBranches = allBranches.filter((b) => b.is_active);
  const totalInventoryValue = Array.from(inventoryValueByBranch.values()).reduce((sum, v) => sum + v, 0);

  const stats: Array<[string, string, string]> = [
    ["Branches", String(allBranches.length), `${activeBranches.length} active`],
    [
      "Active",
      String(activeBranches.length),
      allBranches.length > 0 ? `${((activeBranches.length / allBranches.length) * 100).toFixed(1)}%` : "0%",
    ],
    ["Inventory value", formatTZS(totalInventoryValue), "Consolidated"],
    ["Employees", String(allEmployees.length), "Across network"],
  ];

  const rows = allBranches.map((b) => [
    b.name,
    b.location ?? "—",
    b.manager_name ?? "—",
    String(employeeCountByBranch.get(b.id) ?? 0),
    formatTZS(inventoryValueByBranch.get(b.id) ?? 0),
    formatTZS(todaySalesByBranch.get(b.id) ?? 0),
    b.is_active ? "Active" : "Inactive",
  ]);

  return { stats, rows };
}
