"use client";

import type { AnalyticsData } from "@/lib/data/analytics";
import { PageHead, SectionHead, StatStrip, StringTable } from "./shared";

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Intelligence"
        title="Analytics"
        description="All-time performance for the active entity. Use Reports for date-range filtering and Excel exports."
      >
        <a className="crm-button crm-button-secondary" href="/api/reports/export?report=product-sales">
          Export product sales <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />

      <section className="crm-panel crm-enter">
        <SectionHead title="Sales and profit trend" note={data.trendNote} />
        <div className="crm-chart">
          {data.trend.map((point) => (
            <div className="crm-chart-col" key={point.label}>
              <i style={{ height: `${point.salesPct}%` }} title={`Sales ${point.salesPct}%`} />
              <i
                style={{ height: `${point.profitPct}%`, opacity: 0.55 }}
                title={`Profit ${point.profitPct}%`}
              />
              <small>{point.label}</small>
            </div>
          ))}
        </div>
        <p style={{ opacity: 0.75 }}>Total: {data.trendTotal}</p>
      </section>

      <section className="crm-panel crm-enter">
        <SectionHead title="Payment mix" note={`Total ${data.paymentTotal}`} />
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div
            aria-hidden="true"
            style={{
              width: 140,
              height: 140,
              borderRadius: "50%",
              background: data.paymentMixGradient,
            }}
          />
          <div className="crm-table-wrap" style={{ flex: 1, minWidth: 260 }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th style={{ textAlign: "right" }}>Share</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.paymentMix.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", opacity: 0.6, padding: "16px 0" }}>
                      No sales recorded yet.
                    </td>
                  </tr>
                )}
                {data.paymentMix.map(([method, share, amount]) => (
                  <tr key={method}>
                    <td>
                      <strong>{method}</strong>
                    </td>
                    <td style={{ textAlign: "right" }}>{share}</td>
                    <td style={{ textAlign: "right" }}>{amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead
          title="Product performance"
          note="Cost and profit columns are only populated for users permitted to see them."
        />
        <StringTable
          columns={["Product", "Qty sold", "Revenue", "Cost", "Profit", "Margin"]}
          rows={data.productPerformance}
          searchPlaceholder="Search products…"
          emptyMessage="No product sales yet."
        />
      </section>
    </div>
  );
}
