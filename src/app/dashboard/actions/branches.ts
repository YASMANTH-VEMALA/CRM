"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export async function addBranch(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const managerName = String(formData.get("manager_name") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Branch name is required." };
  }

  const { error } = await supabase.from("branches").insert({
    name,
    location: location || null,
    manager_name: managerName || null,
  });

  if (error) {
    return { ok: false, error: error.message.includes("duplicate") ? "That branch name already exists." : error.message };
  }

  await supabase.from("audit_logs").insert({ action: "Branch added", module: "Branches", record_reference: name });

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
  return { ok: true };
}
