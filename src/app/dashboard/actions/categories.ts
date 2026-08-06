"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export async function addCategory(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_products");
  if (denied) return denied;
  const supabase = await createClient();

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "medicine");
  const isActive = formData.get("is_active") === "on";

  if (!code || !name) {
    return { ok: false, error: "Category code and name are required." };
  }

  const { error } = await supabase.from("categories").insert({
    code,
    name,
    type,
    is_active: isActive,
  });

  if (error) {
    return { ok: false, error: error.message.includes("duplicate") ? "That category code already exists." : error.message };
  }

  await supabase.from("audit_logs").insert({ action: "Category added", module: "Categories", record_reference: code });

  revalidatePath("/dashboard/categories");
  revalidatePath("/dashboard");
  return { ok: true };
}
