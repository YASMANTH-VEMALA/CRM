"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { parseSpreadsheet } from "@/lib/excel";
import { parseSheetNumber, parseSheetText } from "@/lib/spreadsheet";
import type { ActionResult } from "@/lib/types";

function revalidateOpeningPaths() {
  revalidatePath("/dashboard/opening-stock");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/stock-ledger");
  revalidatePath("/dashboard");
}

type OpeningLine = {
  productId: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: number;
  unitCost: number;
  sellPrice: number | null;
};

function readLines(formData: FormData): OpeningLine[] | { error: string } {
  const lines: OpeningLine[] = [];
  const indexes = new Set<string>();
  for (const key of formData.keys()) {
    const match = /^line_(\d+)_/.exec(key);
    if (match) indexes.add(match[1]);
  }

  for (const index of [...indexes].sort((a, b) => Number(a) - Number(b))) {
    const productId = String(formData.get(`line_${index}_product_id`) ?? "").trim();
    const batchNumber = String(formData.get(`line_${index}_batch_number`) ?? "").trim();
    const quantity = Number(formData.get(`line_${index}_quantity`) ?? 0);
    const unitCost = Number(formData.get(`line_${index}_unit_cost`) ?? 0);
    const sellPriceRaw = String(formData.get(`line_${index}_sell_price`) ?? "").trim();
    const expiryDate = String(formData.get(`line_${index}_expiry_date`) ?? "").trim() || null;

    if (!productId && !batchNumber && !quantity) continue;

    const label = `Line ${Number(index) + 1}`;
    if (!productId) return { error: `${label}: select a product.` };
    if (!batchNumber) return { error: `${label}: a batch number is required.` };
    if (quantity <= 0) return { error: `${label}: quantity must be greater than zero.` };
    if (unitCost < 0) return { error: `${label}: purchase cost cannot be negative.` };

    lines.push({
      productId,
      batchNumber,
      expiryDate,
      quantity,
      unitCost,
      sellPrice: sellPriceRaw ? Number(sellPriceRaw) : null,
    });
  }

  if (lines.length === 0) return { error: "Add at least one line item." };
  return lines;
}

/** Creates a draft opening-stock entry. Nothing enters inventory until confirmed. */
export async function createOpeningStock(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };

  const openingDate = String(formData.get("opening_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!openingDate) return { ok: false, error: "An opening date is required." };

  const parsed = readLines(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: reference, error: refError } = await supabase.rpc("next_doc_number", {
    p_prefix: "OPEN",
    p_seq: "doc_seq_opening",
  });
  if (refError || !reference) {
    return { ok: false, error: refError?.message ?? "Could not generate a reference." };
  }

  const { data: entry, error } = await supabase
    .from("opening_stock_entries")
    .insert({
      reference,
      branch_id: branchId,
      opening_date: openingDate,
      notes,
      status: "draft",
      created_by: employee.id,
    })
    .select("id")
    .single();

  if (error || !entry) {
    return { ok: false, error: error?.message ?? "Could not create the opening stock entry." };
  }

  const { error: itemsError } = await supabase.from("opening_stock_items").insert(
    parsed.map((line) => ({
      entry_id: entry.id,
      product_id: line.productId,
      batch_number: line.batchNumber,
      expiry_date: line.expiryDate,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      sell_price: line.sellPrice,
    }))
  );

  if (itemsError) {
    await supabase.from("opening_stock_entries").delete().eq("id", entry.id);
    return { ok: false, error: itemsError.message };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Opening stock drafted",
    module: "Inventory",
    record_reference: reference,
    branch_id: branchId,
  });

  revalidateOpeningPaths();
  return { ok: true };
}

/**
 * Confirms the entry, creating batches and OPENING_STOCK ledger movements.
 * Confirmed entries are locked: corrections go through a stock correction,
 * which requires the adjust_inventory permission, a reason and an audit row.
 */
export async function confirmOpeningStock(entryId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("erp_confirm_opening_stock", { p_id: entryId });
  if (error) return { ok: false, error: error.message || "Could not confirm the opening stock." };

  revalidateOpeningPaths();
  return { ok: true };
}

export async function cancelOpeningStock(entryId: string, reason?: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_stock_inward");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("opening_stock_entries")
    .select("id, reference, status, branch_id")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) return { ok: false, error: "Entry not found." };
  if (entry.status !== "draft") {
    return {
      ok: false,
      error: "Confirmed opening stock cannot be cancelled. Use a stock correction instead.",
    };
  }

  const { error } = await supabase
    .from("opening_stock_entries")
    .update({ status: "cancelled" })
    .eq("id", entryId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Opening stock cancelled",
    module: "Inventory",
    record_reference: entry.reference,
    reason: reason ?? null,
    branch_id: entry.branch_id,
  });

  revalidateOpeningPaths();
  return { ok: true };
}

export type OpeningImportState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "loaded"; lines: number; reference: string };

/** Bulk-adds opening-stock lines from a spreadsheet into an existing draft. */
export async function importOpeningStockLines(
  _prevState: OpeningImportState | null,
  formData: FormData
): Promise<OpeningImportState> {
  const employee = await requireUser();
  if (!employee.permissions.includes("create_stock_inward")) {
    return { status: "error", error: "You do not have permission to enter opening stock." };
  }

  const entryId = String(formData.get("entry_id") ?? "");
  const file = formData.get("file");
  if (!entryId) return { status: "error", error: "Select the draft entry to import into." };
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "Choose a .xlsx or .csv file." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { status: "error", error: "The file is larger than 5 MB." };
  }

  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("opening_stock_entries")
    .select("id, reference, status, branch_id")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) return { status: "error", error: "Entry not found." };
  if (entry.status !== "draft") {
    return { status: "error", error: "Only draft entries can be edited." };
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
    .eq("branch_id", entry.branch_id);
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
    const quantity = parseSheetNumber(raw.quantity);
    if (quantity === null || quantity <= 0) {
      errors.push(`Row ${rowNumber}: quantity must be greater than zero.`);
      return;
    }
    const unitCost = parseSheetNumber(raw.purchase_cost);
    if (unitCost === null || unitCost < 0) {
      errors.push(`Row ${rowNumber}: purchase cost is required.`);
      return;
    }

    lines.push({
      entry_id: entryId,
      product_id: productId,
      batch_number: batchNumber,
      expiry_date: parseSheetText(raw.expiry_date),
      quantity,
      unit_cost: unitCost,
      sell_price: parseSheetNumber(raw.selling_price),
    });
  });

  // All-or-nothing: opening stock sets the baseline for every later balance,
  // so a silently partial import would be very hard to detect afterwards.
  if (errors.length > 0) {
    return {
      status: "error",
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} could not be read, so nothing was imported. ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? " …" : ""}`,
    };
  }

  const { error } = await supabase.from("opening_stock_items").insert(lines);
  if (error) return { status: "error", error: error.message };

  revalidateOpeningPaths();
  return { status: "loaded", lines: lines.length, reference: entry.reference };
}
