"use client";

import { useActionState, useMemo, useState } from "react";
import { adjustStock, submitStockCount, transferStock } from "../actions/inventory";
import type { BatchRow, InventoryData } from "@/lib/data/inventory";
import {
  Column,
  DataTable,
  ExpiryCell,
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDate,
  formatMoney,
  formatNumber,
} from "./shared";

const TABS = ["All batches", "In stock", "Expiring soon", "Expired", "Out of stock"] as const;
type Tab = (typeof TABS)[number];

type FormKind = "adjust" | "count" | "transfer" | null;

export function InventoryView({ data }: { data: InventoryData }) {
  const [tab, setTab] = useState<Tab>("All batches");
  const [openRequest, setOpenRequest] = useState<{
    kind: Exclude<FormKind, null>;
    seen: unknown;
  } | null>(null);

  const [adjustState, adjustAction, adjusting] = useActionState(adjustStock, null);
  const [countState, countAction, counting] = useActionState(submitStockCount, null);
  const [transferState, transferAction, transferring] = useActionState(transferStock, null);

  // Each form closes when its own action succeeds. Deriving this from the
  // action result avoids a cascading render and a stale-by-one-submit read.
  const formState =
    openRequest?.kind === "adjust"
      ? adjustState
      : openRequest?.kind === "count"
        ? countState
        : transferState;
  const formSucceeded =
    openRequest !== null && openRequest.seen !== formState && Boolean(formState?.ok);
  const openForm: FormKind = openRequest && !formSucceeded ? openRequest.kind : null;

  function toggleForm(kind: Exclude<FormKind, null>) {
    if (openForm === kind) {
      setOpenRequest(null);
      return;
    }
    const seen = kind === "adjust" ? adjustState : kind === "count" ? countState : transferState;
    setOpenRequest({ kind, seen });
  }

  const rows = useMemo(
    () =>
      data.batches.filter((batch) => {
        if (tab === "All batches") return true;
        if (tab === "In stock") return batch.quantityAvailable > 0 && batch.status === "active";
        if (tab === "Out of stock") return batch.quantityAvailable <= 0;
        if (tab === "Expired") return batch.daysToExpiry !== null && batch.daysToExpiry < 0;
        return (
          batch.daysToExpiry !== null &&
          batch.daysToExpiry >= 0 &&
          batch.daysToExpiry <= 90 &&
          batch.quantityAvailable > 0
        );
      }),
    [data.batches, tab]
  );

  const columns: Column<BatchRow>[] = [
    { key: "batch", header: "Batch", render: (row) => row.batchNumber, sortValue: (row) => row.batchNumber },
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
    { key: "supplier", header: "Supplier", render: (row) => row.supplierName ?? "—" },
    {
      key: "received",
      header: "Received",
      numeric: true,
      render: (row) => formatNumber(row.quantityReceived),
      sortValue: (row) => row.quantityReceived,
    },
    {
      key: "available",
      header: "Available",
      numeric: true,
      render: (row) => formatNumber(row.quantityAvailable),
      sortValue: (row) => row.quantityAvailable,
    },
    ...(data.canViewCost
      ? [
          {
            key: "cost",
            header: "Unit cost",
            numeric: true,
            render: (row: BatchRow) => formatMoney(row.unitCost, data.currency),
            sortValue: (row: BatchRow) => row.unitCost ?? 0,
          },
          {
            key: "value",
            header: "Stock value",
            numeric: true,
            render: (row: BatchRow) => formatMoney(row.stockValue, data.currency),
            sortValue: (row: BatchRow) => row.stockValue ?? 0,
          },
        ]
      : []),
    {
      key: "expiry",
      header: "Expiry",
      render: (row) => <ExpiryCell date={row.expiryDate} days={row.daysToExpiry} />,
      sortValue: (row) => row.expiryDate ?? "9999-12-31",
    },
    { key: "source", header: "Source", render: (row) => row.sourceType?.replace(/_/g, " ") ?? "—" },
    { key: "received_at", header: "Received", render: (row) => formatDate(row.receivedAt) },
    { key: "status", header: "Status", render: (row) => <Status value={row.status} /> },
  ];

  const adjustableBatches = data.batches.filter((batch) => batch.status === "active");

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Stock · ${data.entityName}`}
        title="Inventory"
        description="Stock held by batch, with expiry dates. Quantities can only be changed through a stock correction, which records a reason and an audit entry."
      >
        {data.canAdjust && (
          <>
            <button
              className="crm-button crm-button-primary"
              type="button"
              onClick={() => toggleForm("adjust")}
            >
              {openForm === "adjust" ? "Close" : "Stock correction"} <i>+</i>
            </button>
            <button
              className="crm-button crm-button-secondary"
              type="button"
              onClick={() => toggleForm("count")}
            >
              Stock count <i>↗</i>
            </button>
            <button
              className="crm-button crm-button-secondary"
              type="button"
              onClick={() => toggleForm("transfer")}
            >
              Transfer <i>↗</i>
            </button>
          </>
        )}
        {data.canExport && (
          <a className="crm-button crm-button-secondary" href="/api/reports/export?report=current-stock">
            Export <i>↓</i>
          </a>
        )}
      </PageHead>

      <StatStrip stats={data.stats} />

      {!data.canAdjust && <PermissionNotice what="correct stock quantities" />}

      {openForm === "adjust" && data.canAdjust && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Stock correction"
            note="Records the previous and new quantity, your reason and an audit entry. Stock cannot be corrected below zero."
          />
          <form action={adjustAction} className="crm-form-grid">
            <label>
              <span>Batch</span>
              <select name="batch_id" required>
                <option value="">Select batch</option>
                {adjustableBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batchNumber} · {batch.productName} · {batch.quantityAvailable} available
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Adjustment (+ or −)</span>
              <input name="delta" type="number" step="1" required placeholder="-3" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Reason (required)</span>
              <input name="reason" required placeholder="Recount after shelf audit" />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  adjustState == null
                    ? null
                    : adjustState.ok
                      ? { ok: true, message: "Stock corrected and recorded in the ledger." }
                      : { ok: false, message: adjustState.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setOpenRequest(null)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={adjusting}>
                {adjusting ? "Saving…" : "Apply correction"}
              </button>
            </div>
          </form>
        </section>
      )}

      {openForm === "count" && data.canAdjust && (
        <section className="crm-panel crm-enter">
          <SectionHead title="Stock count" note="Any variance is posted as a stock correction." />
          <form action={countAction} className="crm-form-grid">
            <label>
              <span>Batch</span>
              <select name="batch_id" required>
                <option value="">Select batch</option>
                {adjustableBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batchNumber} · {batch.productName} · expected {batch.quantityAvailable}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Counted quantity</span>
              <input name="counted_qty" type="number" min="0" required />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  countState == null
                    ? null
                    : countState.ok
                      ? { ok: true, message: "Stock count recorded." }
                      : { ok: false, message: countState.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setOpenRequest(null)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={counting}>
                {counting ? "Saving…" : "Submit count"}
              </button>
            </div>
          </form>
        </section>
      )}

      {openForm === "transfer" && data.canAdjust && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Transfer stock to another entity"
            note="Creates the destination batch first, then reduces the source, so a failure cannot lose stock."
          />
          <form action={transferAction} className="crm-form-grid">
            <label>
              <span>Batch</span>
              <select name="batch_id" required>
                <option value="">Select batch</option>
                {adjustableBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batchNumber} · {batch.productName} · {batch.quantityAvailable} available
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Destination entity</span>
              <select name="to_branch_id" required>
                <option value="">Select entity</option>
                {data.entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Quantity</span>
              <input name="quantity" type="number" min="1" required />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  transferState == null
                    ? null
                    : transferState.ok
                      ? { ok: true, message: "Stock transferred." }
                      : { ok: false, message: transferState.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setOpenRequest(null)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={transferring}>
                {transferring ? "Transferring…" : "Transfer stock"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Inventory views">
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

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title={tab} note={`${rows.length} batch${rows.length === 1 ? "" : "es"}.`} />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(row) => row.id}
          searchPlaceholder="Search by batch, product, SKU or supplier…"
          emptyMessage="No batches match this view."
        />
      </section>
    </div>
  );
}

