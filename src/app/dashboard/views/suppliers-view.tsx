"use client";

import { useActionState, useState } from "react";
import { addSupplier } from "../actions/suppliers";
import type { SupplierRow, SuppliersData } from "@/lib/data/suppliers";
import {
  Column,
  DataTable,
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDate,
  formatMoney,
  formatNumber,
  useActionPanel,
} from "./shared";

const HISTORY_TABS = ["All", "Purchases", "Free goods", "Returns", "Replacements"] as const;
type HistoryTab = (typeof HISTORY_TABS)[number];

const TAB_KIND: Record<HistoryTab, string | null> = {
  All: null,
  Purchases: "purchase",
  "Free goods": "free_goods",
  Returns: "return",
  Replacements: "replacement",
};

export function SuppliersView({ data }: { data: SuppliersData }) {
  const [selected, setSelected] = useState<SupplierRow | null>(null);
  const [tab, setTab] = useState<HistoryTab>("All");
  const [state, action, pending] = useActionState(addSupplier, null);
  const [showForm, setShowForm] = useActionPanel(state);

  const history = data.history.filter((entry) => {
    if (selected && entry.supplierId !== selected.id) return false;
    const kind = TAB_KIND[tab];
    return kind === null || entry.kind === kind;
  });

  const columns: Column<SupplierRow>[] = [
    { key: "name", header: "Supplier", render: (row) => row.name, sortValue: (row) => row.name },
    {
      key: "type",
      header: "Type",
      render: (row) => (row.supplierType === "parent" ? "Parent company" : "External"),
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => [row.contactName, row.phone].filter(Boolean).join(" · ") || "—",
    },
    { key: "email", header: "Email", render: (row) => row.email ?? "—" },
    {
      key: "registration",
      header: "Tax / registration",
      render: (row) => [row.taxId, row.registrationNumber].filter(Boolean).join(" · ") || "—",
    },
    { key: "terms", header: "Payment terms", render: (row) => row.paymentTerms ?? "—" },
    {
      key: "lead",
      header: "Lead time",
      numeric: true,
      render: (row) => (row.leadTimeDays != null ? `${row.leadTimeDays} days` : "—"),
      sortValue: (row) => row.leadTimeDays ?? 0,
    },
    {
      key: "products",
      header: "Products",
      numeric: true,
      render: (row) => formatNumber(row.productCount),
      sortValue: (row) => row.productCount,
    },
    {
      key: "purchases",
      header: "Purchases",
      numeric: true,
      render: (row) =>
        data.canViewCost
          ? `${row.purchaseCount} · ${formatMoney(row.purchaseValue, data.currency)}`
          : formatNumber(row.purchaseCount),
      sortValue: (row) => row.purchaseCount,
    },
    {
      key: "free",
      header: "Free goods",
      numeric: true,
      render: (row) => formatNumber(row.freeGoodsUnits),
      sortValue: (row) => row.freeGoodsUnits,
    },
    {
      key: "replacements",
      header: "Replacements",
      numeric: true,
      render: (row) => formatNumber(row.replacementCount),
      sortValue: (row) => row.replacementCount,
    },
    {
      key: "returns",
      header: "Returns",
      numeric: true,
      render: (row) => `${row.openReturns} open / ${row.totalReturns}`,
      sortValue: (row) => row.openReturns,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Status value={row.isActive ? "Active" : "Inactive"} />,
    },
  ];

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Catalogue · ${data.entityName}`}
        title="Suppliers"
        description="Parent company and external suppliers for this entity, with their purchase, free-goods, return and replacement history."
      >
        {data.canManage && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close" : "Add supplier"} <i>+</i>
          </button>
        )}
        <a className="crm-button crm-button-secondary" href="/api/reports/export?report=supplier-purchases">
          Export purchases <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />

      {!data.canManage && <PermissionNotice what="manage suppliers" />}

      {showForm && data.canManage && (
        <section className="crm-panel crm-enter">
          <SectionHead title="Add supplier" note="Suppliers belong to the active entity." />
          <form action={action} className="crm-form-grid">
            <label>
              <span>Supplier name</span>
              <input name="name" required />
            </label>
            <label>
              <span>Supplier type</span>
              <select name="supplier_type" defaultValue="external">
                <option value="external">External supplier</option>
                <option value="parent">Parent company</option>
              </select>
            </label>
            <label>
              <span>Contact name</span>
              <input name="contact_name" />
            </label>
            <label>
              <span>Phone</span>
              <input name="phone" />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" />
            </label>
            <label>
              <span>Address</span>
              <input name="address" />
            </label>
            <label>
              <span>Tax ID</span>
              <input name="tax_id" />
            </label>
            <label>
              <span>Registration number</span>
              <input name="registration_number" />
            </label>
            <label>
              <span>Payment terms</span>
              <input name="payment_terms" placeholder="30 days" />
            </label>
            <label>
              <span>Lead time (days)</span>
              <input name="lead_time_days" type="number" min="0" step="1" />
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
                      ? { ok: true, message: "Supplier created." }
                      : { ok: false, message: state.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Create supplier"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead
          title="Suppliers"
          note={
            selected
              ? `History below is filtered to ${selected.name}.`
              : `${data.suppliers.length} supplier${data.suppliers.length === 1 ? "" : "s"}. Select one to filter its history.`
          }
        >
          {selected && (
            <button className="crm-row-action" type="button" onClick={() => setSelected(null)}>
              Clear selection
            </button>
          )}
        </SectionHead>
        <DataTable
          columns={columns}
          rows={data.suppliers}
          getKey={(row) => row.id}
          searchPlaceholder="Search by name, contact or registration…"
          emptyMessage="No suppliers in this entity yet."
          actions={(row) => (
            <button
              className="crm-row-action"
              type="button"
              onClick={() => setSelected(selected?.id === row.id ? null : row)}
            >
              {selected?.id === row.id ? "Selected" : "History"}
            </button>
          )}
        />
      </section>

      <section className="crm-panel crm-enter">
        <SectionHead
          title={selected ? `History · ${selected.name}` : "History · all suppliers"}
          note="Purchases, free goods, returns and replacements recorded against suppliers."
        />
        <div className="crm-tabs" role="tablist" aria-label="Supplier history">
          {HISTORY_TABS.map((item) => (
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
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Kind</th>
                <th>Date</th>
                <th>Detail</th>
                <th style={{ textAlign: "right" }}>Quantity</th>
                {data.canViewCost && <th style={{ textAlign: "right" }}>Value</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No history recorded for this selection.
                  </td>
                </tr>
              )}
              {history.map((entry, index) => (
                <tr key={`${entry.reference}-${entry.kind}-${index}`}>
                  <td>
                    <strong>{entry.reference}</strong>
                  </td>
                  <td>{entry.kind.replace(/_/g, " ")}</td>
                  <td>{formatDate(entry.date)}</td>
                  <td>{entry.detail}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(entry.quantity)}</td>
                  {data.canViewCost && (
                    <td style={{ textAlign: "right" }}>{formatMoney(entry.value, data.currency)}</td>
                  )}
                  <td>
                    <Status value={entry.status} />
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
