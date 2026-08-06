import type { Permission } from "@/lib/permissions";

export type NavItem = {
  label: string;
  slug: string;
  /** Hidden unless the signed-in user holds this permission. */
  permission?: Permission;
  /** Hidden unless the user is a master admin. */
  masterOnly?: boolean;
};
export type NavGroup = { label: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", slug: "dashboard" }] },
  {
    label: "Sell",
    items: [
      { label: "Point of sale", slug: "sales", permission: "create_sales" },
      { label: "Sales history", slug: "sales-history", permission: "create_sales" },
      { label: "Customers", slug: "customers", permission: "create_sales" },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { label: "Products", slug: "products", permission: "view_products" },
      { label: "Draft products", slug: "draft-products", permission: "import_products" },
      { label: "Categories", slug: "categories", permission: "view_products" },
      { label: "Suppliers", slug: "suppliers", permission: "manage_suppliers" },
    ],
  },
  {
    label: "Stock",
    items: [
      { label: "Inventory", slug: "inventory", permission: "view_inventory" },
      { label: "Opening stock", slug: "opening-stock", permission: "create_stock_inward" },
      { label: "Stock inward", slug: "stock-inward", permission: "create_stock_inward" },
      { label: "Stock out", slug: "returns", permission: "view_inventory" },
      { label: "Stock ledger", slug: "stock-ledger", permission: "view_inventory" },
      { label: "Low stock", slug: "low-stock", permission: "view_inventory" },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { label: "Purchase orders", slug: "purchase-orders", permission: "create_stock_inward" },
      { label: "Received orders", slug: "received-orders", permission: "create_stock_inward" },
      { label: "Expenses", slug: "expenses" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Reports", slug: "reports", permission: "view_inventory" },
      { label: "Analytics", slug: "analytics", permission: "view_management_reports" },
      { label: "Ask AI", slug: "ai-assistant" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Entities", slug: "entities", permission: "manage_entities" },
      { label: "Users & permissions", slug: "employees", permission: "manage_users" },
      { label: "Audit logs", slug: "audit-logs", permission: "view_management_reports" },
      { label: "Notifications", slug: "notifications" },
      { label: "Settings", slug: "settings", permission: "manage_settings" },
    ],
  },
];

/** Nav filtered to what this user may actually open. */
export function visibleNavGroups(permissions: string[], isMaster: boolean): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.masterOnly && !isMaster) return false;
        if (item.permission && !permissions.includes(item.permission)) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** Section slugs a user may load, used to guard direct URL access. */
export function permittedSections(permissions: string[], isMaster: boolean): Set<string> {
  const slugs = new Set<string>(["dashboard", "profile"]);
  for (const group of visibleNavGroups(permissions, isMaster)) {
    for (const item of group.items) slugs.add(item.slug);
  }
  return slugs;
}
