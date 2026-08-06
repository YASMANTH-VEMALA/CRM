"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportsData } from "@/lib/data/reports";
import type { ReportFilterKey, ReportFilters } from "@/lib/reports/types";
import { EmptyState, Feedback, PageHead, SectionHead, StatStrip, formatMoney } from "./shared";

const GROUPS = ["Stock", "Purchasing", "Sales", "Management"] as const;

/**
 * Report selection and filters live in the URL, so the server re-runs the
 * query and the Excel export can reuse exactly the same parameters.
 */
export function ReportsView({ data }: { data: ReportsData }) {
  const router = useRouter();
  const [filters, setFilters] = useState<ReportFilters>(data.filters);
  const [navigating, setNavigating] = useState(false);

  const selected = data.reports.find((report) => report.id === data.selectedId) ?? null;

  function buildQuery(reportId: string, values: ReportFilters): string {
    const params = new URLSearchParams({ report: reportId });
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }

  function openReport(reportId: string, values: ReportFilters = {}) {
    setNavigating(true);
    setFilters(values);
    router.push(`/dashboard/reports?${buildQuery(reportId, values)}`);
  }

  function applyFilters() {
    if (!selected) return;
    setNavigating(true);
    router.push(`/dashboard/reports?${buildQuery(selected.id, filters)}`);
  }

  function setFilter(key: ReportFilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  const shows = (key: ReportFilterKey) => selected?.filters.includes(key) ?? false;
  const exportHref = selected ? `/api/reports/export?${buildQuery(selected.id, filters)}` : "#";

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Reports · ${data.entityName}`}
        title={selected?.title ?? "Reports"}
        description={
          selected?.description ??
          "Choose a report. Only reports your permissions allow are listed, and exports use exactly the filters shown."
        }
      >
        {selected && data.canExport && (
          <a className="crm-button crm-button-primary" href={exportHref}>
            Export to Excel <i>↓</i>
          </a>
        )}
        {selected && (
          <button className="crm-button crm-button-secondary" type="button" onClick={() => window.print()}>
            Print <i>↗</i>
          </button>
        )}
      </PageHead>

      <section className="crm-panel crm-enter">
        <SectionHead title="Report library" note={`${data.reports.length} available to you.`} />
        {GROUPS.map((group) => {
          const reports = data.reports.filter((report) => report.group === group);
          if (reports.length === 0) return null;
          return (
            <div key={group} style={{ marginBottom: 12 }}>
              <h4 style={{ margin: "8px 0" }}>{group}</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {reports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    className={
                      report.id === data.selectedId ? "crm-button crm-button-primary" : "crm-button crm-button-secondary"
                    }
                    onClick={() => openReport(report.id)}
                    title={report.description}
                  >
                    {report.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {selected && (
        <section className="crm-panel crm-enter">
          <SectionHead title="Filters" note="Applied to both the preview and the export." />
          <div className="crm-filter-bar">
            {shows("entity") && (
              <label>
                <span>Entity</span>
                <select value={filters.entity ?? ""} onChange={(event) => setFilter("entity", event.target.value)}>
                  <option value="">Active entity</option>
                  {data.options.entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shows("dateFrom") && (
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={filters.dateFrom ?? ""}
                  onChange={(event) => setFilter("dateFrom", event.target.value)}
                />
              </label>
            )}
            {shows("dateTo") && (
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={filters.dateTo ?? ""}
                  onChange={(event) => setFilter("dateTo", event.target.value)}
                />
              </label>
            )}
            {shows("product") && (
              <label>
                <span>Product</span>
                <select value={filters.product ?? ""} onChange={(event) => setFilter("product", event.target.value)}>
                  <option value="">All products</option>
                  {data.options.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shows("supplier") && (
              <label>
                <span>Supplier</span>
                <select value={filters.supplier ?? ""} onChange={(event) => setFilter("supplier", event.target.value)}>
                  <option value="">All suppliers</option>
                  {data.options.suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shows("employee") && (
              <label>
                <span>Employee</span>
                <select value={filters.employee ?? ""} onChange={(event) => setFilter("employee", event.target.value)}>
                  <option value="">All employees</option>
                  {data.options.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shows("transactionType") && (
              <label>
                <span>Transaction type</span>
                <select
                  value={filters.transactionType ?? ""}
                  onChange={(event) => setFilter("transactionType", event.target.value)}
                >
                  <option value="">All types</option>
                  {data.options.transactionTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shows("status") && (
              <label>
                <span>Status</span>
                <select value={filters.status ?? ""} onChange={(event) => setFilter("status", event.target.value)}>
                  <option value="">All statuses</option>
                  {data.options.statuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="crm-filter-apply" type="button" onClick={applyFilters} disabled={navigating}>
              {navigating ? "Running…" : "Apply filters"}
            </button>
            <button
              className="crm-filter-apply"
              type="button"
              onClick={() => openReport(selected.id, {})}
              disabled={navigating}
            >
              Clear
            </button>
          </div>
        </section>
      )}

      {data.error && (
        <section className="crm-panel crm-enter">
          <Feedback state={{ ok: false, message: data.error }} />
        </section>
      )}

      {!selected && !data.error && (
        <EmptyState
          title="Choose a report"
          hint="Pick one from the library above. Filters appear for the fields that report supports."
        />
      )}

      {selected && data.result && (
        <section className="crm-panel crm-enter crm-enter-2">
          <SectionHead
            title={selected.title}
            note={`${data.entityName} · generated by ${data.generatedBy} · ${data.result.rows.length} row${data.result.rows.length === 1 ? "" : "s"}`}
          />

          {data.result.summary.length > 0 && (
            <StatStrip
              stats={data.result.summary.map(([label, value]) => [label, value, ""] as [string, string, string])}
            />
          )}

          {data.result.truncatedAt && (
            <p className="login-error" role="status">
              Showing the first {data.result.truncatedAt} rows only. Narrow the filters to see the rest.
            </p>
          )}

          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  {data.result.columns.map((column) => (
                    <th key={column.key} style={{ textAlign: column.numeric ? "right" : undefined }}>
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.result.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={data.result.columns.length}
                      style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}
                    >
                      No data matches these filters.
                    </td>
                  </tr>
                )}
                {data.result.rows.map((row, index) => (
                  <tr key={index}>
                    {data.result!.columns.map((column, columnIndex) => {
                      const value = row[column.key];
                      const rendered =
                        column.currency && typeof value === "number"
                          ? formatMoney(value, data.currency)
                          : value == null || value === ""
                            ? "—"
                            : String(value);
                      return (
                        <td key={column.key} style={{ textAlign: column.numeric ? "right" : undefined }}>
                          {columnIndex === 0 ? <strong>{rendered}</strong> : rendered}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
