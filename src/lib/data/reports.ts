import "server-only";
import { getScope } from "./scope";
import { REPORT_DEFINITIONS } from "@/lib/reports/definitions";
import { runReport, ReportPermissionError } from "@/lib/reports/run";
import type { ReportDefinition, ReportFilters, ReportResult } from "@/lib/reports/types";
import { log } from "@/lib/logger";

export type ReportOption = Pick<
  ReportDefinition,
  "id" | "title" | "description" | "group" | "filters"
>;

export type ReportFilterOptions = {
  entities: { id: string; name: string }[];
  products: { id: string; name: string; sku: string }[];
  suppliers: { id: string; name: string }[];
  employees: { id: string; name: string }[];
  transactionTypes: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
};

export type ReportsData = {
  /** Only the reports this user is allowed to run. */
  reports: ReportOption[];
  selectedId: string | null;
  filters: ReportFilters;
  result: ReportResult | null;
  error: string | null;
  options: ReportFilterOptions;
  canExport: boolean;
  entityName: string;
  currency: string;
  generatedBy: string;
};

const TRANSACTION_TYPES = [
  { value: "purchase_from_parent", label: "Purchase from parent" },
  { value: "purchase_from_external", label: "Purchase from external supplier" },
  { value: "foc_or_sample", label: "Free of charge / sample" },
  { value: "replacement_in", label: "Replacement in" },
  { value: "sale", label: "Sale" },
  { value: "employee_consumption", label: "Employee consumption" },
  { value: "expiry", label: "Expiry write-off" },
  { value: "damage", label: "Damage write-off" },
  { value: "supplier_return", label: "Supplier return" },
  { value: "stock_correction", label: "Stock correction" },
  { value: "opening_stock", label: "Opening stock" },
];

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
  { value: "reversed", label: "Reversed" },
];

/**
 * Loads the report workspace. The selected report runs server-side with the
 * supplied filters; the export route re-runs the identical query, so an
 * exported file always matches what is on screen.
 */
export async function getReportsData(
  selectedId: string | null,
  filters: ReportFilters
): Promise<ReportsData> {
  const scope = await getScope();
  const permissions = scope.employee?.permissions ?? [];

  const available = REPORT_DEFINITIONS.filter((report) => {
    if (!permissions.includes(report.permission)) return false;
    if (report.sensitive === "cost" && !scope.canViewCost) return false;
    if (report.sensitive === "profit" && !scope.canViewProfit) return false;
    return true;
  }).map(({ id, title, description, group, filters: reportFilters }) => ({
    id,
    title,
    description,
    group,
    filters: reportFilters,
  }));

  const resolvedId = selectedId && available.some((r) => r.id === selectedId) ? selectedId : null;

  let productQuery = scope.supabase.from("products").select("id, name, sku").order("name").limit(500);
  if (scope.entityId) productQuery = productQuery.eq("branch_id", scope.entityId);

  let supplierQuery = scope.supabase.from("suppliers").select("id, name").order("name").limit(200);
  if (scope.entityId) supplierQuery = supplierQuery.eq("branch_id", scope.entityId);

  let employeeQuery = scope.supabase
    .from("employees")
    .select("id, full_name")
    .eq("status", "active")
    .order("full_name")
    .limit(200);
  if (scope.entityId) employeeQuery = employeeQuery.eq("branch_id", scope.entityId);

  const [{ data: entities }, { data: products }, { data: suppliers }, { data: employees }] =
    await Promise.all([
      scope.supabase.from("branches").select("id, name").order("name"),
      productQuery,
      supplierQuery,
      employeeQuery,
    ]);

  let result: ReportResult | null = null;
  let error: string | null = null;
  if (resolvedId) {
    try {
      result = await runReport(resolvedId, filters);
    } catch (caught) {
      error =
        caught instanceof ReportPermissionError
          ? caught.message
          : "This report could not be generated. Try narrowing the filters.";
      if (!(caught instanceof ReportPermissionError)) {
        log.error("reports.run_failed", caught);
      }
    }
  }

  return {
    reports: available,
    selectedId: resolvedId,
    filters,
    result,
    error,
    options: {
      entities: entities ?? [],
      products: products ?? [],
      suppliers: suppliers ?? [],
      employees: (employees ?? []).map((employee) => ({ id: employee.id, name: employee.full_name })),
      transactionTypes: TRANSACTION_TYPES,
      statuses: STATUSES,
    },
    canExport: scope.canExport,
    entityName: scope.entityName,
    currency: scope.currency,
    generatedBy: scope.employee?.full_name ?? "—",
  };
}
