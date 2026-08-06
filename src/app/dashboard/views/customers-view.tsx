"use client";

import { useActionState, useMemo, useState } from "react";
import { addCustomer } from "../actions/customers";
import type { CustomersData } from "@/lib/data/customers";
import { Feedback, PageHead, SectionHead, StatStrip, StringTable, useActionPanel } from "./shared";

const TABS = ["All customers", "Loyalty", "Credit"] as const;
type Tab = (typeof TABS)[number];

export function CustomersView({ data }: { data: CustomersData }) {
  const [tab, setTab] = useState<Tab>("All customers");
  const [state, action, pending] = useActionState(addCustomer, null);
  const [showForm, setShowForm] = useActionPanel(state);

  const rows = useMemo(() => {
    if (tab === "All customers") return data.rows;
    const segment = tab === "Loyalty" ? "loyalty" : "credit";
    return data.rows.filter((_, index) => (data.segments[index] ?? "").toLowerCase() === segment);
  }, [data.rows, data.segments, tab]);

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Sell"
        title="Customers"
        description="Customer records for the active entity. Phase 1 deliberately records no medical or medicine-purchase history."
      >
        <button
          className="crm-button crm-button-primary"
          type="button"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close" : "Add customer"} <i>+</i>
        </button>
      </PageHead>

      <StatStrip stats={data.stats} />

      {showForm && (
        <section className="crm-panel crm-enter">
          <SectionHead title="Add customer" />
          <form action={action} className="crm-form-grid">
            <label>
              <span>Name</span>
              <input name="name" required />
            </label>
            <label>
              <span>Phone</span>
              <input name="phone" />
            </label>
            <label>
              <span>Address</span>
              <input name="address" />
            </label>
            <label>
              <span>Segment</span>
              <select name="segment" defaultValue="">
                <option value="">No segment</option>
                <option value="Loyalty">Loyalty</option>
                <option value="Credit">Credit</option>
              </select>
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  state == null
                    ? null
                    : state.ok
                      ? { ok: true, message: "Customer created." }
                      : { ok: false, message: state.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Create customer"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Customer views">
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
        <SectionHead title={tab} note={`${rows.length} customer${rows.length === 1 ? "" : "s"}.`} />
        <StringTable
          columns={["Customer", "Phone", "Last purchase", "Total purchases", "Points", "Credit"]}
          rows={rows}
          searchPlaceholder="Search customers…"
          emptyMessage="No customers in this entity yet."
        />
      </section>
    </div>
  );
}
