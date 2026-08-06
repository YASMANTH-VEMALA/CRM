"use client";

import { useActionState, useState, useTransition } from "react";
import {
  cancelOpeningStock,
  confirmOpeningStock,
  createOpeningStock,
  importOpeningStockLines,
} from "../actions/opening-stock";
import type { OpeningStockData, OpeningStockRow } from "@/lib/data/stockDocuments";
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
  unitCost: string;
  sellPrice: string;
};

function blankLine(key: number): LineDraft {
  return { key, productId: "", batchNumber: "", expiryDate: "", quantity: "", unitCost: "0", sellPrice: "" };
}

export function OpeningStockView({ data }: { data: OpeningStockData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<OpeningStockRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();

  const [createState, createAction, creating] = useActionState(createOpeningStock, null);
  const [importState, importAction, importing] = useActionState(importOpeningStockLines, null);
  const [showForm, setShowForm] = useActionPanel(createState);

  const drafts = data.entries.filter((entry) => entry.status === "draft");

  function confirmEntry(row: OpeningStockRow) {
    setMessage(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await confirmOpeningStock(row.id);
      setBusyId(null);
      setConfirmTarget(null);
      setMessage(
        result.ok
          ? { ok: true, message: `${row.reference} confirmed and locked.` }
          : { ok: false, message: result.error }
      );
    });
  }

  function cancelEntry(row: OpeningStockRow) {
    setMessage(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await cancelOpeningStock(row.id);
      setBusyId(null);
      setMessage(
        result.ok ? { ok: true, message: `${row.reference} cancelled.` } : { ok: false, message: result.error }
      );
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Stock · ${data.entityName}`}
        title="Opening stock"
        description="The starting inventory position for this entity. Confirming an entry creates the batches and posts OPENING_STOCK ledger movements; after that the entry is locked."
      >
        {data.canCreate && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close" : "New opening stock entry"} <i>+</i>
          </button>
        )}
        <a className="crm-button crm-button-secondary" href="/api/imports/template?kind=opening_stock">
          Download template <i>↓</i>
        </a>
        <a className="crm-button crm-button-secondary" href="/api/reports/export?report=opening-stock">
          Export <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {!data.canCreate && <PermissionNotice what="enter opening stock" />}

      {showForm && data.canCreate && (
        <OpeningForm
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
            note="Every row must resolve to a SKU in this entity; otherwise nothing is imported."
          />
          <form action={importAction} className="crm-form-grid">
            <label>
              <span>Draft entry</span>
              <select name="entry_id" required>
                {drafts.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.reference} · {formatDate(entry.openingDate)}
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
          title="Entries"
          note={`${data.entries.length} entr${data.entries.length === 1 ? "y" : "ies"}.`}
        />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Opening date</th>
                <th style={{ textAlign: "right" }}>Lines</th>
                <th style={{ textAlign: "right" }}>Units</th>
                {data.canViewCost && <th style={{ textAlign: "right" }}>Value</th>}
                <th>Status</th>
                <th>Created by</th>
                <th>Confirmed</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No opening stock has been entered for this entity yet.
                  </td>
                </tr>
              )}
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <button
                      className="crm-row-action"
                      type="button"
                      onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    >
                      {entry.reference}
                    </button>
                  </td>
                  <td>{formatDate(entry.openingDate)}</td>
                  <td style={{ textAlign: "right" }}>{entry.lines.length}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(entry.totalQuantity)}</td>
                  {data.canViewCost && (
                    <td style={{ textAlign: "right" }}>{formatMoney(entry.totalValue)}</td>
                  )}
                  <td>
                    <Status value={entry.status} />
                  </td>
                  <td>{entry.createdBy ?? "—"}</td>
                  <td>
                    {entry.confirmedBy ? (
                      <>
                        {entry.confirmedBy}
                        <br />
                        <small style={{ opacity: 0.7 }}>{formatDateTime(entry.confirmedAt)}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {entry.status === "draft" && data.canCreate ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === entry.id}
                          onClick={() => setConfirmTarget(entry)}
                        >
                          Confirm
                        </button>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === entry.id}
                          onClick={() => cancelEntry(entry)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : entry.status === "confirmed" ? (
                      <small style={{ opacity: 0.7 }}>Locked</small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {expanded && (
          <OpeningDetail
            entry={data.entries.find((entry) => entry.id === expanded)!}
            canViewCost={data.canViewCost}
          />
        )}
      </section>

      {confirmTarget && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Confirm ${confirmTarget.reference}?`}
            note="This creates the batches and posts the opening ledger movements. Confirmed opening stock is permanently locked — later corrections require a stock correction on the Inventory screen, with a reason and an audit record."
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
              onClick={() => confirmEntry(confirmTarget)}
            >
              {busyId === confirmTarget.id ? "Confirming…" : "Confirm opening stock"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function OpeningDetail({ entry, canViewCost }: { entry: OpeningStockRow; canViewCost: boolean }) {
  return (
    <div style={{ marginTop: 16 }}>
      <SectionHead title={`Lines · ${entry.reference}`} note={entry.notes ?? undefined} />
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Batch</th>
              <th>Expiry</th>
              <th style={{ textAlign: "right" }}>Quantity</th>
              {canViewCost && <th style={{ textAlign: "right" }}>Purchase cost</th>}
              <th style={{ textAlign: "right" }}>Selling price</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.sku}</strong>
                </td>
                <td>{line.productName}</td>
                <td>{line.batchNumber}</td>
                <td>{formatDate(line.expiryDate)}</td>
                <td style={{ textAlign: "right" }}>{formatNumber(line.quantity)}</td>
                {canViewCost && <td style={{ textAlign: "right" }}>{formatMoney(line.unitCost)}</td>}
                <td style={{ textAlign: "right" }}>{formatMoney(line.sellPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpeningForm({
  data,
  action,
  pending,
  state,
  onCancel,
}: {
  data: OpeningStockData;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { ok: true } | { ok: false; error: string } | null;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState<LineDraft[]>([blankLine(0)]);
  const [nextKey, setNextKey] = useState(1);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <section className="crm-panel crm-enter">
      <SectionHead title="New opening stock entry" note="Saved as a draft until you confirm it." />
      <form action={action} className="crm-form-grid">
        <label>
          <span>Opening date</span>
          <input name="opening_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>
        <label>
          <span>Notes</span>
          <input name="notes" placeholder="Stock take at handover" />
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
                  {data.canViewCost && <th style={{ textAlign: "right" }}>Purchase cost</th>}
                  <th style={{ textAlign: "right" }}>Selling price</th>
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
                            unitCost: product?.buyPrice != null ? String(product.buyPrice) : line.unitCost,
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
                        min="1"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        style={{ width: 90, textAlign: "right" }}
                        required
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
                    <td style={{ textAlign: "right" }}>
                      <input
                        name={`line_${index}_sell_price`}
                        type="number"
                        min="0"
                        value={line.sellPrice}
                        onChange={(event) => updateLine(line.key, { sellPrice: event.target.value })}
                        style={{ width: 110, textAlign: "right" }}
                      />
                    </td>
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
                  ? { ok: true, message: "Draft created. Confirm it to post the opening balances." }
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
