"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { parseSpreadsheet } from "@/lib/excel";
import { parseSheetNumber, parseSheetText } from "@/lib/spreadsheet";
import type { ActionResult, StockInwardType } from "@/lib/types";

const INWARD_TYPES: StockInwardType[] = [
  "purchase_from_parent",
  "purchase_from_external",
  "foc_or_sample",
  "replacement_in",
];

function isInwardType(value: string): value is StockInwardType {
  return (INWARD_TYPES as string[]).includes(value);
}

function revalidateInwardPaths() {
  revalidatePath("/dashboard/stock-inward");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/stock-ledger");
  revalidatePath("/dashboard");
}

type LineInput = {
  productId: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: number;
  freeQuantity: number;
  unitCost: number;
};

/**
 * Reads the repeating line-item fields. The form renders a variable number of
 * rows named line_<index>_<field>; blank rows are skipped.
 */
function readLines(formData: FormData): LineInput[] | { error: string } {
  const lines: LineInput[] = [];
  const indexes = new Set<string>();
  for (const key of formData.keys()) {
    const match = /^line_(\d+)_/.exec(key);
    if (match) indexes.add(match[1]);
  }

  for (const index of [...indexes].sort((a, b) => Number(a) - Number(b))) {
    const productId = String(formData.get(`line_${index}_product_id`) ?? "").trim();
    const batchNumber = String(formData.get(`line_${index}_batch_number`) ?? "").trim();
    const quantity = Number(formData.get(`line_${index}_quantity`) ?? 0);
    const freeQuantity = Number(formData.get(`line_${index}_free_quantity`) ?? 0);
    const unitCost = Number(formData.get(`line_${index}_unit_cost`) ?? 0);
    const expiryDate = String(formData.get(`line_${index}_expiry_date`) ?? "").trim() || null;

    if (!productId && !batchNumber && !quantity && !freeQuantity) continue;

    if (!productId) return { error: `Line ${Number(index) + 1}: select a product.` };
    if (!batchNumber) return { error: `Line ${Number(index) + 1}: a batch number is required.` };
    if (quantity < 0 || freeQuantity < 0) {
      return { error: `Line ${Number(index) + 1}: quantities cannot be negative.` };
    }
    if (quantity + freeQuantity <= 0) {
      return { error: `Line ${Number(index) + 1}: enter a received or free quantity.` };
    }
    if (unitCost < 0) return { error: `Line ${Number(index) + 1}: unit cost cannot be negative.` };

    lines.push({ productId, batchNumber, expiryDate, quantity, freeQuantity, unitCost });
  }

  if (lines.length === 0) return { error: "Add at least one line item." };
  return lines;
}

/** Creates a stock-inward document in draft. Stock only moves on confirmation. */
export async function createStockInward(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };

  const inwardType = String(formData.get("inward_type") ?? "").trim();
  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim() || null;
  const invoiceDate = String(formData.get("invoice_date") ?? "") || null;
  const supplierReturnId = String(formData.get("supplier_return_id") ?? "") || null;
  const documentUrl = String(formData.get("document_url") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!isInwardType(inwardType)) {
    return { ok: false, error: "Select a valid inward type." };
  }
  if (inwardType !== "foc_or_sample" && !supplierId) {
    return { ok: false, error: "Select the supplier this stock came from." };
  }

  const parsed = readLines(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: reference, error: refError } = await supabase.rpc("next_doc_number", {
    p_prefix: "IN",
    p_seq: "doc_seq_inward",
  });
  if (refError || !reference) {
    return { ok: false, error: refError?.message ?? "Could not generate a reference." };
  }

  const { data: doc, error } = await supabase
    .from("stock_inwards")
    .insert({
      reference,
      branch_id: branchId,
      supplier_id: supplierId,
      inward_type: inwardType,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      supplier_return_id: inwardType === "replacement_in" ? supplierReturnId : null,
      document_url: documentUrl,
      notes,
      status: "draft",
      created_by: employee.id,
    })
    .select("id")
    .single();

  if (error || !doc) {
    if (error?.message.includes("stock_inwards_invoice_unique")) {
      return {
        ok: false,
        error: "That invoice number has already been recorded for this supplier in this entity.",
      };
    }
    return { ok: false, error: error?.message ?? "Could not create the document." };
  }

  const { error: itemsError } = await supabase.from("stock_inward_items").insert(
    parsed.map((line) => ({
      inward_id: doc.id,
      product_id: line.productId,
      batch_number: line.batchNumber,
      expiry_date: line.expiryDate,
      quantity: line.quantity,
      free_quantity: line.freeQuantity,
      unit_cost: line.unitCost,
    }))
  );

  if (itemsError) {
    // The draft has moved no stock, so removing it is safe and keeps the
    // invoice number available for a corrected retry.
    await supabase.from("stock_inwards").delete().eq("id", doc.id);
    return { ok: false, error: itemsError.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Stock inward drafted",
    module: "Inventory",
    record_reference: reference,
    branch_id: branchId,
  });

  revalidateInwardPaths();
  return { ok: true };
}

