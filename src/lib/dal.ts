import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { resolvePermissions, type Permission, type Role } from "@/lib/permissions";

export type CurrentEmployee = {
  id: string;
  authUserId: string;
  full_name: string;
  username: string | null;
  email: string | null;
  role: Role;
  branch_id: string | null;
  status: string;
  maxDiscountPercent: number;
  permissions: Permission[];
  isMaster: boolean;
  /** Entity ids this employee can access. Empty for master admins (= all). */
  entityIds: string[];
};

export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select(
      "id, full_name, username, email, role, branch_id, status, permission_overrides, max_discount_percent"
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!employee || employee.status !== "active") return null;

  const [{ data: rolePerms }, { data: extraEntities }] = await Promise.all([
    supabase.from("role_permissions").select("permission").eq("role", employee.role),
    supabase.from("employee_entities").select("branch_id").eq("employee_id", employee.id),
  ]);

  const permissions = resolvePermissions(
    (rolePerms ?? []).map((r) => r.permission),
    employee.permission_overrides as Record<string, unknown> | null
  );

  const isMaster = employee.role === "master_admin";
  const entityIds = isMaster
    ? []
    : [
        ...new Set(
          [employee.branch_id, ...(extraEntities ?? []).map((e) => e.branch_id)].filter(
            (id): id is string => Boolean(id)
          )
        ),
      ];

  return {
    id: employee.id,
    authUserId: user.id,
    full_name: employee.full_name,
    username: employee.username,
    email: employee.email,
    role: employee.role as Role,
    branch_id: employee.branch_id,
    status: employee.status,
    maxDiscountPercent: Number(employee.max_discount_percent ?? 0),
    permissions,
    isMaster,
    entityIds,
  };
});

export async function requireUser(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect("/login");
  }
  return employee;
}

export function hasPermission(employee: CurrentEmployee, permission: Permission): boolean {
  return employee.permissions.includes(permission);
}

/** For server actions: returns an ActionResult-shaped error, or null if allowed. */
export function permissionError(
  employee: CurrentEmployee,
  permission: Permission
): { ok: false; error: string } | null {
  if (hasPermission(employee, permission)) return null;
  return { ok: false, error: "You do not have permission to perform this action." };
}

/** For pages/loaders that must not render without the permission. */
export async function requirePermission(permission: Permission): Promise<CurrentEmployee> {
  const employee = await requireUser();
  if (!hasPermission(employee, permission)) {
    redirect("/dashboard");
  }
  return employee;
}
