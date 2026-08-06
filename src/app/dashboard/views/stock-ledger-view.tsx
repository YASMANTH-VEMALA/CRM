"use client";

import { useMemo, useState } from "react";
import type { LedgerRow, StockLedgerData } from "@/lib/data/inventory";
import { Column, DataTable, PageHead, SectionHead, StatStrip, formatDateTime, formatNumber } from "./shared";

/** Read-only: the ledger is append-only and has no mutating actions. */
export function StockLedgerView({ data }: { data: StockLedgerData }) {
  const [movementType, setMovementType] = useState("");
  const [productId, setProductId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const rows = useMemo(
    () =>
      data.movements.filter((row) => {
        if (movementType && row.movementType !== movementType) return false;
        if (productId) {
          const product = data.products.find((item) => item.id === productId);
          if (product && row.sku !== product.sku) return false;
        }
        const day = row.createdAt.slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        return true;
      }),
    [data.movements, data.products, movementType, productId, dateFrom, dateTo]
  );

  const columns: Column<LedgerRow>[] = [
    {
      key: "date",
      header: "When",
      render: (row) => formatDateTime(row.createdAt),
      sortValue: (row) => row.createdAt,
    },
    { key: "type", header: "Movement", render: (row) => row.movementLabel },
    {
      key: "product",
      header: "Product",
      render: (row) => (
        <div>
          <div>{row.productName}</div>
          <small style={{ opacity: 0.7 }}>{row.sku}</small>
        </div>
      ),
      sortValue: (row) => row.productName,
    },
    { key: "batch", header: "Batch", render: (row) => row.batchNumber ?? "—" },
    {
      key: "in",
      header: "Qty in",
      numeric: true,
      render: (row) => (row.quantityIn ? formatNumber(row.quantityIn) : "—"),
      sortValue: (row) => row.quantityIn,
    },
    {
      key: "out",
      header: "Qty out",
      numeric: true,
      render: (row) => (row.quantityOut ? formatNumber(row.quantityOut) : "—"),
      sortValue: (row) => row.quantityOut,
    },
    {
      key: "balance",
      header: "Balance after",
      numeric: true,
      render: (row) => formatNumber(row.balanceAfter),
      sortValue: (row) => row.balanceAfter ?? 0,
    },
    { key: "reference", header: "Reference", render: (row) => row.referenceNumber ?? "—" },
    { key: "user", header: "User", render: (row) => row.userName ?? "—" },
    { key: "reason", header: "Reason", render: (row) => row.reason ?? "—" },
  ];

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Stock · ${data.entityName}`}
        title="Stock ledger"
        description="The source of truth for inventory. Every movement records its quantity, the balance that followed it, the source document and the user. Ledger rows can never be edited or deleted."
      >
        {data.canExport && (
          <a className="crm-button crm-button-secondary" href="/api/reports/export?report=stock-ledger">
            Export <i>↓</i>
          </a>
        )}
      </PageHead>

      <StatStrip stats={data.stats} />

      <section className="crm-panel crm-enter">
        <SectionHead title="Filters" />
        <div className="crm-filter-bar">
          <label>
            <span>Movement type</span>
            <select value={movementType} onChange={(event) => setMovementType(event.target.value)}>
              <option value="">All movements</option>
              {data.movementTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Product</span>
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">All products</option>
              {data.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <button
            className="crm-filter-apply"
            type="button"
            onClick={() => {
              setMovementType("");
              setProductId("");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear filters
          </button>
        </div>
      </section>

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead
          title="Movements"
          note={`${rows.length} of ${data.movements.length} shown (most recent 500 loaded).`}
        />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(row) => row.id}
          searchPlaceholder="Search by product, batch, reference or reason…"
          emptyMessage="No stock movements recorded yet."
        />
      </section>
    </div>
  );
}
