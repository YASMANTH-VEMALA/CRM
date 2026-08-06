"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import type { PharmacyProfile, SettingsToggles } from "@/lib/data/settings";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TOGGLE_KEYS = [
  "prevent_expired_sales",
  "use_fefo",
  "require_reversal_approval",
  "send_low_stock_alerts",
  "detailed_audit_history",
  "auto_backup_schedule",
] as const;

// Global settings rows always have branch_id = null. Postgres treats NULL as
// distinct from NULL for uniqueness purposes, so `.upsert(..., { onConflict:
// "branch_id,key" })` can't detect a "conflict" against an existing null-branch
// row — it would just insert a duplicate instead of updating. Doing an
// explicit read-then-write avoids that gotcha and is a real update-if-exists.
async function upsertGlobalSetting(
  supabase: SupabaseServerClient,
  key: string,
  value: Record<string, unknown>
): Promise<string | null> {
  const { data: existing, error: selectError } = await supabase
    .from("settings")
    .select("id")
    .is("branch_id", null)
    .eq("key", key)
    .maybeSingle();

  if (selectError) return selectError.message;

  if (existing) {
    const { error } = await supabase
      .from("settings")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return error?.message ?? null;
  }

  const { error } = await supabase.from("settings").insert({ branch_id: null, key, value });
  return error?.message ?? null;
}

export async function saveSettings(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "manage_settings");
  if (denied) return denied;
  // Global settings rows (branch_id null) are master-only, enforced by RLS too.
  if (!employee.isMaster) {
    return { ok: false, error: "Only the master administrator can change global settings." };
  }
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim();
  const tax_mode = String(formData.get("tax_mode") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Pharmacy name is required." };
  }

  const pharmacyProfile: PharmacyProfile = { name, email, phone, address, currency, tax_mode };

  // Unchecked checkboxes are simply absent from FormData, so presence == checked.
  const toggles = Object.fromEntries(
    TOGGLE_KEYS.map((key) => [key, formData.has(key)])
  ) as unknown as SettingsToggles;

  const profileError = await upsertGlobalSetting(supabase, "pharmacy_profile", pharmacyProfile);
  if (profileError) {
    return { ok: false, error: profileError };
  }

  const togglesError = await upsertGlobalSetting(supabase, "toggles", toggles);
  if (togglesError) {
    return { ok: false, error: togglesError };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Settings updated",
    module: "Settings",
    branch_id: employee.branch_id,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
