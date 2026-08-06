"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { addExpense, approveExpense } from "../actions/expenses";
import type { ExpensesData } from "@/lib/data/expenses";
import { Feedback, PageHead, SectionHead, StatStrip, useActionPanel } from "./shared";

const TABS = ["All", "Pending", "Approved", "Recurring"] as const;
type Tab = (typeof TABS)[number];

export function ExpensesView({ data }: { data: ExpensesData }) {
  const [tab, setTab] = useState<Tab>("All");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();
  const [state, action, pending] = useActionState(addExpense, null);
  const [showForm, setShowForm] = useActionPanel(state);

  // Row metadata travels in parallel arrays, so filtering keeps the original
  // index to stay aligned with `ids` and `recurring`.
  const visible = useMemo(
    () =>
      data.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row, index }) => {
          if (tab === "All") return true;
          if (tab === "Recurring") return data.recurring[index];
          return (row[7] ?? "").toLowerCase() === tab.toLowerCase();
        }),
    [data.rows, data.recurring, tab]
  );

  function approve(index: number, reference: string) {
    const id = data.ids[index];
    setMessage(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await approveExpense(id);
      setBusyId(null);
      setMessage(
        result.ok ? { ok: true, message: `${reference} approved.` } : { ok: false, message: result.error }
      );
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Purchasing"
        title="Expenses"
        description="Operating costs recorded against the active entity."
      >
        <button
          className="crm-button crm-button-primary"
          type="button"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close" : "Add expense"} <i>+</i>
        </button>
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {showForm && (
        <section className="crm-panel crm-enter">
          <SectionHead title="Add expense" />
          <form action={action} className="crm-form-grid">
            <label>
              <span>Description</span>
              <input name="description" required />
            </label>
            <label>
              <span>Category</span>
              <select name="category_id" defaultValue="">
                <option value="">No category</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Vendor</span>
              <input name="vendor" />
            </label>
            <label>
              <span>Amount</span>
              <input name="amount" type="number" min="0" step="1" required />
            </label>
            <label>
              <span>Payment method</span>
              <input name="payment_method" placeholder="Cash" />
            </label>
            <label>
              <span>Entity</span>
              <select name="branch_id" defaultValue="">
                <option value="">Active entity</option>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="is_recurring" />
              <span>Recurring expense</span>
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  state == null
                    ? null
                    : state.ok
                      ? { ok: true, message: "Expense recorded and awaiting approval." }
                      : { ok: false, message: state.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Record expense"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Expense views">
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
        <SectionHead title={tab} note={`${visible.length} expense${visible.length === 1 ? "" : "s"}.`} />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Expense</th>
                <th>Category</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Created by</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No expenses in this view.
                  </td>
                </tr>
              )}
              {visible.map(({ row, index }) => (
                <tr key={data.ids[index] ?? index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cellIndex === 0 ? <strong>{cell}</strong> : cell}</td>
                  ))}
                  <td>
                    {(row[7] ?? "").toLowerCase() === "pending" && (
                      <button
                        className="crm-row-action"
                        type="button"
                        disabled={busyId === data.ids[index]}
                        onClick={() => approve(index, row[0])}
                      >
                        {busyId === data.ids[index] ? "Approving…" : "Approve"}
                      </button>
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
