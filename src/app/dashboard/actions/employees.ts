"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { isOverridable, isPermission, isRole, PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/lib/types";

function revalidateEmployeePaths() {
  revalidatePath("/dashboard/employees");
  revalidatePath("/dashboard");
}

export async function addEmployee(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "manage_users");
  if (denied) return denied;
  const supabase = await createClient();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const approvalLimitRaw = String(formData.get("approval_limit") ?? "").trim();
  const approvalLimit = approvalLimitRaw ? Number(approvalLimitRaw) : null;
  const maxDiscount = Number(formData.get("max_discount_percent") ?? 0);

  // Non-master admins can only create users inside the entity they are in.
  const requestedBranch = String(formData.get("branch_id") ?? "") || null;
  const branchId = employee.isMaster ? requestedBranch ?? (await getActiveEntityId()) : employee.branch_id;

  if (!fullName || !role) {
    return { ok: false, error: "Full name and role are required." };
  }
  if (!isRole(role)) {
    return { ok: false, error: "Select a valid role." };
  }
  if (role === "master_admin" && !employee.isMaster) {
    return { ok: false, error: "Only a master administrator can create another master administrator." };
  }
  if (role !== "master_admin" && !branchId) {
    return { ok: false, error: ENTITY_REQUIRED_ERROR };
  }
  if (maxDiscount < 0 || maxDiscount > 100) {
    return { ok: false, error: "Maximum discount must be between 0 and 100." };
  }

  const { error } = await supabase.from("employees").insert({
    full_name: fullName,
    username: username || null,
    email: email || null,
    role,
    branch_id: role === "master_admin" ? null : branchId,
    approval_limit: approvalLimit,
    max_discount_percent: maxDiscount,
  });

  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate") ? "That username or email already exists." : error.message,
    };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: `User created (${role})`,
    module: "Employees",
    record_reference: fullName,
    new_value: JSON.stringify({ role, branch_id: branchId, max_discount_percent: maxDiscount }),
    branch_id: branchId,
  });

  revalidateEmployeePaths();
  return { ok: true };
}

export async function setEmployeeStatus(employeeId: string, status: "active" | "disabled"): Promise<ActionResult> {
  const actor = await requireUser();
  const denied = permissionError(actor, "manage_users");
  if (denied) return denied;
  const supabase = await createClient();

  if (employeeId === actor.id) {
    return { ok: false, error: "You cannot change your own account status." };
  }

  const { data: target } = await supabase
    .from("employees")
    .select("id, full_name, role, status, branch_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (!target) return { ok: false, error: "User not found." };
  if (target.role === "master_admin" && !actor.isMaster) {
    return { ok: false, error: "Only a master administrator can change a master administrator." };
  }
  // Never allow the last active master admin to be locked out.
  if (target.role === "master_admin" && status === "disabled") {
    const { count } = await supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("role", "master_admin")
      .eq("status", "active");
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "This is the last active master administrator and cannot be disabled." };
    }
  }

  const { error } = await supabase.from("employees").update({ status }).eq("id", employeeId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: actor.id,
    action: status === "active" ? "User activated" : "User disabled",
    module: "Employees",
    record_reference: target.full_name,
    previous_value: target.status,
    new_value: status,
    branch_id: target.branch_id,
  });

  revalidateEmployeePaths();
  return { ok: true };
}

/**
 * Saves the granular permission overrides, discount ceiling and role for one
 * user. Checkbox absence means "revoke", so the whole permission set is
 * rewritten from the submitted form on every save.
 */
export async function saveEmployeePermissions(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireUser();
  const denied = permissionError(actor, "manage_users");
  if (denied) return denied;
  const supabase = await createClient();

  const employeeId = String(formData.get("employee_id") ?? "");
  const role = String(formData.get("role") ?? "").trim();
  const maxDiscount = Number(formData.get("max_discount_percent") ?? 0);

  if (!employeeId) return { ok: false, error: "Select a user." };
  if (!isRole(role)) return { ok: false, error: "Select a valid role." };
  if (maxDiscount < 0 || maxDiscount > 100) {
    return { ok: false, error: "Maximum discount must be between 0 and 100." };
  }
  // Nobody edits their own privileges, whatever they hold. The database
  // trigger enforces this too; failing here gives a readable message instead
  // of a raw Postgres exception.
  if (employeeId === actor.id) {
    return {
      ok: false,
      error: "You cannot change your own role, permissions or discount limit. Ask another administrator.",
    };
  }

  const { data: target } = await supabase
    .from("employees")
    .select("id, full_name, role, branch_id, permission_overrides, max_discount_percent")
    .eq("id", employeeId)
    .maybeSingle();

  if (!target) return { ok: false, error: "User not found." };
  if ((target.role === "master_admin" || role === "master_admin") && !actor.isMaster) {
    return { ok: false, error: "Only a master administrator can manage master administrator accounts." };
  }

  const { data: rolePerms } = await supabase
    .from("role_permissions")
    .select("permission")
    .eq("role", role);
  const defaults = new Set((rolePerms ?? []).map((r) => r.permission));

  // Store only genuine deviations from the role template, so a later change
  // to the template still flows through to users who never customised it.
  // Master-tier permissions are role-only and are never written as overrides,
  // so a forged `perm_manage_entities=on` field cannot escalate anyone.
  const overrides: Record<string, boolean> = {};
  for (const permission of PERMISSIONS) {
    if (!isOverridable(permission)) continue;
    const granted = formData.get(`perm_${permission}`) === "on";
    if (granted !== defaults.has(permission)) {
      overrides[permission] = granted;
    }
  }

  const submittedKeys = Object.keys(overrides).filter(
    (key) => !isPermission(key) || !isOverridable(key)
  );
  if (submittedKeys.length > 0) {
    return { ok: false, error: "Unknown or non-overridable permission submitted." };
  }

  const { error } = await supabase
    .from("employees")
    .update({ role, permission_overrides: overrides, max_discount_percent: maxDiscount })
    .eq("id", employeeId);

  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: actor.id,
    action: "Permissions updated",
    module: "Employees",
    record_reference: target.full_name,
    previous_value: JSON.stringify({
      role: target.role,
      overrides: target.permission_overrides,
      max_discount_percent: target.max_discount_percent,
    }),
    new_value: JSON.stringify({ role, overrides, max_discount_percent: maxDiscount }),
    branch_id: target.branch_id,
  });

  revalidateEmployeePaths();
  return { ok: true };
}

/** Grants or revokes access to an additional entity for one user. */
export async function setEmployeeEntityAccess(
  employeeId: string,
  entityId: string,
  grant: boolean
): Promise<ActionResult> {
  const actor = await requireUser();
  const denied = permissionError(actor, "manage_users");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: target } = await supabase
    .from("employees")
    .select("id, full_name, branch_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!target) return { ok: false, error: "User not found." };

  if (grant) {
    const { error } = await supabase
      .from("employee_entities")
      .insert({ employee_id: employeeId, branch_id: entityId });
    if (error && !error.message.includes("duplicate")) {
      return { ok: false, error: error.message };
    }
  } else {
    const { error } = await supabase
      .from("employee_entities")
      .delete()
      .eq("employee_id", employeeId)
      .eq("branch_id", entityId);
    if (error) return { ok: false, error: error.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: actor.id,
    action: grant ? "Entity access granted" : "Entity access revoked",
    module: "Employees",
    record_reference: target.full_name,
    new_value: entityId,
    branch_id: target.branch_id,
  });

  revalidateEmployeePaths();
  return { ok: true };
}
