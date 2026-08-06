"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

function revalidateInventoryPaths() {
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/sales");
}

export async function adjustStock(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "adjust_inventory");
  if (denied) return denied;
  const supabase = await createClient();

  const batchId = String(formData.get("batch_id") ?? "");
  const delta = Number(formData.get("delta") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!batchId || !delta) {
    return { ok: false, error: "Select a batch and enter a non-zero adjustment." };
  }
  if (!reason) {
    return { ok: false, error: "A reason is required for stock corrections." };
  }

  const { data: batch } = await supabase
    .from("product_batches")
    .select("id, quantity_available")
    .eq("id", batchId)
    .single();

  if (!batch) return { ok: false, error: "Batch not found." };

  // Transactional RPC: re-locks the batch, enforces the adjust_inventory
  // permission and non-negative stock, writes ledger + audit atomically.
  const { error } = await supabase.rpc("erp_stock_correction", {
    p_batch_id: batchId,
    p_new_qty: batch.quantity_available + delta,
    p_reason: reason,
  });

  if (error) return { ok: false, error: error.message };

  revalidateInventoryPaths();
  return { ok: true };
}

export async function transferStock(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "adjust_inventory");
  if (denied) return denied;
  const supabase = await createClient();

  const batchId = String(formData.get("batch_id") ?? "");
  const toBranchId = String(formData.get("to_branch_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);

  if (!batchId || !toBranchId || quantity <= 0) {
    return { ok: false, error: "Select a batch, destination entity, and a positive quantity." };
  }

  // One transactional RPC moves the stock and writes both ledger legs. The
  // previous version created the destination batch, decremented the source and
  // inserted two ledger rows as four separate statements, any of which could
  // fail on its own; application code can no longer write the ledger at all.
  const { error } = await supabase.rpc("erp_transfer_stock", {
    p_batch_id: batchId,
    p_to_branch: toBranchId,
    p_quantity: quantity,
  });

  if (error) return { ok: false, error: error.message };

  revalidateInventoryPaths();
  return { ok: true };
}
export async function submitStockCount(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "adjust_inventory");
  if (denied) return denied;
  const supabase = await createClient();

  const branchId = String(formData.get("branch_id") ?? "") || null;
  const batchId = String(formData.get("batch_id") ?? "");
  const countedQty = Number(formData.get("counted_qty") ?? -1);

  if (!batchId || countedQty < 0) {
    return { ok: false, error: "Select a batch and enter the counted quantity." };
  }

  const { data: batch } = await supabase.from("product_batches").select("*").eq("id", batchId).single();
  if (!batch) return { ok: false, error: "Batch not found." };

  const reference = `SC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;
  const { data: count, error: countError } = await supabase
    .from("stock_counts")
    .insert({ reference, branch_id: branchId ?? batch.branch_id, status: "completed", created_by: employee.id })
    .select("id")
    .single();

  if (countError || !count) return { ok: false, error: countError?.message ?? "Could not start the stock count." };

  await supabase.from("stock_count_items").insert({
    stock_count_id: count.id,
    product_id: batch.product_id,
    batch_id: batch.id,
    expected_qty: batch.quantity_available,
    counted_qty: countedQty,
  });

  const variance = countedQty - batch.quantity_available;
  if (variance !== 0) {
    // The correction itself runs through the transactional RPC (ledger +
    // audit + permission enforcement).
    const { error } = await supabase.rpc("erp_stock_correction", {
      p_batch_id: batchId,
      p_new_qty: countedQty,
      p_reason: `Stock count ${reference}`,
    });
    if (error) return { ok: false, error: error.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Stock count completed",
    module: "Inventory",
    record_reference: reference,
    previous_value: String(batch.quantity_available),
    new_value: String(countedQty),
    branch_id: batch.branch_id,
  });

  revalidateInventoryPaths();
  return { ok: true };
}
