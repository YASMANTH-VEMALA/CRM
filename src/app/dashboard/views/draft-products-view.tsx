"use client";

import { useActionState, useState, useTransition } from "react";
import {
  commitProductImport,
  confirmDraftProduct,
  previewProductImport,
  rejectDraftProduct,
  resolveDraftDuplicate,
  updateDraftProduct,
} from "../actions/imports";
import type { DraftProductRow, DraftProductsData } from "@/lib/data/draftProducts";
import {
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDateTime,
  formatMoney,
} from "./shared";

const TABS = ["Pending", "Confirmed", "Rejected"] as const;
type Tab = (typeof TABS)[number];

export function DraftProductsView({ data }: { data: DraftProductsData }) {
  const [tab, setTab] = useState<Tab>("Pending");
  const [expandedImport, setExpandedImport] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const [previewState, previewAction, previewing] = useActionState(previewProductImport, null);
  const [commitState, commitAction, committing] = useActionState(commitProductImport, null);
  const [editState, editAction, editPending] = useActionState(updateDraftProduct, null);

  // The edit panel closes when the save succeeds, derived from the action
  // result rather than synchronised in an effect.
  const [editTarget, setEditTarget] = useState<{ row: DraftProductRow; seen: unknown } | null>(null);
  const editSucceeded =
    editTarget !== null && editTarget.seen !== editState && Boolean(editState?.ok);
  const editing = editTarget && !editSucceeded ? editTarget.row : null;

  function openEditor(row: DraftProductRow) {
    setEditTarget({ row, seen: editState });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const rows = data.drafts.filter((draft) => draft.status === tab.toLowerCase());

  function run(id: string, work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await work();
      setBusyId(null);
      setMessage(
        result.ok ? { ok: true, message: success } : { ok: false, message: result.error ?? "Failed." }
      );
    });
  }

  // The commit step re-submits the validated rows the preview produced, so a
  // second parse cannot introduce different data than the user approved.
  const preview = previewState?.status === "preview" ? previewState : null;
  const committed = commitState?.status === "committed" ? commitState : null;

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Catalogue · ${data.entityName}`}
        title="Draft products and imports"
        description="Imported rows land here for review. Only confirmed drafts become active, sellable products."
      >
        <a className="crm-button crm-button-secondary" href="/api/imports/template?kind=products">
          Download template <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {!data.canImport && <PermissionNotice what="import products" />}

      {data.canImport && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Import products"
            note="Step 1 — choose a file. Nothing is written until you confirm the preview."
          />

          <form action={previewAction} className="crm-form-grid">
            <label>
              <span>Spreadsheet (.xlsx or .csv, max 5 MB)</span>
              <input type="file" name="file" accept=".xlsx,.csv" required />
            </label>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-primary" type="submit" disabled={previewing}>
                {previewing ? "Validating…" : "Validate file"}
              </button>
            </div>
          </form>

          {previewState?.status === "error" && (
            <Feedback state={{ ok: false, message: previewState.error }} />
          )}
          {commitState?.status === "error" && (
            <Feedback state={{ ok: false, message: commitState.error }} />
          )}
          {committed && (
            <Feedback
              state={{
                ok: true,
                message: `${committed.filename}: ${committed.drafts} draft${committed.drafts === 1 ? "" : "s"} created${committed.skipped > 0 ? `, ${committed.skipped} invalid row(s) skipped` : ""}.`,
              }}
            />
          )}

          {preview && (
            <div style={{ marginTop: 16 }}>
              <SectionHead
                title={`Step 2 — preview of ${preview.filename}`}
                note={`${preview.totalRows} row${preview.totalRows === 1 ? "" : "s"} read · ${preview.validRows} valid · ${preview.invalidRows} invalid · ${preview.duplicateRows} duplicate.`}
              />

              {preview.errors.length > 0 && (
                <>
                  <h4>Row errors ({preview.errors.length})</h4>
                  <div className="crm-table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errors.map((error) => (
                          <tr key={error.row}>
                            <td>
                              <strong>{error.row}</strong>
                            </td>
                            <td>{error.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {preview.duplicates.length > 0 && (
                <>
                  <h4>Duplicates skipped ({preview.duplicates.length})</h4>
                  <div className="crm-table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Product</th>
                          <th>SKU</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.duplicates.map((duplicate) => (
                          <tr key={`${duplicate.row}-${duplicate.name}`}>
                            <td>
                              <strong>{duplicate.row}</strong>
                            </td>
                            <td>{duplicate.name}</td>
                            <td>{duplicate.sku ?? "—"}</td>
                            <td>{duplicate.label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <form action={commitAction} style={{ marginTop: 16 }}>
                <input type="hidden" name="filename" value={preview.filename} />
                <input type="hidden" name="file_hash" value={preview.fileHash} />
                <input type="hidden" name="payload" value={preview.payload} />
                <input type="hidden" name="total_rows" value={String(preview.totalRows)} />
                <input type="hidden" name="invalid_rows" value={String(preview.invalidRows)} />
                <input type="hidden" name="errors" value={JSON.stringify(preview.errors)} />
                <div className="crm-form-actions">
                  <button
                    className="crm-button crm-button-primary"
                    type="submit"
                    disabled={committing || preview.validRows === 0}
                  >
                    {committing
                      ? "Importing…"
                      : `Step 3 — import ${preview.validRows} row${preview.validRows === 1 ? "" : "s"} as drafts`}
                  </button>
                </div>
                {preview.validRows === 0 && (
                  <p style={{ opacity: 0.75 }}>
                    There are no valid rows to import. Fix the file and validate it again.
                  </p>
                )}
              </form>
            </div>
          )}
        </section>
      )}

      {editing && (
        <section className="crm-panel crm-enter">
          <SectionHead title={`Edit draft · ${editing.name}`} />
          <form action={editAction} className="crm-form-grid">
            <input type="hidden" name="draft_id" value={editing.id} />
            <label>
              <span>Product name</span>
              <input name="name" required defaultValue={editing.name} />
            </label>
            <label>
              <span>SKU</span>
              <input name="sku" defaultValue={editing.sku ?? ""} />
            </label>
            <label>
              <span>Barcode</span>
              <input name="barcode" defaultValue={editing.barcode ?? ""} />
            </label>
            <label>
              <span>Category name</span>
              <input name="category_name" defaultValue={editing.categoryName ?? ""} />
            </label>
            <label>
              <span>Manufacturer</span>
              <input name="manufacturer" defaultValue={editing.manufacturer ?? ""} />
            </label>
            <label>
              <span>Unit / pack size</span>
              <input name="unit" defaultValue={editing.unit ?? ""} />
            </label>
            <label>
              <span>Supplier name</span>
              <input name="supplier_name" defaultValue={editing.supplierName ?? ""} />
            </label>
            <label>
              <span>Purchase cost</span>
              <input name="buy_price" type="number" min="0" step="1" defaultValue={editing.buyPrice ?? 0} />
            </label>
            <label>
              <span>Pricing method</span>
              <select name="pricing_method" defaultValue={editing.pricingMethod}>
                <option value="fixed">FIXED</option>
                <option value="cost_plus_margin">COST_PLUS_MARGIN</option>
              </select>
            </label>
            <label>
              <span>Margin %</span>
              <input name="margin_percent" type="number" min="0" step="0.1" defaultValue={editing.marginPercent} />
            </label>
            <label>
              <span>Selling price</span>
              <input name="sell_price" type="number" min="0" step="1" defaultValue={editing.sellPrice} />
            </label>
            <label>
              <span>Max discount %</span>
              <input
                name="max_discount_percent"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={editing.maxDiscountPercent}
              />
            </label>
            <label>
              <span>Minimum stock</span>
              <input name="reorder_level" type="number" min="0" defaultValue={editing.reorderLevel} />
            </label>
            <label>
              <span>Restock target</span>
              <input name="restock_target" type="number" min="0" defaultValue={editing.restockTarget} />
            </label>
            <label>
              <span>Product image URL</span>
              <input name="image_url" defaultValue={editing.imageUrl ?? ""} placeholder="https://…" />
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  editState == null
                    ? null
                    : editState.ok
                      ? { ok: true, message: "Draft updated." }
                      : { ok: false, message: editState.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setEditTarget(null)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={editPending}>
                {editPending ? "Saving…" : "Save draft"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Draft product views">
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
        <SectionHead title={`${tab} drafts`} note={`${rows.length} record${rows.length === 1 ? "" : "s"}.`} />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Manufacturer</th>
                <th>Supplier</th>
                {data.canViewCost && <th style={{ textAlign: "right" }}>Purchase cost</th>}
                <th style={{ textAlign: "right" }}>Selling price</th>
                <th>Pricing</th>
                <th>Source file</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No {tab.toLowerCase()} drafts.
                  </td>
                </tr>
              )}
              {rows.map((draft) => (
                <tr key={draft.id}>
                  <td>
                    <strong>{draft.name}</strong>
                    {draft.duplicateOfLabel && (
                      <>
                        <br />
                        <small style={{ opacity: 0.7 }}>Merged into {draft.duplicateOfLabel}</small>
                      </>
                    )}
                  </td>
                  <td>{draft.sku ?? "—"}</td>
                  <td>{draft.categoryName ?? "—"}</td>
                  <td>{draft.manufacturer ?? "—"}</td>
                  <td>{draft.supplierName ?? "—"}</td>
                  {data.canViewCost && (
                    <td style={{ textAlign: "right" }}>{formatMoney(draft.buyPrice, data.currency)}</td>
                  )}
                  <td style={{ textAlign: "right" }}>{formatMoney(draft.sellPrice, data.currency)}</td>
                  <td>
                    {draft.pricingMethod === "cost_plus_margin"
                      ? `Cost + ${draft.marginPercent}%`
                      : "Fixed"}
                  </td>
                  <td>{draft.importFilename ?? "Manual"}</td>
                  <td>
                    <Status value={draft.status} />
                  </td>
                  <td>
                    {draft.status === "pending" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          {data.canImport && (
                            <button
                              className="crm-row-action"
                              type="button"
                              onClick={() => openEditor(draft)}
                            >
                              Edit
                            </button>
                          )}
                          {data.canConfirm && (
                            <button
                              className="crm-row-action"
                              type="button"
                              disabled={busyId === draft.id}
                              onClick={() =>
                                run(
                                  draft.id,
                                  () => confirmDraftProduct(draft.id),
                                  `${draft.name} is now an active product.`
                                )
                              }
                            >
                              {busyId === draft.id ? "Working…" : "Confirm"}
                            </button>
                          )}
                          {data.canImport && (
                            <button
                              className="crm-row-action"
                              type="button"
                              disabled={busyId === draft.id}
                              onClick={() =>
                                run(draft.id, () => rejectDraftProduct(draft.id), `${draft.name} rejected.`)
                              }
                            >
                              Reject
                            </button>
                          )}
                        </div>
                        {data.canImport && draft.possibleMatches.length > 0 && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <select
                              value={mergeTarget[draft.id] ?? ""}
                              onChange={(event) =>
                                setMergeTarget((current) => ({
                                  ...current,
                                  [draft.id]: event.target.value,
                                }))
                              }
                              aria-label={`Possible duplicate for ${draft.name}`}
                            >
                              <option value="">Possible duplicate…</option>
                              {draft.possibleMatches.map((match) => (
                                <option key={match.id} value={match.id}>
                                  {match.sku} · {match.name}
                                </option>
                              ))}
                            </select>
                            <button
                              className="crm-row-action"
                              type="button"
                              disabled={busyId === draft.id || !mergeTarget[draft.id]}
                              onClick={() =>
                                run(
                                  draft.id,
                                  () => resolveDraftDuplicate(draft.id, mergeTarget[draft.id]),
                                  `${draft.name} resolved as a duplicate.`
                                )
                              }
                            >
                              Merge
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {draft.status !== "pending" && draft.reviewedBy && (
                      <small style={{ opacity: 0.7 }}>
                        {draft.reviewedBy} · {formatDateTime(draft.reviewedAt)}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="crm-panel crm-enter">
        <SectionHead
          title="Import history"
          note="Expand a run to see its error report. The same file cannot be imported twice into one entity."
        />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>File</th>
                <th style={{ textAlign: "right" }}>Rows</th>
                <th style={{ textAlign: "right" }}>Valid</th>
                <th style={{ textAlign: "right" }}>Invalid</th>
                <th>Status</th>
                <th>By</th>
                <th>When</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.imports.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No imports yet.
                  </td>
                </tr>
              )}
              {data.imports.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.filename}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>{record.totalRows}</td>
                  <td style={{ textAlign: "right" }}>{record.validRows}</td>
                  <td style={{ textAlign: "right" }}>{record.invalidRows}</td>
                  <td>
                    <Status value={record.status} />
                  </td>
                  <td>{record.createdBy ?? "—"}</td>
                  <td>{formatDateTime(record.createdAt)}</td>
                  <td>
                    {record.errorReport.length > 0 && (
                      <button
                        className="crm-row-action"
                        type="button"
                        onClick={() =>
                          setExpandedImport(expandedImport === record.id ? null : record.id)
                        }
                      >
                        {expandedImport === record.id ? "Hide" : `Errors (${record.errorReport.length})`}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {expandedImport && (
          <div style={{ marginTop: 12 }}>
            <h4>Error report</h4>
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.imports.find((record) => record.id === expandedImport)?.errorReport ?? []).map(
                    (error) => (
                      <tr key={error.row}>
                        <td>
                          <strong>{error.row}</strong>
                        </td>
                        <td>{error.error}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
