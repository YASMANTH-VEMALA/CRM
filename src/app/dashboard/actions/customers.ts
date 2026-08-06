"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { permissionError, requireUser } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { buildCustomerDocument, upsertEmbeddingBestEffort } from "@/lib/ai/embed";
import type { ActionResult } from "@/lib/types";

export async function addCustomer(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_sales");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const segment = String(formData.get("segment") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Customer name is required." };
  }

  const { data: inserted, error } = await supabase
    .from("customers")
    .insert({
      branch_id: branchId,
      name,
      phone: phone || null,
      address: address || null,
      segment: segment || null,
      loyalty_points: 0,
      credit_balance: 0,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Could not create customer." };
  }

  await supabase.from("audit_logs").insert({ action: "Customer added", module: "Customers", record_reference: name });

  // Best-effort — a failed embedding never blocks the customer record itself.
  // If/when updateCustomer is added, it needs the same call.
  after(() =>
    upsertEmbeddingBestEffort(
      "customers",
      inserted.id,
      buildCustomerDocument({ name, phone: phone || null, address: address || null, segment: segment || null }),
      { name, phone: phone || null },
      branchId
    )
  );

  revalidatePath("/dashboard/customers");
  revalidatePath("/dashboard");
  return { ok: true };
}
