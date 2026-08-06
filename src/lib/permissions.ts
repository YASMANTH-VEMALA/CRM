// Granular permission vocabulary for the ERP. The runtime source of truth for
// role defaults is the role_permissions table (seeded in 0006); per-employee
// overrides live in employees.permission_overrides as {"<permission>": bool}.
// This module holds the static vocabulary, labels, and the pure resolution
// logic shared by the DAL, the permission-editor UI, and tests.

export const PERMISSIONS = [
  "view_products",
  "create_products",
  "edit_products",
  "import_products",
  "view_inventory",
  "adjust_inventory",
  "create_stock_inward",
  "create_stock_outward",
  "approve_stock_outward",
  "view_purchase_cost",
  "manage_suppliers",
  "create_sales",
  "apply_discount",
  "cancel_sales",
  "view_profit",
  "view_management_reports",
  "manage_users",
  "manage_entities",
  "manage_settings",
  "access_multiple_entities",
  "generate_exports",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_products: "View products",
  create_products: "Create products",
  edit_products: "Edit products",
  import_products: "Import products",
  view_inventory: "View inventory",
  adjust_inventory: "Adjust inventory (stock corrections)",
  create_stock_inward: "Create stock inward",
  create_stock_outward: "Create stock out (returns / write-offs)",
  approve_stock_outward: "Approve stock out",
  view_purchase_cost: "View purchase cost",
  manage_suppliers: "Manage suppliers",
  create_sales: "Create sales",
  apply_discount: "Apply discount",
  cancel_sales: "Cancel / reverse sales",
  view_profit: "View profit",
  view_management_reports: "View management reports",
  manage_users: "Manage users",
  manage_entities: "Manage entities",
  manage_settings: "Manage settings",
  access_multiple_entities: "Access multiple entities",
  generate_exports: "Generate exports",
};

/**
 * Master-tier permissions decide who may create entities, reach across
 * entities, or administer other users. They are role-only and can never be
 * granted through a per-employee override — otherwise anyone holding
 * manage_users could mint master-level access for themselves or a colleague.
 * Mirrors permission_catalog.overridable = false in migration 0011; the
 * database rejects these overrides on write and ignores them on read, so this
 * list is the UI/action-layer half of a two-sided guard.
 */
export const NON_OVERRIDABLE_PERMISSIONS = [
  "manage_users",
  "manage_entities",
  "access_multiple_entities",
] as const satisfies readonly Permission[];

const NON_OVERRIDABLE = new Set<Permission>(NON_OVERRIDABLE_PERMISSIONS);

export function isOverridable(permission: Permission): boolean {
  return !NON_OVERRIDABLE.has(permission);
}

export type Role = "master_admin" | "entity_admin" | "inventory_user" | "sales_user";

export const ROLES: Role[] = ["master_admin", "entity_admin", "inventory_user", "sales_user"];

export const ROLE_LABELS: Record<Role, string> = {
  master_admin: "Master Admin",
  entity_admin: "Entity Admin / Owner",
  inventory_user: "Inventory / Purchase User",
  sales_user: "Sales / Dispensing User",
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Effective permissions = role template defaults, then per-employee overrides
 * applied on top (true grants, false revokes). Mirrors has_perm() in Postgres,
 * including the rule that master-tier permissions ignore overrides entirely —
 * so a stale or planted override cannot widen access here either.
 */
export function resolvePermissions(
  roleDefaults: string[],
  overrides: Record<string, unknown> | null | undefined
): Permission[] {
  const effective = new Set<Permission>(roleDefaults.filter(isPermission));
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!isPermission(key)) continue;
    if (!isOverridable(key)) continue;
    if (value === true) effective.add(key);
    if (value === false) effective.delete(key);
  }
  return [...effective];
}
