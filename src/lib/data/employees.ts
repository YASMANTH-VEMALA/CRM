import "server-only";
import { getScope } from "./scope";
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLES,
  ROLE_LABELS,
  resolvePermissions,
  type Permission,
  type Role,
} from "@/lib/permissions";

function one<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

export type EmployeeRow = {
  id: string;
  fullName: string;
  username: string | null;
  email: string | null;
  role: Role;
  roleLabel: string;
  entityId: string | null;
  entityName: string | null;
  extraEntityIds: string[];
  maxDiscountPercent: number;
  approvalLimit: number | null;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  hasLogin: boolean;
  /** Effective permissions: role template with per-user overrides applied. */
  permissions: Permission[];
  overrides: Record<string, boolean>;
};

export type EmployeesData = {
  employees: EmployeeRow[];
  entities: { id: string; name: string }[];
  /** Role template defaults, so the editor can show what is inherited. */
  roleDefaults: Record<Role, Permission[]>;
  permissionCatalogue: Array<{ value: Permission; label: string }>;
  roleOptions: Array<{ value: Role; label: string }>;
  stats: Array<[string, string, string]>;
  canManage: boolean;
  isMaster: boolean;
  currentEmployeeId: string | null;
  entityName: string;
};

export async function getEmployeesData(): Promise<EmployeesData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  let employeeQuery = supabase.from("employees").select("*, branches(name)").order("full_name");
  // Master admins have no home entity, so they are listed alongside the
  // active entity's staff rather than disappearing from the roster.
  if (entityId) employeeQuery = employeeQuery.or(`branch_id.eq.${entityId},role.eq.master_admin`);

  const [{ data: employees }, { data: entities }, { data: rolePermissions }, { data: extraAccess }] =
    await Promise.all([
      employeeQuery,
      supabase.from("branches").select("id, name").order("name"),
      supabase.from("role_permissions").select("role, permission"),
      supabase.from("employee_entities").select("employee_id, branch_id"),
    ]);

  const defaults = {} as Record<Role, Permission[]>;
  for (const role of ROLES) {
    defaults[role] = resolvePermissions(
      (rolePermissions ?? []).filter((row) => row.role === role).map((row) => row.permission),
      {}
    );
  }

  const extraByEmployee = new Map<string, string[]>();
  for (const row of extraAccess ?? []) {
    extraByEmployee.set(row.employee_id, [...(extraByEmployee.get(row.employee_id) ?? []), row.branch_id]);
  }

  const rows: EmployeeRow[] = (employees ?? []).map((employee) => {
    const role = employee.role as Role;
    const overrides = (employee.permission_overrides ?? {}) as Record<string, boolean>;
    return {
      id: employee.id,
      fullName: employee.full_name,
      username: employee.username,
      email: employee.email,
      role,
      roleLabel: ROLE_LABELS[role] ?? role,
      entityId: employee.branch_id,
      entityName: one<{ name: string }>(employee.branches)?.name ?? null,
      extraEntityIds: extraByEmployee.get(employee.id) ?? [],
      maxDiscountPercent: Number(employee.max_discount_percent ?? 0),
      approvalLimit: employee.approval_limit == null ? null : Number(employee.approval_limit),
      status: employee.status,
      lastLoginAt: employee.last_login_at,
      hasLogin: Boolean(employee.auth_user_id),
      permissions: resolvePermissions(defaults[role] ?? [], overrides),
      overrides,
    };
  });

  const active = rows.filter((row) => row.status === "active").length;
  const withLogin = rows.filter((row) => row.hasLogin).length;
  const byRole = new Map<string, number>();
  for (const row of rows) byRole.set(row.roleLabel, (byRole.get(row.roleLabel) ?? 0) + 1);

  const stats: Array<[string, string, string]> = [
    ["Users", String(rows.length), scope.entityName],
    ["Active", String(active), `${rows.length - active} disabled`],
    ["With login access", String(withLogin), `${rows.length - withLogin} record-only`],
    ["Roles in use", String(byRole.size), [...byRole.keys()].slice(0, 2).join(", ") || "—"],
  ];

  return {
    employees: rows,
    entities: entities ?? [],
    roleDefaults: defaults,
    permissionCatalogue: PERMISSIONS.map((permission) => ({
      value: permission,
      label: PERMISSION_LABELS[permission],
    })),
    roleOptions: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    stats,
    canManage: scope.employee?.permissions.includes("manage_users") ?? false,
    isMaster: scope.employee?.isMaster ?? false,
    currentEmployeeId: scope.employee?.id ?? null,
    entityName: scope.entityName,
  };
}
