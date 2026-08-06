"use client";

import { useActionState, useState, useTransition } from "react";
import {
  cancelStockInward,
  confirmStockInward,
  createStockInward,
  importInwardLines,
} from "../actions/stock-inward";
import type { StockInwardData, StockInwardRow } from "@/lib/data/stockDocuments";
import { INWARD_TYPE_OPTIONS } from "@/lib/stock-vocabulary";
import type { StockInwardType } from "@/lib/types";
import {
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  useActionPanel,
} from "./shared";

type LineDraft = {
  key: number;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  freeQuantity: string;
  unitCost: string;
};

function blankLine(key: number): LineDraft {
  return {
    key,
    productId: "",
    batchNumber: "",
    expiryDate: "",
    quantity: "",
    freeQuantity: "0",
    unitCost: "0",
  };
}

export function StockInwardView({ data }: { data: StockInwardData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<StockInwardRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();

  const [createState, createAction, creating] = useActionState(createStockInward, null);
  const [importState, importAction, importing] = useActionState(importInwardLines, null);
  const [showForm, setShowForm] = useActionPanel(createState);

  const drafts = data.documents.filter((doc) => doc.status === "draft");

  function confirmDocument(row: StockInwardRow) {
    setMessage(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await confirmStockInward(row.id);
      setBusyId(null);
      setConfirmTarget(null);
      setMessage(
        result.ok
          ? { ok: true, message: `${row.reference} confirmed. Stock is now in inventory.` }
          : { ok: false, message: result.error }
      );
    });
  }

  function cancelDocument(row: StockInwardRow) {
    setMessage(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await cancelStockInward(row.id);
      setBusyId(null);
      setMessage(
        result.ok
          ? { ok: true, message: `${row.reference} cancelled.` }
          : { ok: false, message: result.error }
      );
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Stock · ${data.entityName}`}
        title="Stock inward"
        description="Purchases, free goods and replacements. A document is a draft until it is confirmed — stock only enters inventory on confirmation."
      >
        {data.canCreate && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close" : "New inward document"} <i>+</i>
          </button>
        )}
        <a className="crm-button crm-button-secondary" href="/api/imports/template?kind=stock_inward">
          Download template <i>↓</i>
        </a>
        <a className="crm-button crm-button-secondary" href="/api/reports/export?report=stock-inward">
          Export <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {!data.canCreate && <PermissionNotice what="create stock inward documents" />}

      {showForm && data.canCreate && (
        <InwardForm
          data={data}
          action={createAction}
          pending={creating}
          state={createState}
          onCancel={() => setShowForm(false)}
        />
      )}

      {data.canCreate && drafts.length > 0 && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Import lines into a draft"
            note="Rows are validated against this entity's SKUs; nothing is added unless every row is readable."
          />
          <form action={importAction} className="crm-form-grid">
            <label>
              <span>Draft document</span>
              <select name="inward_id" required>
                {drafts.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.reference} · {doc.inwardTypeLabel}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Spreadsheet (.xlsx or .csv)</span>
              <input type="file" name="file" accept=".xlsx,.csv" required />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  importState == null || importState.status === "idle"
                    ? null
                    : importState.status === "error"
                      ? { ok: false, message: importState.error }
                      : {
                          ok: true,
                          message: `${importState.lines} line${importState.lines === 1 ? "" : "s"} added to ${importState.reference}.`,
                        }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-primary" type="submit" disabled={importing}>
                {importing ? "Importing…" : "Import lines"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead
          title="Documents"
          note={`${data.documents.length} document${data.documents.length === 1 ? "" : "s"}.`}
        />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Type</th>
                <th>Supplier</th>
                <th>Invoice</th>
                <th style={{ textAlign: "right" }}>Lines</th>
                <th style={{ textAlign: "right" }}>Units</th>
                <th style={{ textAlign: "right" }}>Free</th>
                {data.canViewCost && <th style={{ textAlign: "right" }}>Total cost</th>}
                <th>Status</th>
                <th>Created by</th>
                <th>Confirmed</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.documents.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No stock inward documents yet.
                  </td>
                </tr>
              )}
              {data.documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <button
                      className="crm-row-action"
                      type="button"
                      onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}
                    >
                      {doc.reference}
                    </button>
                  </td>
                  <td>{doc.inwardTypeLabel}</td>
                  <td>{doc.supplierName ?? "—"}</td>
                  <td>
                    {doc.invoiceNumber ?? "—"}
                    {doc.invoiceDate && (
                      <>
                        <br />
                        <small style={{ opacity: 0.7 }}>{formatDate(doc.invoiceDate)}</small>
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{doc.lines.length}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(doc.totalQuantity)}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(doc.totalFree)}</td>
                  {data.canViewCost && (
                    <td style={{ textAlign: "right" }}>{formatMoney(doc.totalCost)}</td>
                  )}
                  <td>
                    <Status value={doc.status} />
                  </td>
                  <td>{doc.createdBy ?? "—"}</td>
                  <td>
                    {doc.confirmedBy ? (
                      <>
                        {doc.confirmedBy}
                        <br />
                        <small style={{ opacity: 0.7 }}>{formatDateTime(doc.confirmedAt)}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {doc.status === "draft" && data.canCreate && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === doc.id}
                          onClick={() => setConfirmTarget(doc)}
                        >
                          Confirm
                        </button>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === doc.id}
                          onClick={() => cancelDocument(doc)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {expanded && <LineDetail doc={data.documents.find((d) => d.id === expanded)!} canViewCost={data.canViewCost} />}
      </section>

      {confirmTarget && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Confirm ${confirmTarget.reference}?`}
            note="This creates the batches and posts the ledger movements. It cannot be undone — a mistake afterwards needs a stock correction."
          />
          <div className="crm-form-actions">
            <button
              className="crm-button crm-button-secondary"
              type="button"
              onClick={() => setConfirmTarget(null)}
            >
              Keep as draft
            </button>
            <button
              className="crm-button crm-button-primary"
              type="button"
              disabled={busyId === confirmTarget.id}
              onClick={() => confirmDocument(confirmTarget)}
            >
              {busyId === confirmTarget.id ? "Confirming…" : "Confirm and receive stock"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function LineDetail({ doc, canViewCost }: { doc: StockInwardRow; canViewCost: boolean }) {
  return (
    <div style={{ marginTop: 16 }}>
      <SectionHead title={`Lines · ${doc.reference}`} note={doc.notes ?? undefined} />
      {doc.supplierReturnReference && (
        <p style={{ opacity: 0.8 }}>
          Replacement for supplier return <strong>{doc.supplierReturnReference}</strong>.
        </p>
      )}
      {doc.documentUrl && (
        <p>
          <a href={doc.documentUrl} target="_blank" rel="noreferrer">
            Attached document ↗
          </a>
        </p>
      )}
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Batch</th>
              <th>Expiry</th>
              <th style={{ textAlign: "right" }}>Quantity</th>
              <th style={{ textAlign: "right" }}>Free</th>
              {canViewCost && <th style={{ textAlign: "right" }}>Unit cost</th>}
              {canViewCost && <th style={{ textAlign: "right" }}>Total</th>}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.sku}</strong>
                </td>
                <td>{line.productName}</td>
                <td>{line.batchNumber}</td>
                <td>{formatDate(line.expiryDate)}</td>
                <td style={{ textAlign: "right" }}>{formatNumber(line.quantity)}</td>
                <td style={{ textAlign: "right" }}>{formatNumber(line.freeQuantity)}</td>
                {canViewCost && <td style={{ textAlign: "right" }}>{formatMoney(line.unitCost)}</td>}
                {canViewCost && <td style={{ textAlign: "right" }}>{formatMoney(line.totalCost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InwardForm({
  data,
  action,
  pending,
  state,
  onCancel,
}: {
  data: StockInwardData;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { ok: true } | { ok: false; error: string } | null;
  onCancel: () => void;
}) {
  const [inwardType, setInwardType] = useState<StockInwardType>("purchase_from_external");
  const [lines, setLines] = useState<LineDraft[]>([blankLine(0)]);
  const [nextKey, setNextKey] = useState(1);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <section className="crm-panel crm-enter">
      <SectionHead
        title="New stock inward document"
        note="Saved as a draft. Stock does not move until you confirm it."
      />
      <form action={action} className="crm-form-grid">
        <label>
          <span>Inward type</span>
          <select
            name="inward_type"
            value={inwardType}
            onChange={(event) => setInwardType(event.target.value as StockInwardType)}
          >
            {INWARD_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Supplier{inwardType === "foc_or_sample" ? " (optional)" : ""}</span>
          <select name="supplier_id" required={inwardType !== "foc_or_sample"}>
            <option value="">Select supplier</option>
            {data.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
                {supplier.supplierType === "parent" ? " (parent)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Invoice / reference number</span>
          <input name="invoice_number" placeholder="INV-4471" />
        </label>
        <label>
          <span>Invoice date</span>
          <input name="invoice_date" type="date" />
        </label>
        {inwardType === "replacement_in" && (
          <label>
            <span>Original supplier return</span>
            <select name="supplier_return_id">
              <option value="">Not linked</option>
              {data.openSupplierReturns.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.reference} · {record.productName} · {record.quantity}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Document attachment URL</span>
          <input name="document_url" placeholder="https://…" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span>Notes</span>
          <input name="notes" />
        </label>

        <div style={{ gridColumn: "1 / -1" }}>
          <SectionHead title="Line items">
            <button
              className="crm-row-action"
              type="button"
              onClick={() => {
                setLines((current) => [...current, blankLine(nextKey)]);
                setNextKey((key) => key + 1);
              }}
            >
              Add line
            </button>
          </SectionHead>

          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch number</th>
                  <th>Expiry</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th style={{ textAlign: "right" }}>Free qty</th>
                  {data.canViewCost && <th style={{ textAlign: "right" }}>Unit cost</th>}
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key}>
                    <td>
                      <select
                        name={`line_${index}_product_id`}
                        value={line.productId}
                        onChange={(event) => {
                          const productId = event.target.value;
                          const product = data.products.find((item) => item.id === productId);
                          updateLine(line.key, {
                            productId,
                            unitCost:
                              product?.buyPrice != null ? String(product.buyPrice) : line.unitCost,
                          });
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
                    </td>
                    <td>
                      <input
                        name={`line_${index}_batch_number`}
                        value={line.batchNumber}
                        onChange={(event) => updateLine(line.key, { batchNumber: event.target.value })}
                        required
                      />
                    </td>
                    <td>
                      <input
                        name={`line_${index}_expiry_date`}
                        type="date"
                        value={line.expiryDate}
                        onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        name={`line_${index}_quantity`}
                        type="number"
                        min="0"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        style={{ width: 90, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        name={`line_${index}_free_quantity`}
                        type="number"
                        min="0"
                        value={line.freeQuantity}
                        onChange={(event) => updateLine(line.key, { freeQuantity: event.target.value })}
                        style={{ width: 90, textAlign: "right" }}
                      />
                    </td>
                    {data.canViewCost ? (
                      <td style={{ textAlign: "right" }}>
                        <input
                          name={`line_${index}_unit_cost`}
                          type="number"
                          min="0"
                          value={line.unitCost}
                          onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                          style={{ width: 110, textAlign: "right" }}
                        />
                      </td>
                    ) : (
                      <input type="hidden" name={`line_${index}_unit_cost`} value="0" />
                    )}
                    <td>
                      {lines.length > 1 && (
                        <button
                          className="crm-row-action"
                          type="button"
                          onClick={() =>
                            setLines((current) => current.filter((item) => item.key !== line.key))
                          }
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <Feedback
            state={
              state == null
                ? null
                : state.ok
                  ? { ok: true, message: "Draft created. Confirm it to receive the stock." }
                  : { ok: false, message: state.error }
            }
          />
        </div>

        <div className="crm-form-actions">
          <button className="crm-button crm-button-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>
    </section>
  );
}
