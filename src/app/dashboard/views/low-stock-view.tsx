"use client";

import { useMemo, useState } from "react";
import type { LowStockData, ReorderRow } from "@/lib/data/inventory";
import { Column, DataTable, PageHead, SectionHead, StatStrip, formatMoney, formatNumber } from "./shared";

const TABS = ["Low stock", "Out of stock", "Stock requirement"] as const;
type Tab = (typeof TABS)[number];

const EXPORT_REPORT: Record<Tab, string> = {
  "Low stock": "low-stock",
  "Out of stock": "out-of-stock",
  "Stock requirement": "stock-requirement",
};

export function LowStockView({ data }: { data: LowStockData }) {
  const [tab, setTab] = useState<Tab>("Low stock");

  const rows =
    tab === "Low stock" ? data.lowStock : tab === "Out of stock" ? data.outOfStock : data.requirement;

  // The requirement list is already sorted by supplier, so grouping is a
  // straight fold rather than a re-sort.
  const grouped = useMemo(() => {
    const groups = new Map<string, ReorderRow[]>();
    for (const row of data.requirement) {
      groups.set(row.supplierName, [...(groups.get(row.supplierName) ?? []), row]);
    }
    return [...groups.entries()];
  }, [data.requirement]);

  const columns: Column<ReorderRow>[] = [
    { key: "sku", header: "SKU", render: (row) => row.sku, sortValue: (row) => row.sku },
    { key: "name", header: "Product", render: (row) => row.name, sortValue: (row) => row.name },
    { key: "supplier", header: "Default supplier", render: (row) => row.supplierName },
    {
      key: "available",
      header: "Available",
      numeric: true,
      render: (row) => formatNumber(row.available),
      sortValue: (row) => row.available,
    },
    {
      key: "minimum",
      header: "Minimum",
      numeric: true,
      render: (row) => formatNumber(row.minimum),
      sortValue: (row) => row.minimum,
    },
    {
      key: "target",
      header: "Restock target",
      numeric: true,
      render: (row) => formatNumber(row.restockTarget),
      sortValue: (row) => row.restockTarget,
    },
    {
      key: "reorder",
      header: "Reorder qty",
      numeric: true,
      render: (row) => formatNumber(row.reorderQuantity),
      sortValue: (row) => row.reorderQuantity,
    },
    ...(data.canViewCost
      ? [
          {
            key: "cost",
            header: "Estimated cost",
            numeric: true,
            render: (row: ReorderRow) => formatMoney(row.estimatedCost, data.currency),
            sortValue: (row: ReorderRow) => row.estimatedCost ?? 0,
          },
        ]
      : []),
  ];

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Stock · ${data.entityName}`}
        title="Low stock and reordering"
        description="Reorder quantity = restock target − available quantity. Both thresholds are configured per product, per entity."
      >
        {data.canExport && (
          <a
            className="crm-button crm-button-secondary"
            href={`/api/reports/export?report=${EXPORT_REPORT[tab]}`}
          >
            Export {tab.toLowerCase()} <i>↓</i>
          </a>
        )}
        <button className="crm-button crm-button-secondary" type="button" onClick={() => window.print()}>
          Print <i>↗</i>
        </button>
      </PageHead>

      <StatStrip stats={data.stats} />

      <div className="crm-tabs" role="tablist" aria-label="Stock views">
        {TABS.map((item) => (
          <button
            className={tab === item ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={tab === item}
            key={item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "Stock requirement" ? (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Stock requirement by supplier"
            note="Grouped so each supplier's order can be raised in one go."
          />
          {grouped.length === 0 ? (
            <p style={{ opacity: 0.7, padding: "12px 0" }}>
              Nothing needs reordering. Every product is above its minimum quantity.
            </p>
          ) : (
            grouped.map(([supplier, supplierRows]) => {
              const units = supplierRows.reduce((sum, row) => sum + row.reorderQuantity, 0);
              const cost = supplierRows.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0);
              return (
                <div key={supplier} style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: "12px 0 6px" }}>
                    {supplier}{" "}
                    <small style={{ opacity: 0.7, fontWeight: 400 }}>
                      · {supplierRows.length} line{supplierRows.length === 1 ? "" : "s"} · {units} units
                      {data.canViewCost ? ` · ${formatMoney(cost, data.currency)}` : ""}
                    </small>
                  </h3>
                  <div className="crm-table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th style={{ textAlign: "right" }}>Available</th>
                          <th style={{ textAlign: "right" }}>Minimum</th>
                          <th style={{ textAlign: "right" }}>Restock target</th>
                          <th style={{ textAlign: "right" }}>Reorder qty</th>
                          {data.canViewCost && <th style={{ textAlign: "right" }}>Estimated cost</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {supplierRows.map((row) => (
                          <tr key={row.productId}>
                            <td>
                              <strong>{row.sku}</strong>
                            </td>
                            <td>{row.name}</td>
                            <td style={{ textAlign: "right" }}>{formatNumber(row.available)}</td>
                            <td style={{ textAlign: "right" }}>{formatNumber(row.minimum)}</td>
                            <td style={{ textAlign: "right" }}>{formatNumber(row.restockTarget)}</td>
                            <td style={{ textAlign: "right" }}>
                              <strong>{formatNumber(row.reorderQuantity)}</strong>
                            </td>
                            {data.canViewCost && (
                              <td style={{ textAlign: "right" }}>
                                {formatMoney(row.estimatedCost, data.currency)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </section>
      ) : (
        <section className="crm-panel crm-enter">
          <SectionHead title={tab} note={`${rows.length} product${rows.length === 1 ? "" : "s"}.`} />
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.productId}
            searchPlaceholder="Search by product, SKU or supplier…"
            emptyMessage={
              tab === "Out of stock"
                ? "Everything active is in stock."
                : "Nothing is at or below its minimum quantity."
            }
          />
        </section>
      )}
    </div>
  );
}
