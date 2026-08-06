"use client";

import { useActionState, useState, useTransition } from "react";
import { approvePurchaseOrder, createPurchaseOrder } from "../actions/purchasing";
import type { PurchaseOrdersData } from "@/lib/data/purchaseOrders";
import { Feedback, PageHead, SectionHead, StatStrip, StringTable, useActionPanel } from "./shared";

const LINE_ROWS = [1, 2, 3, 4];

export function PurchaseOrdersView({ data }: { data: PurchaseOrdersData }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();
  const [state, action, pending] = useActionState(createPurchaseOrder, null);
  const [showForm, setShowForm] = useActionPanel(state);

  function approve(id: string, poNumber: string) {
    setMessage(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await approvePurchaseOrder(id);
      setBusyId(null);
      setMessage(
        result.ok ? { ok: true, message: `${poNumber} approved.` } : { ok: false, message: result.error }
      );
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Purchasing"
        title="Purchase orders"
        description="Orders raised against suppliers in the active entity. Receiving stock against an approved order is done on the Received orders screen."
      >
        <button
          className="crm-button crm-button-primary"
          type="button"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close" : "New purchase order"} <i>+</i>
        </button>
        <a className="crm-button crm-button-secondary" href="/api/reports/export?report=supplier-purchases">
          Export purchases <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {showForm && (
        <section className="crm-panel crm-enter">
          <SectionHead title="New purchase order" note="Up to four line items per order." />
          <form action={action} className="crm-form-grid">
            <label>
              <span>Supplier</span>
              <select name="supplier_id" required defaultValue="">
                <option value="">Select supplier</option>
                {data.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Expected date</span>
              <input name="expected_date" type="date" />
            </label>
            <label>
              <span>Status</span>
              <select name="status" defaultValue="draft">
                <option value="draft">Draft</option>
                <option value="pending_approval">Submit for approval</option>
              </select>
            </label>

            {LINE_ROWS.map((index) => (
              <div
                key={index}
                style={{ gridColumn: "1 / -1", display: "flex", gap: 12, flexWrap: "wrap" }}
              >
                <label style={{ flex: 2, minWidth: 220 }}>
                  <span>Product {index}</span>
                  <select name={`product_id_${index}`} defaultValue="">
                    <option value="">No product</option>
                    {data.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} · {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: 1, minWidth: 120 }}>
                  <span>Quantity</span>
                  <input name={`quantity_${index}`} type="number" min="0" step="1" />
                </label>
                <label style={{ flex: 1, minWidth: 120 }}>
                  <span>Unit cost</span>
                  <input name={`unit_cost_${index}`} type="number" min="0" step="1" />
                </label>
              </div>
            ))}

            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  state == null
                    ? null
                    : state.ok
                      ? { ok: true, message: "Purchase order created." }
                      : { ok: false, message: state.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Create order"}
              </button>
            </div>
          </form>
        </section>
      )}

      {data.pendingApprovals.length > 0 && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Awaiting approval"
            note="Approving an order makes it eligible to receive stock against."
          />
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>PO number</th>
                  <th>Supplier</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.pendingApprovals.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.po_number}</strong>
                    </td>
                    <td>{order.supplier}</td>
                    <td style={{ textAlign: "right" }}>{order.total}</td>
                    <td>
                      <button
                        className="crm-row-action"
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => approve(order.id, order.po_number)}
                      >
                        {busyId === order.id ? "Approving…" : "Approve"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title="All orders" note={`${data.rows.length} order${data.rows.length === 1 ? "" : "s"}.`} />
        <StringTable
          columns={["PO number", "Supplier", "Created by", "Qty", "Total", "Expected", "Status"]}
          rows={data.rows}
          statusColumn={6}
          searchPlaceholder="Search by PO number or supplier…"
          emptyMessage="No purchase orders yet."
        />
      </section>
    </div>
  );
}
