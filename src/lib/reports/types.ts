import type { Permission } from "@/lib/permissions";

export type ReportFilterKey =
  | "entity"
  | "dateFrom"
  | "dateTo"
  | "product"
  | "supplier"
  | "employee"
  | "transactionType"
  | "status";

export type ReportFilters = Partial<Record<ReportFilterKey, string>>;

export type ReportColumn = {
  key: string;
  header: string;
  /** Right-aligns and formats as a number/currency in the UI and export. */
  numeric?: boolean;
  currency?: boolean;
  width?: number;
};

export type ReportRow = Record<string, string | number | null>;

export type ReportResult = {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Headline figures for the report header strip. */
  summary: Array<[string, string]>;
  /** Set when a report was truncated so the UI never implies completeness. */
  truncatedAt?: number;
};

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  group: "Stock" | "Purchasing" | "Sales" | "Management";
  /** Permission required to run it at all. */
  permission: Permission;
  /** Extra permission needed because the report exposes cost or profit. */
  sensitive?: "cost" | "profit";
  filters: ReportFilterKey[];
};
