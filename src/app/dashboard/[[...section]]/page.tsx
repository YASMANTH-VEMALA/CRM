import { redirect } from "next/navigation";
import AppShell from "../app-shell";
import { requireUser } from "@/lib/dal";
import { getEntityContext } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { permittedSections } from "../mock-data";
import type { SectionData } from "../views";

import { getDashboardData } from "@/lib/data/dashboard";
import { getPOSData, getSalesHistoryData } from "@/lib/data/sales";
import { getCustomersData } from "@/lib/data/customers";
import { getProductsData } from "@/lib/data/products";
import { getDraftProductsData } from "@/lib/data/draftProducts";
import { getInventoryData, getLowStockData, getStockLedgerData } from "@/lib/data/inventory";
import { getStockInwardData, getOpeningStockData } from "@/lib/data/stockDocuments";
import { getCategoriesData } from "@/lib/data/categories";
import { getSuppliersData } from "@/lib/data/suppliers";
import { getPurchaseOrdersData } from "@/lib/data/purchaseOrders";
import { getReceivedOrdersData } from "@/lib/data/receivedOrders";
import { getReturnsData } from "@/lib/data/returns";
import { getExpensesData } from "@/lib/data/expenses";
import { getAnalyticsData } from "@/lib/data/analytics";
import { getReportsData } from "@/lib/data/reports";
import { getEntitiesData } from "@/lib/data/entities";
import { getEmployeesData } from "@/lib/data/employees";
import { getAuditLogsData } from "@/lib/data/auditLogs";
import { getNotificationsData } from "@/lib/data/notifications";
import { getSettingsData } from "@/lib/data/settings";
import { getProfileData } from "@/lib/data/profile";
import { getAiAssistantData } from "@/lib/data/aiAssistant";
import type { ReportFilters, ReportFilterKey } from "@/lib/reports/types";

const REPORT_FILTER_KEYS: ReportFilterKey[] = [
  "entity",
  "dateFrom",
  "dateTo",
  "product",
  "supplier",
  "employee",
  "transactionType",
  "status",
];

type SearchParams = Record<string, string | string[] | undefined>;

function readReportFilters(params: SearchParams): ReportFilters {
  const filters: ReportFilters = {};
  for (const key of REPORT_FILTER_KEYS) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) filters[key] = single;
  }
  return filters;
}

async function getSectionData(section: string, params: SearchParams): Promise<SectionData> {
  switch (section) {
    case "sales":
      return { kind: "sales", data: await getPOSData() };
    case "sales-history":
      return { kind: "sales-history", data: await getSalesHistoryData() };
    case "customers":
      return { kind: "customers", data: await getCustomersData() };
    case "products":
      return { kind: "products", data: await getProductsData() };
    case "draft-products":
      return { kind: "draft-products", data: await getDraftProductsData() };
    case "inventory":
      return { kind: "inventory", data: await getInventoryData() };
    case "stock-ledger":
      return { kind: "stock-ledger", data: await getStockLedgerData() };
    case "low-stock":
      return { kind: "low-stock", data: await getLowStockData() };
    case "stock-inward":
      return { kind: "stock-inward", data: await getStockInwardData() };
    case "opening-stock":
      return { kind: "opening-stock", data: await getOpeningStockData() };
    case "categories":
      return { kind: "categories", data: await getCategoriesData() };
    case "suppliers":
      return { kind: "suppliers", data: await getSuppliersData() };
    case "purchase-orders":
      return { kind: "purchase-orders", data: await getPurchaseOrdersData() };
    case "received-orders":
      return { kind: "received-orders", data: await getReceivedOrdersData() };
    case "returns":
      return { kind: "returns", data: await getReturnsData() };
    case "expenses":
      return { kind: "expenses", data: await getExpensesData() };
    case "analytics":
      return { kind: "analytics", data: await getAnalyticsData() };
    case "reports": {
      const report = Array.isArray(params.report) ? params.report[0] : params.report;
      return { kind: "reports", data: await getReportsData(report ?? null, readReportFilters(params)) };
    }
    case "entities":
      return { kind: "entities", data: await getEntitiesData() };
    case "employees":
      return { kind: "employees", data: await getEmployeesData() };
    case "audit-logs":
      return { kind: "audit-logs", data: await getAuditLogsData() };
    case "notifications":
      return { kind: "notifications", data: await getNotificationsData() };
    case "settings":
      return { kind: "settings", data: await getSettingsData() };
    case "profile":
      return { kind: "profile", data: await getProfileData() };
    case "ai-assistant":
      return { kind: "ai-assistant", data: await getAiAssistantData() };
    default:
      return { kind: "dashboard", data: await getDashboardData() };
  }
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ section }, resolvedSearchParams, employee] = await Promise.all([
    params,
    searchParams,
    requireUser(),
  ]);

  // A section the user has no permission for is not silently blanked; the
  // request is redirected so the URL matches what is actually rendered.
  const requested = section?.[0] ?? "dashboard";
  const allowed = permittedSections(employee.permissions, employee.isMaster);
  if (!allowed.has(requested)) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const [entityContext, { data: notifications }, sectionData] = await Promise.all([
    getEntityContext(),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20),
    getSectionData(requested, resolvedSearchParams),
  ]);

  return (
    <AppShell
      section={requested}
      employee={employee}
      entityContext={entityContext}
      notifications={notifications ?? []}
      data={sectionData}
    />
  );
}
