"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { hashFile, parseSpreadsheet } from "@/lib/excel";
import {
  DUPLICATE_LABELS,
  revalidateImportRows,
  validateProductRows,
  type ProductImportRow,
  type RowError,
} from "@/lib/imports/products";
import type { ActionResult } from "@/lib/types";

export type ImportPreviewState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | {
      status: "preview";
      filename: string;
      fileHash: string;
      totalRows: number;
      validRows: number;
      invalidRows: number;
      duplicateRows: number;
      errors: RowError[];
      duplicates: Array<{ row: number; name: string; sku: string | null; label: string }>;
      /** Serialized valid rows, re-submitted verbatim on confirmation. */
      payload: string;
    }
  | { status: "committed"; drafts: number; skipped: number; filename: string };

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

/**
 * Step 1-6 of the import flow: validate the file, detect duplicates, and show
 * per-row errors with valid/invalid counts. Nothing is written to the database
 * here — the user must confirm.
 */
export async function previewProductImport(
  _prevState: ImportPreviewState | null,
  formData: FormData
): Promise<ImportPreviewState> {
  const employee = await requireUser();
  if (!employee.permissions.includes("import_products")) {
    return { status: "error", error: "You do not have permission to import products." };
  }
  const branchId = await getActiveEntityId();
  if (!branchId) return { status: "error", error: ENTITY_REQUIRED_ERROR };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "Choose a .xlsx or .csv file to import." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { status: "error", error: "The file is larger than 5 MB." };
  }
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".csv")) {
    return { status: "error", error: "Only .xlsx and .csv files are supported." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = hashFile(buffer);
  const supabase = await createClient();

  // Guard 1 of 2 against re-importing the same file (the unique index on
  // product_imports is the authoritative guard at commit time).
  const { data: previousImport } = await supabase
    .from("product_imports")
    .select("filename, created_at")
    .eq("branch_id", branchId)
    .eq("kind", "products")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (previousImport) {
    return {
      status: "error",
      error: `This exact file was already imported as "${previousImport.filename}" on ${previousImport.created_at.slice(0, 10)}. Importing it again is blocked.`,
    };
  }

  let sheet;
  try {
    sheet = await parseSpreadsheet(file);
  } catch {
    return { status: "error", error: "The file could not be read. Make sure it is a valid .xlsx or .csv file." };
  }

  if (sheet.rows.length === 0) {
    return { status: "error", error: "The file has no data rows." };
  }
  if (sheet.rows.length > MAX_ROWS) {
    return { status: "error", error: `The file has ${sheet.rows.length} rows; the limit is ${MAX_ROWS}.` };
  }

  const [{ data: products }, { data: drafts }] = await Promise.all([
    supabase.from("products").select("sku, name, barcode").eq("branch_id", branchId),
    supabase.from("draft_products").select("name").eq("branch_id", branchId).eq("status", "pending"),
  ]);

  const preview = validateProductRows(
    sheet,
    {
      skus: new Set((products ?? []).map((p) => p.sku.toLowerCase())),
      names: new Set((products ?? []).map((p) => p.name.toLowerCase())),
      barcodes: new Set((products ?? []).map((p) => p.barcode).filter((b): b is string => Boolean(b))),
    },
    new Set((drafts ?? []).map((d) => d.name.toLowerCase()))
  );

  if (preview.missingColumns.length > 0) {
    return {
      status: "error",
      error: `The file is missing required columns: ${preview.missingColumns.join(", ")}. Download the template and try again.`,
    };
  }

  return {
    status: "preview",
    filename: file.name,
    fileHash,
    totalRows: preview.totalRows,
    validRows: preview.valid.length,
    invalidRows: preview.errors.length,
    duplicateRows: preview.duplicates.length,
    errors: preview.errors,
    duplicates: preview.duplicates.map((duplicate) => ({
      row: duplicate.row,
      name: duplicate.name,
      sku: duplicate.sku,
      label: DUPLICATE_LABELS[duplicate.kind],
    })),
    payload: JSON.stringify(preview.valid),
  };
}

/**
 * Step 7-9: writes the confirmed rows into draft_products. Unknown products
 * enter Draft Products for review and only become active after confirmation,
 * so an import never silently creates sellable stock records.
 */
export async function commitProductImport(
  _prevState: ImportPreviewState | null,
  formData: FormData
): Promise<ImportPreviewState> {
  const employee = await requireUser();
  if (!employee.permissions.includes("import_products")) {
    return { status: "error", error: "You do not have permission to import products." };
  }
  const branchId = await getActiveEntityId();
  if (!branchId) return { status: "error", error: ENTITY_REQUIRED_ERROR };

  const filename = String(formData.get("filename") ?? "").trim();
  const fileHash = String(formData.get("file_hash") ?? "").trim();
  const payloadRaw = String(formData.get("payload") ?? "");
  const totalRows = Number(formData.get("total_rows") ?? 0);
  const invalidRows = Number(formData.get("invalid_rows") ?? 0);
  const errorsRaw = String(formData.get("errors") ?? "[]");

  if (!filename || !fileHash || !payloadRaw) {
    return { status: "error", error: "The import session expired. Upload the file again." };
  }

  let rows: ProductImportRow[];
  let errorReport: RowError[];
  try {
    rows = JSON.parse(payloadRaw) as ProductImportRow[];
    errorReport = JSON.parse(errorsRaw) as RowError[];
  } catch {
    return { status: "error", error: "The import session was malformed. Upload the file again." };
  }

  if (rows.length === 0) {
    return { status: "error", error: "There are no valid rows to import." };
  }
  if (rows.length > MAX_ROWS) {
    return { status: "error", error: `The import exceeds the ${MAX_ROWS}-row limit.` };
  }

  // The preview step ran in a previous request and returned this payload to the
  // browser, so by the time it comes back it is client-controlled input: the
  // rows, the counts and the file hash can all have been edited. Re-validate
  // every row here, otherwise the import rules are advisory and the duplicate
  // -file guard can be defeated by changing the hash.
  const revalidated = revalidateImportRows(rows);
  if (revalidated.invalid.length > 0) {
    const first = revalidated.invalid[0];
    return {
      status: "error",
      error: `Row ${first.row} failed validation on submit (${first.error}). Upload the file again.`,
    };
  }
  rows = revalidated.valid;

  const supabase = await createClient();

  // One transactional RPC writes the import record, the drafts and the audit
  // entry together. The unique index (branch_id, kind, file_hash) is what
  // actually prevents a double import, including two tabs confirming the same
  // file at once; because the whole commit is atomic, a failed import releases
  // that slot automatically and the file can be retried.
  const { error: commitError } = await supabase.rpc("erp_commit_product_import", {
    p_branch_id: branchId,
    p_filename: filename,
    p_file_hash: fileHash,
    p_total_rows: totalRows,
    p_invalid_rows: invalidRows,
    p_error_report: errorReport,
    p_drafts: rows,
  });

  if (commitError) {
    if (commitError.message.includes("duplicate")) {
      return { status: "error", error: "This file has already been imported into this entity." };
    }
    return { status: "error", error: commitError.message || "Could not record the import." };
  }

  revalidatePath("/dashboard/product-imports");
  revalidatePath("/dashboard/draft-products");
  revalidatePath("/dashboard/products");

  return { status: "committed", drafts: rows.length, skipped: invalidRows, filename };
}

/** Edits a pending draft before confirmation. */
export async function updateDraftProduct(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "import_products");
  if (denied) return denied;

  const draftId = String(formData.get("draft_id") ?? "");
  if (!draftId) return { ok: false, error: "Select a draft product." };

  const name = String(formData.get("name") ?? "").trim();
  const buyPrice = Number(formData.get("buy_price") ?? 0);
  const pricingMethod = String(formData.get("pricing_method") ?? "fixed");
  const marginPercent = Number(formData.get("margin_percent") ?? 0);
  const sellPrice = Number(formData.get("sell_price") ?? 0);
  const maxDiscountPercent = Number(formData.get("max_discount_percent") ?? 0);
  const reorderLevel = Number(formData.get("reorder_level") ?? 0);
  const restockTarget = Number(formData.get("restock_target") ?? 0);
  const imageUrl = String(formData.get("image_url") ?? "").trim() || null;
  const optional = (key: string) => String(formData.get(key) ?? "").trim() || null;

  if (!name) return { ok: false, error: "Product name is required." };
  if (pricingMethod !== "fixed" && pricingMethod !== "cost_plus_margin") {
    return { ok: false, error: "Select a valid pricing method." };
  }
  if (buyPrice < 0 || sellPrice < 0) return { ok: false, error: "Prices cannot be negative." };
  if (maxDiscountPercent < 0 || maxDiscountPercent > 100) {
    return { ok: false, error: "Max discount must be between 0 and 100." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("draft_products")
    .update({
      name,
      sku: optional("sku"),
      barcode: optional("barcode"),
      category_name: optional("category_name"),
      manufacturer: optional("manufacturer"),
      unit: optional("unit"),
      supplier_name: optional("supplier_name"),
      buy_price: buyPrice,
      pricing_method: pricingMethod,
      margin_percent: marginPercent,
      sell_price: sellPrice,
      max_discount_percent: maxDiscountPercent,
      reorder_level: reorderLevel,
      restock_target: restockTarget,
      image_url: imageUrl,
    })
    .eq("id", draftId)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/draft-products");
  return { ok: true };
}

/** Promotes a reviewed draft into a real, sellable product. */
export async function confirmDraftProduct(draftId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_products");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("draft_products")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();

  if (!draft) return { ok: false, error: "Draft product not found." };
  if (draft.status !== "pending") return { ok: false, error: "This draft has already been reviewed." };

  // Resolve the free-text category/supplier names against real records in the
  // same entity; unmatched names are simply left unset for later assignment.
  const [{ data: category }, { data: supplier }] = await Promise.all([
    draft.category_name
      ? supabase.from("categories").select("id").ilike("name", draft.category_name).maybeSingle()
      : Promise.resolve({ data: null }),
    draft.supplier_name
      ? supabase
          .from("suppliers")
          .select("id")
          .eq("branch_id", draft.branch_id)
          .ilike("name", draft.supplier_name)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sku = draft.sku?.trim() || `SKU-${Date.now().toString(36).toUpperCase()}`;

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      branch_id: draft.branch_id,
      sku,
      name: draft.name,
      barcode: draft.barcode,
      manufacturer: draft.manufacturer,
      unit: draft.unit,
      category_id: category?.id ?? null,
      supplier_id: supplier?.id ?? null,
      buy_price: draft.buy_price,
      sell_price: draft.sell_price,
      pricing_method: draft.pricing_method,
      margin_percent: draft.margin_percent,
      max_discount_percent: draft.max_discount_percent,
      reorder_level: draft.reorder_level,
      restock_target: draft.restock_target,
      image_url: draft.image_url,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !product) {
    return {
      ok: false,
      error: error?.message.includes("duplicate")
        ? "A product with that SKU already exists in this entity."
        : error?.message ?? "Could not create the product.",
    };
  }

  await supabase.from("product_price_history").insert([
    {
      product_id: product.id,
      branch_id: draft.branch_id,
      field: "buy_price",
      previous_value: null,
      new_value: String(draft.buy_price),
      change_type: "import_confirmed",
      changed_by: employee.id,
    },
    {
      product_id: product.id,
      branch_id: draft.branch_id,
      field: "sell_price",
      previous_value: null,
      new_value: String(draft.sell_price),
      change_type: "import_confirmed",
      changed_by: employee.id,
    },
  ]);

  await supabase
    .from("draft_products")
    .update({ status: "confirmed", reviewed_by: employee.id, reviewed_at: new Date().toISOString() })
    .eq("id", draftId);

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Draft product confirmed",
    module: "Products",
    record_reference: sku,
    new_value: JSON.stringify({ name: draft.name, sell_price: draft.sell_price }),
    branch_id: draft.branch_id,
  });

  revalidatePath("/dashboard/draft-products");
  revalidatePath("/dashboard/products");
  return { ok: true };
}

export async function rejectDraftProduct(draftId: string, reason?: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "import_products");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("draft_products")
    .select("id, name, status, branch_id")
    .eq("id", draftId)
    .maybeSingle();

  if (!draft) return { ok: false, error: "Draft product not found." };
  if (draft.status !== "pending") return { ok: false, error: "This draft has already been reviewed." };

  const { error } = await supabase
    .from("draft_products")
    .update({ status: "rejected", reviewed_by: employee.id, reviewed_at: new Date().toISOString() })
    .eq("id", draftId);

  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Draft product rejected",
    module: "Products",
    record_reference: draft.name,
    reason: reason ?? null,
    branch_id: draft.branch_id,
  });

  revalidatePath("/dashboard/draft-products");
  return { ok: true };
}

/** Links a duplicate draft to the product it duplicates and rejects it. */
export async function resolveDraftDuplicate(draftId: string, productId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "import_products");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("draft_products")
    .select("id, name, status, branch_id")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Draft product not found." };
  if (draft.status !== "pending") return { ok: false, error: "This draft has already been reviewed." };

  const { data: product } = await supabase
    .from("products")
    .select("id, sku")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return { ok: false, error: "Select an existing product to merge into." };

  const { error } = await supabase
    .from("draft_products")
    .update({
      duplicate_of: productId,
      status: "rejected",
      reviewed_by: employee.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", draftId);

  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Draft product resolved as duplicate",
    module: "Products",
    record_reference: draft.name,
    new_value: product.sku,
    branch_id: draft.branch_id,
  });

  revalidatePath("/dashboard/draft-products");
  return { ok: true };
}
