"use client";

import { useActionState, useState } from "react";
import { receiveStock } from "../actions/purchasing";
import type { ReceivedOrdersData } from "@/lib/data/receivedOrders";
import {
  EmptyState,
  Feedback,
  PageHead,
  SectionHead,
  StatStrip,
  StringTable,
  useActionPanel,
} from "./shared";

export function ReceivedOrdersView({ data }: { data: ReceivedOrdersData }) {
  const [selectedPo, setSelectedPo] = useState(data.eligiblePurchaseOrders[0]?.id ?? "");
  const [state, action, pending] = useActionState(receiveStock, null);
  const [showForm, setShowForm] = useActionPanel(state);

  const order = data.eligiblePurchaseOrders.find((po) => po.id === selectedPo) ?? null;

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Purchasing"
        title="Received orders"
        description="Goods received against an approved purchase order. For purchases without a purchase order, use Stock inward."
      >
        {data.eligiblePurchaseOrders.length > 0 && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close" : "Receive stock"} <i>+</i>
          </button>
        )}
      </PageHead>

      <StatStrip stats={data.stats} />

      {data.eligiblePurchaseOrders.length === 0 && (
        <EmptyState
          title="No orders are ready to receive"
          hint="Approve a purchase order first, or record the delivery on the Stock inward screen."
        />
      )}

      {showForm && order && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Receive stock"
            note="Received quantities create a batch per line and post purchase movements to the ledger."
          />
          <form action={action} className="crm-form-grid">
            <label>
              <span>Purchase order</span>
              <select
                name="po_id"
                value={selectedPo}
                onChange={(event) => setSelectedPo(event.target.value)}
                required
              >
                {data.eligiblePurchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.po_number} · {po.supplier_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Supplier invoice number</span>
              <input name="supplier_invoice_number" />
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ textAlign: "right" }}>Ordered</th>
                      <th style={{ textAlign: "right" }}>Received</th>
                      <th style={{ textAlign: "right" }}>Unit cost</th>
                      <th style={{ textAlign: "right" }}>Damaged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.product_id}>
                        <td>
                          <strong>{item.sku}</strong>
                          <br />
                          <small style={{ opacity: 0.7 }}>{item.name}</small>
                        </td>
                        <td style={{ textAlign: "right" }}>{item.quantity}</td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            name={`quantity_received_${item.product_id}`}
                            type="number"
                            min="0"
                            defaultValue={item.quantity}
                            style={{ width: 100, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            name={`unit_cost_${item.product_id}`}
                            type="number"
                            min="0"
                            defaultValue={item.unit_cost}
                            style={{ width: 110, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            name={`damaged_qty_${item.product_id}`}
                            type="number"
                            min="0"
                            defaultValue={0}
                            style={{ width: 100, textAlign: "right" }}
                          />
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
                      ? { ok: true, message: "Stock received and posted to the ledger." }
                      : { ok: false, message: state.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                {pending ? "Receiving…" : "Receive stock"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead
          title="Goods received notes"
          note={`${data.rows.length} receipt${data.rows.length === 1 ? "" : "s"}.`}
        />
        <StringTable
          columns={[
            "GRN / PO",
            "Supplier invoice",
            "Supplier",
            "Batches",
            "Received",
            "Variance",
            "Received by",
            "Status",
          ]}
          rows={data.rows}
          statusColumn={7}
          searchPlaceholder="Search by GRN, PO or supplier…"
          emptyMessage="No stock has been received against a purchase order yet."
        />
      </section>
    </div>
  );
}
