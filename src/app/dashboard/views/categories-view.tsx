"use client";

import { useActionState } from "react";
import { addCategory } from "../actions/categories";
import type { CategoriesData } from "@/lib/data/categories";
import { Feedback, PageHead, SectionHead, StatStrip, StringTable, useActionPanel } from "./shared";

export function CategoriesView({ data }: { data: CategoriesData }) {
  const [state, action, pending] = useActionState(addCategory, null);
  const [showForm, setShowForm] = useActionPanel(state);

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Catalogue"
        title="Categories"
        description="Product categories are shared reference data across every entity; the product and stock figures shown are for the active entity."
      >
        <button
          className="crm-button crm-button-primary"
          type="button"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close" : "Add category"} <i>+</i>
        </button>
      </PageHead>

      <StatStrip stats={data.stats} />

      {showForm && (
        <section className="crm-panel crm-enter">
          <SectionHead title="Add category" />
          <form action={action} className="crm-form-grid">
            <label>
              <span>Code</span>
              <input name="code" required placeholder="CAT-17" />
            </label>
            <label>
              <span>Name</span>
              <input name="name" required />
            </label>
            <label>
              <span>Type</span>
              <select name="type" defaultValue="medicine">
                <option value="medicine">Medicine</option>
                <option value="supplies">Supplies</option>
              </select>
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="is_active" defaultChecked />
              <span>Active</span>
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  state == null
                    ? null
                    : state.ok
                      ? { ok: true, message: "Category created." }
                      : { ok: false, message: state.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Create category"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title="All categories" note={`${data.rows.length} categor${data.rows.length === 1 ? "y" : "ies"}.`} />
        <StringTable
          columns={["Code", "Category", "Type", "Products", "Stock value", "Margin", "Status"]}
          rows={data.rows}
          statusColumn={6}
          searchPlaceholder="Search categories…"
          emptyMessage="No categories yet."
        />
      </section>
    </div>
  );
}
