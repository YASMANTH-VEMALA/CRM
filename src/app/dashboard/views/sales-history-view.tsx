"use client";

import { useMemo, useState, useTransition } from "react";
import { reverseSale } from "../actions/sales";
import type { SaleRecord, SalesHistoryData } from "@/lib/data/sales";
import {
  Column,
  DataTable,
  Feedback,
  PageHead,
  SectionHead,
  StatStrip,
  Status,
  formatDateTime,
  formatMoney,
} from "./shared";

const TABS = ["All", "Completed", "Reversed"] as const;
type Tab = (typeof TABS)[number];

export function SalesHistoryView({ data }: { data: SalesHistoryData }) {
  const [tab, setTab] = useState<Tab>("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleRecord | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();

  const rows = useMemo(
    () =>
      data.sales.filter((sale) => {
        if (tab === "All") return true;
        if (tab === "Completed") return sale.status === "completed";
        return sale.status === "reversed";
      }),
    [data.sales, tab]
  );

  function cancelSale(sale: SaleRecord) {
    setMessage(null);
    setBusyId(sale.id);
    startTransition(async () => {
      const result = await reverseSale(sale.id, reason);
      setBusyId(null);
      if (result.ok) {
        setCancelTarget(null);
        setReason("");
        setMessage({
          ok: true,
          message: `${sale.invoiceNumber} reversed. Stock has been returned through reversal movements.`,
        });
      } else {
        setMessage({ ok: false, message: result.error });
      }
    });
  }

  const columns: Column<SaleRecord>[] = [
    {
      key: "invoice",
      header: "Invoice",
      render: (row) => (
        <button
          className="crm-row-action"
          type="button"
          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
        >
          {row.invoiceNumber}
        </button>
      ),
      sortValue: (row) => row.invoiceNumber,
    },
    { key: "customer", header: "Customer", render: (row) => row.customerName ?? "Walk-in" },
    { key: "cashier", header: "Served by", render: (row) => row.cashierName ?? "—" },
    { key: "payment", header: "Payment", render: (row) => row.paymentMethod },
    {
      key: "subtotal",
      header: "Gross",
      numeric: true,
      render: (row) => formatMoney(row.subtotal, data.currency),
      sortValue: (row) => row.subtotal,
    },
    {
      key: "discount",
      header: "Discount",
      numeric: true,
      render: (row) => formatMoney(row.discount, data.currency),
      sortValue: (row) => row.discount,
    },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (row) => formatMoney(row.total, data.currency),
      sortValue: (row) => row.total,
    },
    { key: "status", header: "Status", render: (row) => <Status value={row.status} /> },
    {
      key: "soldAt",
      header: "When",
      render: (row) => formatDateTime(row.soldAt),
      sortValue: (row) => row.soldAt,
    },
  ];

  const detail = expanded ? data.sales.find((sale) => sale.id === expanded) : null;

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Sell · ${data.entityName}`}
        title="Sales history"
        description="Completed sales are never deleted. Cancelling one writes reversal movements that return the stock to its batches."
      >
        {data.canExport && (
          <a className="crm-button crm-button-secondary" href="/api/reports/export?report=daily-sales">
            Export <i>↓</i>
          </a>
        )}
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      <div className="crm-tabs" role="tablist" aria-label="Sales views">
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

      <section className="crm-panel crm-enter">
        <SectionHead title={tab} note={`${rows.length} sale${rows.length === 1 ? "" : "s"}.`} />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(row) => row.id}
          searchPlaceholder="Search by invoice, customer or cashier…"
          emptyMessage="No sales recorded yet."
          initialSort={{ key: "soldAt", direction: "desc" }}
          actions={
            data.canCancel
              ? (row) =>
                  row.status === "completed" ? (
                    <button
                      className="crm-row-action"
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setCancelTarget(row);
                        setReason("");
                      }}
                    >
                      Cancel
                    </button>
                  ) : (
                    <small style={{ opacity: 0.7 }}>{row.reversalReason ?? "—"}</small>
                  )
              : undefined
          }
        />
      </section>

      {detail && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Sale ${detail.invoiceNumber}`}
            note={`${formatDateTime(detail.soldAt)} · ${detail.paymentMethod} · served by ${detail.cashierName ?? "—"}`}
          >
            <button className="crm-row-action" type="button" onClick={() => setExpanded(null)}>
              Close
            </button>
          </SectionHead>
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Batch</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Unit price</th>
                  <th style={{ textAlign: "right" }}>Discount</th>
                  <th style={{ textAlign: "right" }}>Line total</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line, index) => (
                  <tr key={`${line.sku}-${index}`}>
                    <td>
                      <strong>{line.sku}</strong>
                    </td>
                    <td>{line.productName}</td>
                    <td>{line.batchNumber ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{line.quantity}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(line.unitPrice, data.currency)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(line.discount, data.currency)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(line.lineTotal, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.reversalReason && (
            <p style={{ marginTop: 12, opacity: 0.8 }}>
              Reversal reason: <strong>{detail.reversalReason}</strong>
            </p>
          )}
        </section>
      )}

      {cancelTarget && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Cancel ${cancelTarget.invoiceNumber}?`}
            note="The sale is marked reversed and reversal movements return the stock. The original sale record is kept."
          />
          <div className="crm-form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Reason</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Customer changed their mind"
              />
            </label>
          </div>
          <div className="crm-form-actions">
            <button
              className="crm-button crm-button-secondary"
              type="button"
              onClick={() => setCancelTarget(null)}
            >
              Keep the sale
            </button>
            <button
              className="crm-button crm-button-primary"
              type="button"
              disabled={busyId === cancelTarget.id}
              onClick={() => cancelSale(cancelTarget)}
            >
              {busyId === cancelTarget.id ? "Reversing…" : "Reverse sale"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
