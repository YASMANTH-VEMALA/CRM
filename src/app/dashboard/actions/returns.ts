"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const RETURN_TYPES = ["customer", "supplier", "damaged", "expired", "employee_consumption"] as const;
type ReturnType = (typeof RETURN_TYPES)[number];

const RESOLUTION_TYPES = ["credit", "refund", "replacement"] as const;

function isReturnType(value: string): value is ReturnType {
  return (RETURN_TYPES as readonly string[]).includes(value);
}

export async function createReturn(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_outward");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };
  const supabase = await createClient();

  const type = String(formData.get("type") ?? "").trim();
  const originalSaleId = String(formData.get("original_sale_id") ?? "") || null;
  const originalPoId = String(formData.get("original_po_id") ?? "") || null;
  const productId = String(formData.get("product_id") ?? "") || null;
  const batchId = String(formData.get("batch_id") ?? "") || null;
  const quantity = Number(formData.get("quantity") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const refundMethod = String(formData.get("refund_method") ?? "").trim() || null;
  const resolutionType = String(formData.get("resolution_type") ?? "").trim() || null;
  const consumedBy = String(formData.get("consumed_by") ?? "") || null;
  const expiryDate = String(formData.get("expiry_date") ?? "") || null;

  if (!isReturnType(type)) {
    return { ok: false, error: "Select a valid record type." };
  }
  if (!productId) {
    return { ok: false, error: "Select the product." };
  }
  if (!batchId) {
    return { ok: false, error: "Select the batch this stock comes from." };
  }
  if (!quantity || quantity <= 0) {
    return { ok: false, error: "Quantity must be greater than zero." };
  }
  if (!reason) {
    return { ok: false, error: "A reason is required." };
  }
  if (type === "supplier" && resolutionType && !(RESOLUTION_TYPES as readonly string[]).includes(resolutionType)) {
    return { ok: false, error: "Select a valid resolution type." };
  }
  if (type === "employee_consumption" && !consumedBy) {
    return { ok: false, error: "Select the employee consuming the stock." };
  }

  const reference = `RET-${Date.now()}`;

  const { error } = await supabase.from("returns").insert({
    reference,
    type,
    branch_id: branchId,
    original_sale_id: type === "customer" ? originalSaleId : null,
    original_po_id: type === "supplier" ? originalPoId : null,
    product_id: productId,
    batch_id: batchId,
    quantity,
    reason,
    refund_method: type === "customer" ? refundMethod : null,
    resolution_type: type === "supplier" ? resolutionType : null,
    consumed_by: type === "employee_consumption" ? consumedBy : null,
    expiry_date: type === "expired" ? expiryDate : null,
    requested_by: employee.id,
    status: "pending",
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: `Stock-out requested (${type})`,
    module: "Returns",
    record_reference: reference,
    branch_id: branchId,
  });

  revalidatePath("/dashboard/returns");
  return { ok: true };
}

export async function approveReturn(returnId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "approve_stock_outward");
  if (denied) return denied;
  const supabase = await createClient();

  // Transactional RPC: locks the batch, blocks negative stock, writes the
  // ledger movement (supplier_return / damage / expiry / employee_consumption
  // / customer return) and the audit record atomically.
  const { error } = await supabase.rpc("erp_approve_stock_out", { p_return_id: returnId });
  if (error) {
    return { ok: false, error: error.message || "Could not approve this record." };
  }

  revalidatePath("/dashboard/returns");
  revalidatePath("/dashboard/inventory");
  return { ok: true };
}

export async function rejectReturn(returnId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "approve_stock_outward");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("returns")
    .select("id, reference, status, branch_id")
    .eq("id", returnId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Record not found." };
  if (existing.status !== "pending") {
    return { ok: false, error: "Only pending records can be rejected." };
  }

  const { error } = await supabase.from("returns").update({ status: "rejected" }).eq("id", returnId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Stock-out rejected",
    module: "Returns",
    record_reference: existing.reference,
    branch_id: existing.branch_id,
  });

  revalidatePath("/dashboard/returns");
  return { ok: true };
}
