"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export async function addExpense(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const supabase = await createClient();

  const description = String(formData.get("description") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "") || null;
  const vendor = String(formData.get("vendor") ?? "").trim() || null;
  const amount = Number(formData.get("amount") ?? 0);
  const paymentMethod = String(formData.get("payment_method") ?? "").trim() || null;
  const branchId =
    (String(formData.get("branch_id") ?? "") || null) ?? (await getActiveEntityId());
  const isRecurring = formData.get("is_recurring") === "on";

  if (!branchId) {
    return { ok: false, error: ENTITY_REQUIRED_ERROR };
  }

  if (!description) {
    return { ok: false, error: "Expense description is required." };
  }
  if (!amount || amount <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  const reference = `EXP-${Date.now()}`;

  const { error } = await supabase.from("expenses").insert({
    reference,
    description,
    category_id: categoryId,
    vendor,
    amount,
    payment_method: paymentMethod,
    branch_id: branchId,
    created_by: employee.id,
    status: "pending",
    is_recurring: isRecurring,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Expense added",
    module: "Expenses",
    record_reference: reference,
  });

  revalidatePath("/dashboard/expenses");
  return { ok: true };
}

export async function approveExpense(expenseId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "view_management_reports");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("expenses")
    .select("id, reference, status")
    .eq("id", expenseId)
    .maybeSingle();

  if (fetchError || !existing) {
    return { ok: false, error: "Expense not found." };
  }
  if (existing.status === "approved") {
    return { ok: false, error: "This expense is already approved." };
  }

  const { error: updateError } = await supabase.from("expenses").update({ status: "approved" }).eq("id", expenseId);
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Expense approved",
    module: "Expenses",
    record_reference: existing.reference,
  });

  revalidatePath("/dashboard/expenses");
  return { ok: true };
}
