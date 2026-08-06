import "server-only";
import { getScope } from "./scope";
import { batchCostMapAllEntities } from "./costs";

export type EntityRow = {
  id: string;
  code: string;
  name: string;
  registeredName: string | null;
  location: string | null;
  managerName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  isActive: boolean;
  employeeCount: number;
  productCount: number;
  lowStockCount: number;
  stockValue: number | null;
  todayRevenue: number;
};

export type EntitiesData = {
  entities: EntityRow[];
  stats: Array<[string, string, string]>;
  canManage: boolean;
  canViewCost: boolean;
};

function startOfToday(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export async function getEntitiesData(): Promise<EntitiesData> {
  const scope = await getScope();
  const { supabase } = scope;

  const [{ data: entities }, { data: employees }, { data: products }, { data: batches }, { data: sales }] =
    await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase.from("employees").select("id, branch_id, status"),
      supabase.from("products").select("id, branch_id, reorder_level").eq("status", "active"),
      supabase.from("product_batches").select("id, product_id, branch_id, quantity_available").eq("status", "active"),
      supabase
        .from("sales")
        .select("branch_id, total")
        .gte("sold_at", startOfToday())
        .neq("status", "reversed"),
    ]);

  const employeeCount = new Map<string, number>();
  for (const employee of employees ?? []) {
    if (!employee.branch_id || employee.status !== "active") continue;
    employeeCount.set(employee.branch_id, (employeeCount.get(employee.branch_id) ?? 0) + 1);
  }

  // This is the consolidated multi-entity view, so cost is fetched across every
  // entity. batch_costs yields nothing without view_purchase_cost.
  const costs = await batchCostMapAllEntities(supabase);
  const availableByProduct = new Map<string, number>();
  const stockValue = new Map<string, number>();
  for (const batch of batches ?? []) {
    const available = Math.max(0, batch.quantity_available);
    availableByProduct.set(batch.product_id, (availableByProduct.get(batch.product_id) ?? 0) + available);
    const unitCost = costs.get(batch.id);
    if (unitCost !== undefined) {
      stockValue.set(batch.branch_id, (stockValue.get(batch.branch_id) ?? 0) + available * unitCost);
    }
  }

  const productCount = new Map<string, number>();
  const lowStockCount = new Map<string, number>();
  for (const product of products ?? []) {
    productCount.set(product.branch_id, (productCount.get(product.branch_id) ?? 0) + 1);
    if ((availableByProduct.get(product.id) ?? 0) <= product.reorder_level) {
      lowStockCount.set(product.branch_id, (lowStockCount.get(product.branch_id) ?? 0) + 1);
    }
  }

  const todayRevenue = new Map<string, number>();
  for (const sale of sales ?? []) {
    todayRevenue.set(sale.branch_id, (todayRevenue.get(sale.branch_id) ?? 0) + Number(sale.total));
  }

  const rows: EntityRow[] = (entities ?? []).map((entity) => ({
    id: entity.id,
    code: entity.code,
    name: entity.name,
    registeredName: entity.registered_name,
    location: entity.location,
    managerName: entity.manager_name,
    phone: entity.phone,
    email: entity.email,
    address: entity.address,
    currency: entity.currency,
    timezone: entity.timezone,
    isActive: entity.is_active,
    employeeCount: employeeCount.get(entity.id) ?? 0,
    productCount: productCount.get(entity.id) ?? 0,
    lowStockCount: lowStockCount.get(entity.id) ?? 0,
    stockValue: scope.canViewCost ? (stockValue.get(entity.id) ?? 0) : null,
    todayRevenue: todayRevenue.get(entity.id) ?? 0,
  }));

  const active = rows.filter((row) => row.isActive).length;
  const stats: Array<[string, string, string]> = [
    ["Entities", String(rows.length), `${active} active`],
    ["Employees", String(rows.reduce((sum, row) => sum + row.employeeCount, 0)), "Across the network"],
    ["Products", String(rows.reduce((sum, row) => sum + row.productCount, 0)), "Active catalogue"],
    [
      "Low stock",
      String(rows.reduce((sum, row) => sum + row.lowStockCount, 0)),
      "Products at or below minimum",
    ],
  ];

  return {
    entities: rows,
    stats,
    canManage: scope.employee?.permissions.includes("manage_entities") ?? false,
    canViewCost: scope.canViewCost,
  };
}
