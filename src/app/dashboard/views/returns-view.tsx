"use client";

import { useActionState, useState, useTransition } from "react";
import { approveReturn, createReturn, rejectReturn } from "../actions/returns";
import type { ReturnsData, StockOutRow } from "@/lib/data/returns";
import { STOCK_OUT_TYPES } from "@/lib/stock-vocabulary";
import type { StockOutType } from "@/lib/types";
import {
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDate,
  formatDateTime,
  useActionPanel,
} from "./shared";

const TABS: Array<{ label: string; value: StockOutType | "all" }> = [
  { label: "All", value: "all" },
  { label: "Employee consumption", value: "employee_consumption" },
  { label: "Expiry", value: "expired" },
  { label: "Damage", value: "damaged" },
  { label: "Supplier return", value: "supplier" },
  { label: "Customer return", value: "customer" },
];

export function ReturnsView({ data }: { data: ReturnsData }) {
  const [tab, setTab] = useState<StockOutType | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();

  const [createState, createAction, creating] = useActionState(createReturn, null);
  const [showForm, setShowForm] = useActionPanel(createState);

  const rows = tab === "all" ? data.records : data.records.filter((row) => row.type === tab);

  function run(row: StockOutRow, approve: boolean) {
    setMessage(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = approve ? await approveReturn(row.id) : await rejectReturn(row.id);
      setBusyId(null);
      setMessage(
        result.ok
          ? {
              ok: true,
              message: approve
                ? `${row.reference} approved. Stock ${row.type === "customer" ? "returned to" : "removed from"} inventory.`
                : `${row.reference} rejected. Stock was not moved.`,
            }
          : { ok: false, message: result.error }
      );
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Stock · ${data.entityName}`}
        title="Stock out"
        description="Employee consumption, expiry and damage write-offs, supplier returns and customer returns. Stock only moves when a record is approved."
      >
        {data.canCreate && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close" : "New stock-out record"} <i>+</i>
          </button>
        )}
        <a className="crm-button crm-button-secondary" href="/api/reports/export?report=stock-outward">
          Export <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {!data.canCreate && !data.canApprove && (
        <PermissionNotice what="record or approve stock movements out" />
      )}

      {showForm && data.canCreate && (
        <StockOutForm
          data={data}
          action={createAction}
          pending={creating}
          state={createState}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="crm-tabs" role="tablist" aria-label="Stock-out types">
        {TABS.map((item) => (
          <button
            className={tab === item.value ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            key={item.value}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title="Records" note={`${rows.length} record${rows.length === 1 ? "" : "s"}.`} />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Type</th>
                <th>Product</th>
                <th>Batch</th>
                <th style={{ textAlign: "right" }}>Quantity</th>
                <th>Reason</th>
                <th>Detail</th>
                <th>Requested by</th>
                <th>Approved by</th>
                <th>Status</th>
                <th>When</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No stock-out records yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.reference}</strong>
                  </td>
                  <td>{row.typeLabel}</td>
                  <td>
                    {row.productName}
                    <br />
                    <small style={{ opacity: 0.7 }}>{row.sku}</small>
                  </td>
                  <td>
                    {row.batchNumber ?? "—"}
                    {row.batchExpiry && (
                      <>
                        <br />
                        <small style={{ opacity: 0.7 }}>exp {formatDate(row.batchExpiry)}</small>
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.type === "customer" ? `+${row.quantity}` : `−${row.quantity}`}
                  </td>
                  <td>{row.reason ?? "—"}</td>
                  <td>
                    {row.resolutionType ?? row.refundMethod ?? row.consumedByName ?? "—"}
                    {row.originalPoNumber && (
                      <>
                        <br />
                        <small style={{ opacity: 0.7 }}>PO {row.originalPoNumber}</small>
                      </>
                    )}
                    {row.originalSaleInvoice && (
                      <>
                        <br />
                        <small style={{ opacity: 0.7 }}>{row.originalSaleInvoice}</small>
                      </>
                    )}
                  </td>
                  <td>{row.requestedBy ?? "—"}</td>
                  <td>
                    {row.approvedBy ? (
                      <>
                        {row.approvedBy}
                        <br />
                        <small style={{ opacity: 0.7 }}>{formatDateTime(row.approvedAt)}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Status value={row.status} />
                  </td>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>
                    {row.status === "pending" && data.canApprove && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => run(row, true)}
                        >
                          {busyId === row.id ? "Working…" : "Approve"}
                        </button>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => run(row, false)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StockOutForm({
  data,
  action,
  pending,
  state,
  onCancel,
}: {
  data: ReturnsData;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { ok: true } | { ok: false; error: string } | null;
  onCancel: () => void;
}) {
  const [type, setType] = useState<StockOutType>("employee_consumption");
  const [productId, setProductId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [quantity, setQuantity] = useState("");

  const batches = data.batches.filter((batch) => batch.productId === productId);
  const selectedBatch = batches.find((batch) => batch.id === batchId);
  const overAvailable =
    selectedBatch != null && Number(quantity) > selectedBatch.quantityAvailable && type !== "customer";
  const description = STOCK_OUT_TYPES.find((option) => option.value === type)?.description ?? "";

  return (
    <section className="crm-panel crm-enter">
      <SectionHead
        title="New stock-out record"
        note="Saved as pending. Approving a customer return adds stock back; every other type removes it."
      />
      <form action={action} className="crm-form-grid">
        <label>
          <span>Type</span>
          <select name="type" value={type} onChange={(event) => setType(event.target.value as StockOutType)}>
            {STOCK_OUT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Product</span>
          <select
            name="product_id"
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setBatchId("");
            }}
            required
          >
            <option value="">Select product</option>
            {data.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} · {product.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Batch</span>
          <select
            name="batch_id"
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
            required
            disabled={!productId}
          >
            <option value="">{productId ? "Select batch" : "Choose a product first"}</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.batchNumber}
                {batch.expiryDate ? ` · exp ${batch.expiryDate}` : ""} · {batch.quantityAvailable} available
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Quantity</span>
          <input
            name="quantity"
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </label>

        {type === "employee_consumption" && (
          <label>
            <span>Employee consuming the stock</span>
            <select name="consumed_by" required>
              <option value="">Select employee</option>
              {data.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "expired" && (
          <label>
            <span>Expiry date</span>
            <input name="expiry_date" type="date" defaultValue={selectedBatch?.expiryDate ?? ""} />
          </label>
        )}

        {type === "supplier" && (
          <>
            <label>
              <span>Resolution</span>
              <select name="resolution_type" required>
                <option value="">Select resolution</option>
                <option value="credit">Credit note</option>
                <option value="refund">Refund</option>
                <option value="replacement">Replacement</option>
              </select>
            </label>
            <label>
              <span>Original purchase order (optional)</span>
              <select name="original_po_id">
                <option value="">Not linked</option>
                {data.purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNumber}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {type === "customer" && (
          <>
            <label>
              <span>Refund method</span>
              <input name="refund_method" placeholder="Cash" />
            </label>
            <label>
              <span>Original sale (optional)</span>
              <select name="original_sale_id">
                <option value="">Not linked</option>
                {data.sales.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.invoiceNumber}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label style={{ gridColumn: "1 / -1" }}>
          <span>
            Reason (required)
            {type === "damaged" ? " — describe the damage and where the evidence is filed" : ""}
          </span>
          <input name="reason" required />
        </label>

        <p style={{ gridColumn: "1 / -1", opacity: 0.75, fontSize: "0.9em" }}>{description}</p>

        {overAvailable && selectedBatch && (
          <p className="login-error" role="alert" style={{ gridColumn: "1 / -1" }}>
            Only {selectedBatch.quantityAvailable} available in batch {selectedBatch.batchNumber}. The
            server will reject a larger write-off.
          </p>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <Feedback
            state={
              state == null
                ? null
                : state.ok
                  ? { ok: true, message: "Record created and awaiting approval." }
                  : { ok: false, message: state.error }
            }
          />
        </div>

        <div className="crm-form-actions">
          <button className="crm-button crm-button-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Create record"}
          </button>
        </div>
      </form>
    </section>
  );
}
