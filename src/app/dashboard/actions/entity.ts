"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { hasPermission, requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ENTITY_COOKIE } from "@/lib/entity";
import type { ActionResult } from "@/lib/types";

export async function setActiveEntity(entityId: string): Promise<ActionResult> {
  const employee = await requireUser();
  const cookieStore = await cookies();

  if (entityId === "all") {
    if (!employee.isMaster) {
      return { ok: false, error: "Only the master administrator can view all entities." };
    }
    cookieStore.set(ACTIVE_ENTITY_COOKIE, "all", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  } else {
    if (
      !employee.isMaster &&
      entityId !== employee.branch_id &&
      !hasPermission(employee, "access_multiple_entities")
    ) {
      return { ok: false, error: "You do not have access to that entity." };
    }
    // RLS hides entities the user cannot access, so this lookup doubles as
    // the server-side validation of the switch target.
    const supabase = await createClient();
    const { data: entity } = await supabase
      .from("branches")
      .select("id")
      .eq("id", entityId)
      .maybeSingle();
    if (!entity) {
      return { ok: false, error: "You do not have access to that entity." };
    }
    cookieStore.set(ACTIVE_ENTITY_COOKIE, entityId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  }

  revalidatePath("/dashboard/[[...section]]", "page");
  return { ok: true };
}
