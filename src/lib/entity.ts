import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEmployee, hasPermission } from "@/lib/dal";

/**
 * Active-entity context. Entity isolation itself is enforced by RLS; this
 * module only decides which of the user's accessible entities the UI (and the
 * data loaders) should currently focus on. Master admins may also select
 * "all entities" (activeEntityId = null) for consolidated views.
 */
export const ACTIVE_ENTITY_COOKIE = "erp-active-entity";

export type EntityOption = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  currency: string;
};

export type EntityContext = {
  /** Entities visible to this user (already RLS-scoped). */
  entities: EntityOption[];
  /** null = all entities (master admins only). */
  activeEntityId: string | null;
  activeEntity: EntityOption | null;
  canSwitch: boolean;
  canViewAll: boolean;
};

export const getEntityContext = cache(async (): Promise<EntityContext> => {
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  const { data } = await supabase
    .from("branches")
    .select("id, name, code, is_active, currency")
    .order("name");
  const entities = (data ?? []) as EntityOption[];

  if (!employee) {
    return { entities: [], activeEntityId: null, activeEntity: null, canSwitch: false, canViewAll: false };
  }

  const canSwitch =
    employee.isMaster ||
    (hasPermission(employee, "access_multiple_entities") && entities.length > 1);

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_ENTITY_COOKIE)?.value ?? null;

  let activeEntityId: string | null;
  if (employee.isMaster) {
    activeEntityId =
      requested && requested !== "all" && entities.some((e) => e.id === requested)
        ? requested
        : null;
  } else if (canSwitch) {
    activeEntityId =
      requested && entities.some((e) => e.id === requested)
        ? requested
        : employee.branch_id ?? entities[0]?.id ?? null;
  } else {
    activeEntityId = employee.branch_id ?? entities[0]?.id ?? null;
  }

  return {
    entities,
    activeEntityId,
    activeEntity: entities.find((e) => e.id === activeEntityId) ?? null,
    canSwitch,
    canViewAll: employee.isMaster,
  };
});

export const ENTITY_REQUIRED_ERROR =
  "Select a specific entity in the entity switcher before creating records.";

/**
 * The entity id new records must be stamped with, or null when the master
 * admin is in "all entities" mode — creation flows need one concrete entity.
 */
export async function getActiveEntityId(): Promise<string | null> {
  const ctx = await getEntityContext();
  return ctx.activeEntityId;
}
