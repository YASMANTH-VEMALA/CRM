"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { buildSupplierDocument, upsertEmbeddingBestEffort } from "@/lib/ai/embed";
import type { ActionResult } from "@/lib/types";

export async function addSupplier(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "manage_suppliers");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const paymentTerms = String(formData.get("payment_terms") ?? "").trim();
  const leadTimeRaw = String(formData.get("lead_time_days") ?? "").trim();
  const leadTimeDays = leadTimeRaw ? Number(leadTimeRaw) : null;
  const isActive = formData.get("is_active") === "on";
  const supplierType = String(formData.get("supplier_type") ?? "external");
  const email = String(formData.get("email") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const taxId = String(formData.get("tax_id") ?? "").trim();
  const registrationNumber = String(formData.get("registration_number") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Supplier name is required." };
  }
  if (supplierType !== "parent" && supplierType !== "external") {
    return { ok: false, error: "Select a valid supplier type." };
  }

  const { data: inserted, error } = await supabase
    .from("suppliers")
    .insert({
      branch_id: branchId,
      name,
      supplier_type: supplierType,
      contact_name: contactName || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      tax_id: taxId || null,
      registration_number: registrationNumber || null,
      payment_terms: paymentTerms || null,
      lead_time_days: leadTimeDays,
      is_active: isActive,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Could not create supplier." };
  }

  await supabase.from("audit_logs").insert({ action: "Supplier added", module: "Suppliers", record_reference: name });

  // Best-effort — a failed embedding never blocks the supplier record itself.
  // If/when updateSupplier is added, it needs the same call.
  after(() =>
    upsertEmbeddingBestEffort(
      "suppliers",
      inserted.id,
      buildSupplierDocument({
        name,
        contact_name: contactName || null,
        phone: phone || null,
        payment_terms: paymentTerms || null,
        lead_time_days: leadTimeDays,
      }),
      { name },
      branchId
    )
  );

  revalidatePath("/dashboard/suppliers");
  revalidatePath("/dashboard");
  return { ok: true };
}
