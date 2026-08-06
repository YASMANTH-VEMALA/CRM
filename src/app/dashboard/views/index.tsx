import type { DashboardData } from "@/lib/data/dashboard";
import type { POSData, SalesHistoryData } from "@/lib/data/sales";
import type { CustomersData } from "@/lib/data/customers";
import type { ProductsData } from "@/lib/data/products";
import type { DraftProductsData } from "@/lib/data/draftProducts";
import type { InventoryData, LowStockData, StockLedgerData } from "@/lib/data/inventory";
import type { StockInwardData, OpeningStockData } from "@/lib/data/stockDocuments";
import type { CategoriesData } from "@/lib/data/categories";
import type { SuppliersData } from "@/lib/data/suppliers";
import type { PurchaseOrdersData } from "@/lib/data/purchaseOrders";
import type { ReceivedOrdersData } from "@/lib/data/receivedOrders";
import type { ReturnsData } from "@/lib/data/returns";
import type { ExpensesData } from "@/lib/data/expenses";
import type { AnalyticsData } from "@/lib/data/analytics";
import type { ReportsData } from "@/lib/data/reports";
import type { EntitiesData } from "@/lib/data/entities";
import type { EmployeesData } from "@/lib/data/employees";
import type { AuditLogsData } from "@/lib/data/auditLogs";
import type { NotificationsData } from "@/lib/data/notifications";
import type { SettingsData } from "@/lib/data/settings";
import type { ProfileData } from "@/lib/data/profile";
import type { AiAssistantData } from "@/lib/data/aiAssistant";

import { DashboardView } from "./dashboard-view";
import { SalesView } from "./sales-view";
import { SalesHistoryView } from "./sales-history-view";
import { CustomersView } from "./customers-view";
import { ProductsView } from "./products-view";
import { DraftProductsView } from "./draft-products-view";
import { InventoryView } from "./inventory-view";
import { StockLedgerView } from "./stock-ledger-view";
import { LowStockView } from "./low-stock-view";
import { StockInwardView } from "./stock-inward-view";
import { OpeningStockView } from "./opening-stock-view";
import { CategoriesView } from "./categories-view";
import { SuppliersView } from "./suppliers-view";
import { PurchaseOrdersView } from "./purchase-orders-view";
import { ReceivedOrdersView } from "./received-orders-view";
import { ReturnsView } from "./returns-view";
import { ExpensesView } from "./expenses-view";
import { AnalyticsView } from "./analytics-view";
import { ReportsView } from "./reports-view";
import { EntitiesView } from "./entities-view";
import { EmployeesView } from "./employees-view";
import { AuditLogsView } from "./audit-logs-view";
import { NotificationsView } from "./notifications-view";
import { SettingsView } from "./settings-view";
import { ProfileView } from "./profile-view";
import { AiAssistantView } from "./ai-assistant-view";

export type SectionData =
  | { kind: "dashboard"; data: DashboardData }
  | { kind: "sales"; data: POSData }
  | { kind: "sales-history"; data: SalesHistoryData }
  | { kind: "customers"; data: CustomersData }
  | { kind: "products"; data: ProductsData }
  | { kind: "draft-products"; data: DraftProductsData }
  | { kind: "inventory"; data: InventoryData }
  | { kind: "stock-ledger"; data: StockLedgerData }
  | { kind: "low-stock"; data: LowStockData }
  | { kind: "stock-inward"; data: StockInwardData }
  | { kind: "opening-stock"; data: OpeningStockData }
  | { kind: "categories"; data: CategoriesData }
  | { kind: "suppliers"; data: SuppliersData }
  | { kind: "purchase-orders"; data: PurchaseOrdersData }
  | { kind: "received-orders"; data: ReceivedOrdersData }
  | { kind: "returns"; data: ReturnsData }
  | { kind: "expenses"; data: ExpensesData }
  | { kind: "analytics"; data: AnalyticsData }
  | { kind: "reports"; data: ReportsData }
  | { kind: "entities"; data: EntitiesData }
  | { kind: "employees"; data: EmployeesData }
  | { kind: "audit-logs"; data: AuditLogsData }
  | { kind: "notifications"; data: NotificationsData }
  | { kind: "settings"; data: SettingsData }
  | { kind: "profile"; data: ProfileData }
  | { kind: "ai-assistant"; data: AiAssistantData };

export function ViewContent({ data }: { data: SectionData }) {
  switch (data.kind) {
    case "dashboard":
      return <DashboardView data={data.data} />;
    case "sales":
      return <SalesView data={data.data} />;
    case "sales-history":
      return <SalesHistoryView data={data.data} />;
    case "customers":
      return <CustomersView data={data.data} />;
    case "products":
      return <ProductsView data={data.data} />;
    case "draft-products":
      return <DraftProductsView data={data.data} />;
    case "inventory":
      return <InventoryView data={data.data} />;
    case "stock-ledger":
      return <StockLedgerView data={data.data} />;
    case "low-stock":
      return <LowStockView data={data.data} />;
    case "stock-inward":
      return <StockInwardView data={data.data} />;
    case "opening-stock":
      return <OpeningStockView data={data.data} />;
    case "categories":
      return <CategoriesView data={data.data} />;
    case "suppliers":
      return <SuppliersView data={data.data} />;
    case "purchase-orders":
      return <PurchaseOrdersView data={data.data} />;
    case "received-orders":
      return <ReceivedOrdersView data={data.data} />;
    case "returns":
      return <ReturnsView data={data.data} />;
    case "expenses":
      return <ExpensesView data={data.data} />;
    case "analytics":
      return <AnalyticsView data={data.data} />;
    case "reports":
      return <ReportsView data={data.data} />;
    case "entities":
      return <EntitiesView data={data.data} />;
    case "employees":
      return <EmployeesView data={data.data} />;
    case "audit-logs":
      return <AuditLogsView data={data.data} />;
    case "notifications":
      return <NotificationsView data={data.data} />;
    case "settings":
      return <SettingsView data={data.data} />;
    case "profile":
      return <ProfileView data={data.data} />;
    case "ai-assistant":
      return <AiAssistantView data={data.data} />;
    default:
      return null;
  }
}