/** Confirms a draft: creates batches and ledger movements in one transaction. */
export async function confirmStockInward(inwardId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("erp_confirm_stock_inward", { p_id: inwardId });
  if (error) return { ok: false, error: error.message || "Could not confirm the document." };

  revalidateInwardPaths();
  return { ok: true };
}

export async function cancelStockInward(inwardId: string, reason?: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("stock_inwards")
    .select("id, reference, status, branch_id")
    .eq("id", inwardId)
    .maybeSingle();

  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status !== "draft") {
    return { ok: false, error: "Only draft documents can be cancelled. Confirmed stock must be reversed instead." };
  }

  const { error } = await supabase
    .from("stock_inwards")
    .update({ status: "cancelled" })
    .eq("id", inwardId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Stock inward cancelled",
    module: "Inventory",
    record_reference: doc.reference,
    reason: reason ?? null,
    branch_id: doc.branch_id,
  });

  revalidateInwardPaths();
  return { ok: true };
}

export type InwardImportState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "loaded"; lines: number; reference: string };

/**
 * Bulk-adds line items to an existing draft from a spreadsheet. Rows are
 * validated against the entity's real SKUs before anything is written, and
 * the document still requires confirmation before stock moves.
 */
export async function importInwardLines(
  _prevState: InwardImportState | null,
  formData: FormData
): Promise<InwardImportState> {
  const employee = await requireUser();
  if (!employee.permissions.includes("create_stock_inward")) {
    return { status: "error", error: "You do not have permission to add stock inward." };
  }

  const inwardId = String(formData.get("inward_id") ?? "");
  const file = formData.get("file");
  if (!inwardId) return { status: "error", error: "Select the draft document to import into." };
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "Choose a .xlsx or .csv file." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { status: "error", error: "The file is larger than 5 MB." };
  }

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("stock_inwards")
    .select("id, reference, status, branch_id")
    .eq("id", inwardId)
    .maybeSingle();

  if (!doc) return { status: "error", error: "Document not found." };
  if (doc.status !== "draft") {
    return { status: "error", error: "Only draft documents can be edited." };
  }

  let sheet;
  try {
    sheet = await parseSpreadsheet(file);
  } catch {
    return { status: "error", error: "The file could not be read." };
  }
  if (sheet.rows.length === 0) return { status: "error", error: "The file has no data rows." };

  const { data: products } = await supabase
    .from("products")
    .select("id, sku")
    .eq("branch_id", doc.branch_id);
  const bySku = new Map((products ?? []).map((p) => [p.sku.toLowerCase(), p.id]));

  const lines: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  sheet.rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const sku = parseSheetText(raw.sku);
    if (!sku) {
      errors.push(`Row ${rowNumber}: SKU is required.`);
      return;
    }
    const productId = bySku.get(sku.toLowerCase());
    if (!productId) {
      errors.push(`Row ${rowNumber}: no product with SKU "${sku}" in this entity.`);
      return;
    }
    const batchNumber = parseSheetText(raw.batch_number);
    if (!batchNumber) {
      errors.push(`Row ${rowNumber}: a batch number is required.`);
      return;
    }
    const quantity = parseSheetNumber(raw.quantity) ?? 0;
    const freeQuantity = parseSheetNumber(raw.free_quantity) ?? 0;
    const unitCost = parseSheetNumber(raw.unit_cost);
    if (unitCost === null) {
      errors.push(`Row ${rowNumber}: unit cost is required.`);
      return;
    }
    if (quantity < 0 || freeQuantity < 0 || unitCost < 0) {
      errors.push(`Row ${rowNumber}: values cannot be negative.`);
      return;
    }
    if (quantity + freeQuantity <= 0) {
      errors.push(`Row ${rowNumber}: enter a received or free quantity.`);
      return;
    }

    lines.push({
      inward_id: inwardId,
      product_id: productId,
      batch_number: batchNumber,
      expiry_date: parseSheetText(raw.expiry_date),
      quantity,
      free_quantity: freeQuantity,
      unit_cost: unitCost,
    });
  });

  // All-or-nothing: a partially imported document would be confirmed with
  // missing stock and no obvious sign that rows were dropped.
  if (errors.length > 0) {
    return {
      status: "error",
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} could not be read, so nothing was imported. ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? " …" : ""}`,
    };
  }

  const { error } = await supabase.from("stock_inward_items").insert(lines);
  if (error) return { status: "error", error: error.message };

  revalidateInwardPaths();
  return { status: "loaded", lines: lines.length, reference: doc.reference };
}
