import "server-only";
import { getCurrentEmployee, type CurrentEmployee } from "@/lib/dal";
import { getEntityContext } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared request context for every data loader.
 *
 * RLS already guarantees a user can only read entities they have access to.
 * This layer narrows further to the *active* entity (so a master admin or a
 * multi-entity user sees one pharmacy at a time), and carries the flags that
 * decide whether cost and profit figures may be rendered at all.
 */
export type LoaderScope = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  employee: CurrentEmployee | null;
  /** null = consolidated view across every accessible entity. */
  entityId: string | null;
  entityName: string;
  currency: string;
  canViewCost: boolean;
  canViewProfit: boolean;
  canViewReports: boolean;
  canExport: boolean;
};

export async function getScope(): Promise<LoaderScope> {
  const [supabase, employee, ctx] = await Promise.all([
    createClient(),
    getCurrentEmployee(),
    getEntityContext(),
  ]);

  return {
    supabase,
    employee,
    entityId: ctx.activeEntityId,
    entityName: ctx.activeEntity?.name ?? "All entities",
    currency: ctx.activeEntity?.currency ?? "TZS",
    canViewCost: employee?.permissions.includes("view_purchase_cost") ?? false,
    canViewProfit: employee?.permissions.includes("view_profit") ?? false,
    canViewReports: employee?.permissions.includes("view_management_reports") ?? false,
    canExport: employee?.permissions.includes("generate_exports") ?? false,
  };
}

/**
 * Applies the active-entity filter to a PostgREST query builder.
 * Pass through unchanged when consolidating across entities.
 */
export function scoped<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  entityId: string | null,
  column = "branch_id"
): T {
  return entityId ? query.eq(column, entityId) : query;
}
