"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

function revalidateEntityPaths() {
  revalidatePath("/dashboard/entities");
  revalidatePath("/dashboard");
}

type EntityFields = {
  name: string;
  code: string;
  registeredName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  location: string | null;
  managerName: string | null;
  currency: string;
  timezone: string;
};

function readEntityForm(formData: FormData): EntityFields | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase() || "TZS";
  const timezone = String(formData.get("timezone") ?? "").trim() || "Africa/Dar_es_Salaam";

  if (!name) return { error: "Entity name is required." };
  if (!code) return { error: "Entity code is required." };
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) {
    return { error: "Entity code must be 2-20 characters: letters, numbers or hyphens." };
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: "Currency must be a three-letter code, for example TZS." };
  }

  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;

  return {
    name,
    code,
    registeredName: text("registered_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    location: text("location"),
    managerName: text("manager_name"),
    currency,
    timezone,
  };
}

export async function createEntity(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "manage_entities");
  if (denied) return denied;

  const parsed = readEntityForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: entity, error } = await supabase
    .from("branches")
    .insert({
      name: parsed.name,
      code: parsed.code,
      registered_name: parsed.registeredName,
      phone: parsed.phone,
      email: parsed.email,
      address: parsed.address,
      location: parsed.location,
      manager_name: parsed.managerName,
      currency: parsed.currency,
      timezone: parsed.timezone,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !entity) {
    return {
      ok: false,
      error: error?.message.includes("duplicate")
        ? "That entity code is already in use."
        : error?.message ?? "Could not create the entity.",
    };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Entity created",
    module: "Entities",
    record_reference: parsed.code,
    new_value: JSON.stringify({ name: parsed.name, currency: parsed.currency }),
    branch_id: entity.id,
  });

  revalidateEntityPaths();
  return { ok: true };
}

export async function updateEntity(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "manage_entities");
  if (denied) return denied;

  const entityId = String(formData.get("entity_id") ?? "");
  if (!entityId) return { ok: false, error: "Select an entity to edit." };

  const parsed = readEntityForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("branches")
    .select("id, name, code, currency, timezone")
    .eq("id", entityId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Entity not found." };

  const { error } = await supabase
    .from("branches")
    .update({
      name: parsed.name,
      code: parsed.code,
      registered_name: parsed.registeredName,
      phone: parsed.phone,
      email: parsed.email,
      address: parsed.address,
      location: parsed.location,
      manager_name: parsed.managerName,
      currency: parsed.currency,
      timezone: parsed.timezone,
    })
    .eq("id", entityId);

  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate")
        ? "That entity code is already in use."
        : error.message,
    };
  }

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Entity updated",
    module: "Entities",
    record_reference: parsed.code,
    previous_value: JSON.stringify({
      name: existing.name,
      code: existing.code,
      currency: existing.currency,
    }),
    new_value: JSON.stringify({
      name: parsed.name,
      code: parsed.code,
      currency: parsed.currency,
    }),
    branch_id: entityId,
  });

  revalidateEntityPaths();
  return { ok: true };
}

export async function setEntityStatus(entityId: string, isActive: boolean): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "manage_entities");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: entity } = await supabase
    .from("branches")
    .select("id, name, code, is_active")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) return { ok: false, error: "Entity not found." };
  if (entity.is_active === isActive) {
    return { ok: false, error: `This entity is already ${isActive ? "active" : "inactive"}.` };
  }

  if (!isActive) {
    // Deactivating hides an entity from day-to-day operation but never
    // deletes its history, so the numbers stay auditable.
    const { count } = await supabase
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "At least one entity must stay active." };
    }
  }

  const { error } = await supabase
    .from("branches")
    .update({ is_active: isActive })
    .eq("id", entityId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: isActive ? "Entity activated" : "Entity deactivated",
    module: "Entities",
    record_reference: entity.code,
    previous_value: entity.is_active ? "active" : "inactive",
    new_value: isActive ? "active" : "inactive",
    branch_id: entityId,
  });

  revalidateEntityPaths();
  return { ok: true };
}
