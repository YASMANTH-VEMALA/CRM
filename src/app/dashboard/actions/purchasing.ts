"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

function generatePoNumber(): string {
  const year = new Date().getFullYear();
  return `PO-${year}-${String(Date.now()).slice(-6)}`;
}

// GRN and batch numbers are now issued inside erp_receive_purchase_order, off
// the shared document sequences, so two concurrent receipts cannot collide.

export async function createPurchaseOrder(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };
  const supabase = await createClient();

  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const expectedDate = String(formData.get("expected_date") ?? "") || null;
  const status = String(formData.get("status") ?? "draft");

  if (!supplierId) {
    return { ok: false, error: "Select a supplier." };
  }
  if (status !== "draft" && status !== "pending_approval") {
    return { ok: false, error: "Invalid order status." };
  }

  const items: { product_id: string; quantity: number; unit_cost: number }[] = [];
  for (let i = 1; i <= 4; i++) {
    const productId = String(formData.get(`product_id_${i}`) ?? "");
    const quantity = Number(formData.get(`quantity_${i}`) ?? 0);
    const unitCost = Number(formData.get(`unit_cost_${i}`) ?? 0);
    if (!productId || quantity <= 0) continue;
    items.push({ product_id: productId, quantity, unit_cost: unitCost });
  }

  if (items.length === 0) {
    return { ok: false, error: "Add at least one line item with a product and quantity." };
  }

  const total = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
  const poNumber = generatePoNumber();

  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      supplier_id: supplierId,
      created_by: employee.id,
      branch_id: branchId,
      status,
      expected_date: expectedDate,
      total,
    })
    .select("id")
    .single();

  if (poError || !po) {
    return { ok: false, error: poError?.message ?? "Could not create the purchase order." };
  }

  const { error: itemsError } = await supabase.from("purchase_order_items").insert(
    items.map((item) => ({
      po_id: po.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
    }))
  );

  if (itemsError) {
    await supabase.from("purchase_orders").delete().eq("id", po.id);
    return { ok: false, error: itemsError.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: status === "draft" ? "Purchase order created (draft)" : "Purchase order submitted for approval",
    module: "Purchasing",
    record_reference: poNumber,
    branch_id: branchId,
  });

  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function approvePurchaseOrder(poId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, branch_id")
    .eq("id", poId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "Purchase order not found." };
  }
  if (existing.status !== "draft" && existing.status !== "pending_approval") {
    return { ok: false, error: "Only draft or pending orders can be approved." };
  }

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .update({ status: "approved" })
    .eq("id", poId)
    .select("po_number")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!po) {
    return { ok: false, error: "Purchase order not found." };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Purchase order approved",
    module: "Purchasing",
    record_reference: po.po_number,
    previous_value: existing.status,
    new_value: "approved",
    branch_id: existing.branch_id,
  });

  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function receiveStock(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const supabase = await createClient();

  const poId = String(formData.get("po_id") ?? "");
  const supplierInvoiceNumber = String(formData.get("supplier_invoice_number") ?? "").trim() || null;

  if (!poId) {
    return { ok: false, error: "Select a purchase order to receive against." };
  }

  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, supplier_id, branch_id, purchase_order_items(product_id, quantity, unit_cost)")
    .eq("id", poId)
    .maybeSingle();

  if (poError || !po) {
    return { ok: false, error: poError?.message ?? "Purchase order not found." };
  }
  if (po.status !== "approved" && po.status !== "partially_received") {
    return { ok: false, error: "This purchase order is not eligible to receive stock against." };
  }

  const poItems = (po.purchase_order_items as { product_id: string; quantity: number; unit_cost: number }[] | null) ?? [];
  if (poItems.length === 0) {
    return { ok: false, error: "This purchase order has no line items." };
  }

  type ReceiptLine = {
    product_id: string;
    quantity_ordered: number;
    quantity_received: number;
    unit_cost: number;
    damaged_qty: number;
  };
  const lines: ReceiptLine[] = [];

  for (const item of poItems) {
    const quantityReceived = Number(formData.get(`quantity_received_${item.product_id}`) ?? 0);
    const unitCost = Number(formData.get(`unit_cost_${item.product_id}`) ?? item.unit_cost);
    const damagedQty = Math.max(0, Number(formData.get(`damaged_qty_${item.product_id}`) ?? 0));
    if (quantityReceived <= 0) continue;
    lines.push({
      product_id: item.product_id,
      quantity_ordered: item.quantity,
      quantity_received: quantityReceived,
      unit_cost: unitCost,
      damaged_qty: damagedQty,
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: "Enter a received quantity for at least one product." };
  }

  // One transactional RPC creates the GRN, its batches, its line items and the
  // ledger movements together, and rolls the purchase order forward. The
  // previous version issued a dozen separate writes and inserted ledger rows
  // from application code, which is no longer permitted.
  const { error: receiveError } = await supabase.rpc("erp_receive_purchase_order", {
    p_po_id: poId,
    p_supplier_invoice: supplierInvoiceNumber,
    p_lines: lines,
  });

  if (receiveError) {
    return { ok: false, error: receiveError.message };
  }
  revalidatePath("/dashboard/received-orders");
  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { ok: true };
}
