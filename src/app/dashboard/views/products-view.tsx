"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { addProduct, updateProduct } from "../actions/products";
import type { ProductRow, ProductsData } from "@/lib/data/products";
import { calculateSellPrice } from "@/lib/pricing";
import type { PricingMethod } from "@/lib/types";
import {
  Column,
  DataTable,
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
} from "./shared";

const TABS = ["All products", "Active", "Low stock", "Out of stock", "Inactive"] as const;
type Tab = (typeof TABS)[number];

export function ProductsView({ data }: { data: ProductsData }) {
  const [tab, setTab] = useState<Tab>("All products");
  const [historyFor, setHistoryFor] = useState<ProductRow | null>(null);

  const [createState, createAction, creating] = useActionState(addProduct, null);
  const [editState, editAction, editingPending] = useActionState(updateProduct, null);

  // The panel closes when the server confirms the write. Deriving that from
  // the action result (rather than syncing it in an effect) avoids both the
  // cascading render and the stale-by-one-submit bug of reading it in onSubmit.
  const [panel, setPanel] = useState<{
    mode: "create" | "edit";
    row: ProductRow | null;
    seen: unknown;
  } | null>(null);
  const panelState = panel?.mode === "edit" ? editState : createState;
  const panelSucceeded = panel !== null && panel.seen !== panelState && Boolean(panelState?.ok);
  const openPanel = panel && !panelSucceeded ? panel : null;
  const mode = openPanel?.mode ?? "none";
  const editing = openPanel?.row ?? null;

  function openCreate() {
    setPanel(mode === "create" ? null : { mode: "create", row: null, seen: createState });
  }
  function openEdit(row: ProductRow) {
    setPanel({ mode: "edit", row, seen: editState });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const rows = useMemo(
    () =>
      data.products.filter((product) => {
        if (tab === "All products") return true;
        if (tab === "Active") return product.stockStatus === "Active";
        if (tab === "Low stock") return product.stockStatus === "Low stock";
        if (tab === "Out of stock") return product.stockStatus === "Out of stock";
        return product.status !== "active";
      }),
    [data.products, tab]
  );

  const columns: Column<ProductRow>[] = [
    { key: "sku", header: "SKU", render: (row) => row.sku, sortValue: (row) => row.sku },
    {
      key: "name",
      header: "Product",
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <small style={{ opacity: 0.7 }}>
            {[row.genericName, row.strength, row.form].filter(Boolean).join(" · ") || "—"}
          </small>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    { key: "category", header: "Category", render: (row) => row.categoryName ?? "—" },
    { key: "manufacturer", header: "Manufacturer", render: (row) => row.manufacturer ?? "—" },
    { key: "unit", header: "Unit", render: (row) => row.unit ?? "—" },
    ...(data.canViewCost
      ? [
          {
            key: "buyPrice",
            header: "Purchase cost",
            numeric: true,
            render: (row: ProductRow) => formatMoney(row.buyPrice),
            sortValue: (row: ProductRow) => row.buyPrice ?? 0,
          },
        ]
      : []),
    {
      key: "sellPrice",
      header: "Selling price",
      numeric: true,
      render: (row) => formatMoney(row.sellPrice),
      sortValue: (row) => row.sellPrice,
    },
    {
      key: "pricing",
      header: "Pricing",
      render: (row) =>
        row.pricingMethod === "cost_plus_margin" ? `Cost + ${row.marginPercent}%` : "Fixed",
    },
    ...(data.canViewProfit
      ? [
          {
            key: "margin",
            header: "Margin",
            numeric: true,
            render: (row: ProductRow) => formatMoney(row.marginValue),
            sortValue: (row: ProductRow) => row.marginValue ?? 0,
          },
        ]
      : []),
    {
      key: "discount",
      header: "Max discount",
      numeric: true,
      render: (row) => `${row.maxDiscountPercent}%`,
      sortValue: (row) => row.maxDiscountPercent,
    },
    {
      key: "available",
      header: "Available",
      numeric: true,
      render: (row) => formatNumber(row.available),
      sortValue: (row) => row.available,
    },
    {
      key: "minimum",
      header: "Min / target",
      numeric: true,
      render: (row) => `${row.reorderLevel} / ${row.restockTarget}`,
      sortValue: (row) => row.reorderLevel,
    },
    { key: "status", header: "Status", render: (row) => <Status value={row.stockStatus} /> },
  ];

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Catalogue · ${data.entityName}`}
        title="Products"
        description="Product master with pricing method, discount ceiling, minimum stock and restock target. Purchase cost is visible only to users with that permission."
      >
        {data.canCreate && (
          <button className="crm-button crm-button-primary" type="button" onClick={openCreate}>
            {mode === "create" ? "Close" : "Add product"} <i>+</i>
          </button>
        )}
        {data.canImport && (
          <>
            <a className="crm-button crm-button-secondary" href="/api/imports/template?kind=products">
              Download template <i>↓</i>
            </a>
            <Link className="crm-button crm-button-secondary" href="/dashboard/draft-products">
              Import products{data.pendingDrafts > 0 ? ` (${data.pendingDrafts} pending)` : ""} <i>↗</i>
            </Link>
          </>
        )}
        <a
          className="crm-button crm-button-secondary"
          href="/api/reports/export?report=current-stock"
        >
          Export stock <i>↓</i>
        </a>
      </PageHead>

      <StatStrip stats={data.stats} />

      {mode === "create" && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Add product"
            note="Creates a real, sellable product in the active entity."
          />
          <ProductForm
            key="create"
            data={data}
            action={createAction}
            pending={creating}
            state={createState}
            onCancel={() => setPanel(null)}
          />
        </section>
      )}

      {mode === "edit" && editing && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Edit ${editing.name}`}
            note="Changing purchase cost, margin, selling price, pricing method or the discount ceiling writes a price-history record."
          />
          <ProductForm
            key={editing.id}
            data={data}
            product={editing}
            action={editAction}
            pending={editingPending}
            state={editState}
            onCancel={() => setPanel(null)}
          />
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Product views">
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
        <SectionHead title={tab} note={`${rows.length} product${rows.length === 1 ? "" : "s"}.`} />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(row) => row.id}
          searchPlaceholder="Search by name, SKU, barcode or category…"
          emptyMessage="No products in this entity yet."
          actions={
            data.canEdit
              ? (row) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="crm-row-action" type="button" onClick={() => openEdit(row)}>
                      Edit
                    </button>
                    {data.canViewCost && (
                      <button
                        className="crm-row-action"
                        type="button"
                        onClick={() => setHistoryFor(historyFor?.id === row.id ? null : row)}
                      >
                        History
                      </button>
                    )}
                  </div>
                )
              : undefined
          }
        />
      </section>

      {historyFor && data.canViewCost && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Price history · ${historyFor.name}`}
            note="Every change to cost, margin, selling price, pricing method or discount ceiling."
          >
            <button className="crm-row-action" type="button" onClick={() => setHistoryFor(null)}>
              Close
            </button>
          </SectionHead>
          <PriceHistoryTable
            entries={data.priceHistory.filter((entry) => entry.productId === historyFor.id)}
          />
        </section>
      )}

      {!data.canCreate && !data.canEdit && (
        <PermissionNotice what="create or edit products" />
      )}
    </div>
  );
}

function PriceHistoryTable({
  entries,
}: {
  entries: ProductsData["priceHistory"];
}) {
  if (entries.length === 0) {
    return <p style={{ opacity: 0.7, padding: "8px 0" }}>No recorded changes for this product yet.</p>;
  }
  return (
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Field</th>
            <th>Previous</th>
            <th>New</th>
            <th>Change</th>
            <th>By</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <strong>{formatDateTime(entry.createdAt)}</strong>
              </td>
              <td>{entry.field.replace(/_/g, " ")}</td>
              <td>{entry.previousValue ?? "—"}</td>
              <td>{entry.newValue ?? "—"}</td>
              <td>{entry.changeType}</td>
              <td>{entry.changedBy ?? "—"}</td>
              <td>{entry.reason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductForm({
  data,
  product,
  action,
  pending,
  state,
  onCancel,
}: {
  data: ProductsData;
  product?: ProductRow;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { ok: true } | { ok: false; error: string } | null;
  onCancel: () => void;
}) {
  const [pricingMethod, setPricingMethod] = useState<PricingMethod>(
    product?.pricingMethod ?? "fixed"
  );
  const [buyPrice, setBuyPrice] = useState(String(product?.buyPrice ?? 0));
  const [marginPercent, setMarginPercent] = useState(String(product?.marginPercent ?? 0));
  const [sellPrice, setSellPrice] = useState(String(product?.sellPrice ?? 0));

  // Live preview of the rule the server will re-apply on submit.
  const calculated = calculateSellPrice(
    pricingMethod,
    Number(buyPrice) || 0,
    Number(marginPercent) || 0,
    Number(sellPrice) || 0
  );

  return (
    <form action={action} className="crm-form-grid">
      {product && <input type="hidden" name="product_id" value={product.id} />}

      <label>
        <span>SKU / internal code</span>
        <input name="sku" required defaultValue={product?.sku ?? ""} placeholder="MED-00999" />
      </label>
      <label>
        <span>Product name</span>
        <input name="name" required defaultValue={product?.name ?? ""} />
      </label>
      <label>
        <span>Generic name</span>
        <input name="generic_name" defaultValue={product?.genericName ?? ""} />
      </label>
      <label>
        <span>Barcode</span>
        <input name="barcode" defaultValue={product?.barcode ?? ""} />
      </label>
      <label>
        <span>Strength</span>
        <input name="strength" defaultValue={product?.strength ?? ""} placeholder="500mg" />
      </label>
      <label>
        <span>Form</span>
        <input name="form" defaultValue={product?.form ?? ""} placeholder="Tablet" />
      </label>
      <label>
        <span>Manufacturer / brand</span>
        <input name="manufacturer" defaultValue={product?.manufacturer ?? ""} />
      </label>
      <label>
        <span>Unit / pack size</span>
        <input name="unit" defaultValue={product?.unit ?? ""} placeholder="Pack of 100" />
      </label>
      <label>
        <span>Category</span>
        <select name="category_id" defaultValue={product?.categoryId ?? ""}>
          <option value="">No category</option>
          {data.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Default supplier</span>
        <select name="supplier_id" defaultValue={product?.supplierId ?? ""}>
          <option value="">No default supplier</option>
          {data.suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Product image URL</span>
        <input name="image_url" defaultValue={product?.imageUrl ?? ""} placeholder="https://…" />
      </label>

      <label>
        <span>Purchase cost</span>
        <input
          name="buy_price"
          type="number"
          min="0"
          step="1"
          required
          value={buyPrice}
          onChange={(event) => setBuyPrice(event.target.value)}
        />
      </label>
      <label>
        <span>Pricing method</span>
        <select
          name="pricing_method"
          value={pricingMethod}
          onChange={(event) => setPricingMethod(event.target.value as PricingMethod)}
        >
          <option value="fixed">FIXED — enter the selling price</option>
          <option value="cost_plus_margin">COST_PLUS_MARGIN — cost plus a margin</option>
        </select>
      </label>
      <label>
        <span>Margin %{pricingMethod === "cost_plus_margin" ? "" : " (unused for FIXED)"}</span>
        <input
          name="margin_percent"
          type="number"
          min="0"
          step="0.1"
          value={marginPercent}
          onChange={(event) => setMarginPercent(event.target.value)}
          disabled={pricingMethod !== "cost_plus_margin"}
        />
      </label>
      <label>
        <span>Fixed selling price{pricingMethod === "fixed" ? "" : " (unused for COST_PLUS_MARGIN)"}</span>
        <input
          name="sell_price"
          type="number"
          min="0"
          step="1"
          value={sellPrice}
          onChange={(event) => setSellPrice(event.target.value)}
          disabled={pricingMethod !== "fixed"}
        />
      </label>
      <label>
        <span>Calculated selling price</span>
        <input value={formatMoney(calculated)} readOnly tabIndex={-1} />
      </label>
      <label>
        <span>Maximum discount %</span>
        <input
          name="max_discount_percent"
          type="number"
          min="0"
          max="100"
          step="0.1"
          defaultValue={product?.maxDiscountPercent ?? 0}
        />
      </label>
      <label>
        <span>Minimum stock quantity</span>
        <input
          name="reorder_level"
          type="number"
          min="0"
          step="1"
          defaultValue={product?.reorderLevel ?? 0}
        />
      </label>
      <label>
        <span>Restock target quantity</span>
        <input
          name="restock_target"
          type="number"
          min="0"
          step="1"
          defaultValue={product?.restockTarget ?? 0}
        />
      </label>
      <label>
        <span>Status</span>
        <select name="status" defaultValue={product?.status ?? "active"}>
          <option value="active">Active</option>
          <option value="quarantined">Quarantined</option>
          <option value="discontinued">Discontinued</option>
        </select>
      </label>
      {product && (
        <label>
          <span>Reason for change (recorded in price history)</span>
          <input name="reason" placeholder="Supplier increased cost" />
        </label>
      )}

      {pricingMethod === "cost_plus_margin" && (
        <p style={{ gridColumn: "1 / -1", opacity: 0.75, fontSize: "0.9em" }}>
          Selling price = purchase cost + {marginPercent || 0}% ={" "}
          <strong>{formatMoney(calculated)}</strong>. The server recalculates this on save.
        </p>
      )}

      <div style={{ gridColumn: "1 / -1" }}>
        <Feedback
          state={
            state == null
              ? null
              : state.ok
                ? { ok: true, message: product ? "Product updated." : "Product created." }
                : { ok: false, message: state.error }
          }
        />
      </div>

      <div className="crm-form-actions">
        <button className="crm-button crm-button-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : product ? "Save changes" : "Create product"}
        </button>
      </div>
    </form>
  );
}

export { formatPercent };
