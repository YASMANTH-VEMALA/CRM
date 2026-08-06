"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { completeSale, type CartItem } from "../actions/sales";
import type { POSData, POSProduct } from "@/lib/data/sales";
import { Feedback, PageHead, PermissionNotice, SectionHead, formatMoney } from "./shared";

type CartLine = CartItem & {
  productName: string;
  sku: string;
  batchNumber: string;
  expiryDate: string | null;
  available: number;
  maxDiscountPercent: number;
};

type Receipt = {
  invoiceNumber: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  soldAt: string;
  cashier: string;
  entityName: string;
  currency: string;
};

const PAYMENT_METHODS = ["Cash", "Bank", "M-Pesa", "Selcom", "Credit"];

export function SalesView({ data }: { data: POSData }) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** Idempotency key for the cart currently being rung up; cleared on success. */
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data.products.slice(0, 24);
    return data.products
      .filter((product) => {
        if (product.barcode && product.barcode.toLowerCase() === needle) return true;
        return (
          product.name.toLowerCase().includes(needle) ||
          product.sku.toLowerCase().includes(needle) ||
          (product.genericName?.toLowerCase().includes(needle) ?? false)
        );
      })
      .slice(0, 24);
  }, [data.products, search]);

  const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const totalDiscount = cart.reduce((sum, line) => sum + line.discount, 0) + cartDiscount;
  const total = Math.max(0, subtotal - totalDiscount);
  const discountCeiling = (subtotal * data.maxDiscountPercent) / 100;
  const overDiscountLimit = totalDiscount > discountCeiling + 0.001;

  /** FEFO: the earliest-expiring batch with stock is selected automatically. */
  function addProduct(product: POSProduct) {
    if (product.batches.length === 0) return;
    const batch = product.batches[0];
    setMessage(null);
    setCart((current) => {
      const existing = current.find((line) => line.batchId === batch.id);
      if (existing) {
        if (existing.quantity >= batch.quantityAvailable) {
          setMessage({
            ok: false,
            message: `Only ${batch.quantityAvailable} left in batch ${batch.batchNumber}.`,
          });
          return current;
        }
        return current.map((line) =>
          line.batchId === batch.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          batchId: batch.id,
          quantity: 1,
          unitPrice: product.sellPrice,
          discount: 0,
          productName: product.name,
          sku: product.sku,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          available: batch.quantityAvailable,
          maxDiscountPercent: product.maxDiscountPercent,
        },
      ];
    });
  }

  function switchBatch(index: number, batchId: string) {
    const line = cart[index];
    const batch = data.products
      .find((item) => item.id === line.productId)
      ?.batches.find((item) => item.id === batchId);
    if (!batch) return;
    setCart((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              expiryDate: batch.expiryDate,
              available: batch.quantityAvailable,
              quantity: Math.min(item.quantity, batch.quantityAvailable),
            }
          : item
      )
    );
  }

  function setQuantity(index: number, quantity: number) {
    setCart((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, quantity: Math.max(1, Math.min(quantity, line.available)) }
          : line
      )
    );
  }

  function setLineDiscount(index: number, discount: number) {
    setCart((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, discount: Math.max(0, discount) } : line
      )
    );
  }

  function submitSale() {
    if (cart.length === 0) {
      setMessage({ ok: false, message: "Add at least one product to the cart." });
      return;
    }
    setMessage(null);

    const snapshot = cart;
    const snapshotSubtotal = subtotal;
    const snapshotDiscount = totalDiscount;
    const snapshotTotal = total;
    const snapshotPayment = paymentMethod;

    // Minted once per cart and reused on every retry, so a double click or a
    // resubmit after a flaky response returns the original sale rather than
    // ringing the customer up twice.
    const key = requestKey ?? crypto.randomUUID();
    if (!requestKey) setRequestKey(key);

    startTransition(async () => {
      const result = await completeSale({
        requestKey: key,
        items: snapshot.map((line) => ({
          productId: line.productId,
          batchId: line.batchId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
        })),
        customerId: customerId || null,
        paymentMethod: snapshotPayment,
        discount: cartDiscount,
      });

      if (!result.ok) {
        setMessage({ ok: false, message: result.error });
        return;
      }

      setReceipt({
        invoiceNumber: result.invoiceNumber ?? "—",
        lines: snapshot,
        subtotal: snapshotSubtotal,
        discount: snapshotDiscount,
        total: snapshotTotal,
        paymentMethod: snapshotPayment,
        soldAt: new Date().toISOString(),
        cashier: data.cashierName,
        entityName: data.entityName,
        currency: data.currency,
      });
      setCart([]);
      setCartDiscount(0);
      setCustomerId("");
      setSearch("");
      setRequestKey(null);
      setMessage({
        ok: true,
        message: result.duplicate
          ? `This cart was already rung up as ${result.invoiceNumber}. No second sale was created.`
          : `Sale ${result.invoiceNumber} completed.`,
      });
      searchRef.current?.focus();
    });
  }

  if (!data.canSell) {
    return (
      <div className="crm-page">
        <PageHead eyebrow="Sell" title="Point of sale" description="Dispense stock and complete sales." />
        <PermissionNotice what="create sales" />
      </div>
    );
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Point of sale · ${data.entityName}`}
        title="New sale"
        description={
          data.canApplyDiscount
            ? `Discounts up to ${data.maxDiscountPercent}% of the cart are authorised for your account.`
            : "Your account is not authorised to apply discounts."
        }
      >
        {cart.length > 0 && (
          <button
            className="crm-button crm-button-secondary"
            type="button"
            onClick={() => {
              setCart([]);
              setCartDiscount(0);
              setMessage(null);
            }}
          >
            Clear cart <i>×</i>
          </button>
        )}
      </PageHead>

      <Feedback state={message} />

      <section className="crm-panel crm-enter">
        <SectionHead
          title="Find a product"
          note={
            data.preventExpiredSales
              ? "Expired batches are excluded from sale."
              : "The earliest-expiring batch is selected automatically."
          }
        />
        <div className="crm-filter-bar">
          <label style={{ flex: 1 }}>
            <span>Product name, SKU or barcode</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Scan a barcode or type a product name…"
              autoFocus
            />
          </label>
        </div>

        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Details</th>
                <th style={{ textAlign: "right" }}>Available</th>
                <th style={{ textAlign: "right" }}>Price</th>
                <th style={{ textAlign: "right" }}>Max discount</th>
                <th aria-label="Add" />
              </tr>
            </thead>
            <tbody>
              {results.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    {search ? `Nothing matches “${search}”.` : "No sellable products in this entity."}
                  </td>
                </tr>
              )}
              {results.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                  </td>
                  <td>
                    {[product.sku, product.genericName, product.unit].filter(Boolean).join(" · ")}
                  </td>
                  <td style={{ textAlign: "right" }}>{product.totalAvailable}</td>
                  <td style={{ textAlign: "right" }}>
                    {formatMoney(product.sellPrice, data.currency)}
                  </td>
                  <td style={{ textAlign: "right" }}>{product.maxDiscountPercent}%</td>
                  <td>
                    <button
                      className="crm-row-action"
                      type="button"
                      disabled={product.totalAvailable <= 0}
                      onClick={() => addProduct(product)}
                    >
                      {product.totalAvailable <= 0 ? "Out of stock" : "Add"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title="Cart" note={`${cart.length} line${cart.length === 1 ? "" : "s"}`} />

        {cart.length === 0 ? (
          <p style={{ opacity: 0.7, padding: "12px 0" }}>Search for a product to start a sale.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                  <th style={{ textAlign: "right" }}>Discount</th>
                  <th style={{ textAlign: "right" }}>Line total</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {cart.map((line, index) => {
                  const batches =
                    data.products.find((item) => item.id === line.productId)?.batches ?? [];
                  const lineMax = (line.unitPrice * line.quantity * line.maxDiscountPercent) / 100;
                  const overLineLimit = line.maxDiscountPercent > 0 && line.discount > lineMax;
                  return (
                    <tr key={`${line.batchId}-${index}`}>
                      <td>
                        <strong>{line.productName}</strong>
                        <br />
                        <small style={{ opacity: 0.7 }}>{line.sku}</small>
                      </td>
                      <td>
                        <select
                          value={line.batchId}
                          onChange={(event) => switchBatch(index, event.target.value)}
                          aria-label={`Batch for ${line.productName}`}
                        >
                          {batches.map((batch) => (
                            <option key={batch.id} value={batch.id}>
                              {batch.batchNumber}
                              {batch.expiryDate ? ` · exp ${batch.expiryDate}` : ""} ·{" "}
                              {batch.quantityAvailable} left
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          min={1}
                          max={line.available}
                          value={line.quantity}
                          onChange={(event) => setQuantity(index, Number(event.target.value))}
                          style={{ width: 72, textAlign: "right" }}
                          aria-label={`Quantity for ${line.productName}`}
                        />
                        <br />
                        <small style={{ opacity: 0.6 }}>{line.available} available</small>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatMoney(line.unitPrice, data.currency)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          min={0}
                          value={line.discount}
                          disabled={!data.canApplyDiscount}
                          onChange={(event) => setLineDiscount(index, Number(event.target.value))}
                          style={{ width: 90, textAlign: "right" }}
                          aria-label={`Discount for ${line.productName}`}
                        />
                        {overLineLimit && (
                          <>
                            <br />
                            <small style={{ color: "#c0392b" }}>
                              Max {formatMoney(lineMax, data.currency)}
                            </small>
                          </>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatMoney(line.unitPrice * line.quantity - line.discount, data.currency)}
                      </td>
                      <td>
                        <button
                          className="crm-row-action"
                          type="button"
                          onClick={() =>
                            setCart((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="crm-form-grid" style={{ marginTop: 16 }}>
          <label>
            <span>Customer</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Walk-in customer</option>
              {data.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.loyaltyPoints} pts
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Payment method</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Whole-cart discount</span>
            <input
              type="number"
              min={0}
              value={cartDiscount}
              disabled={!data.canApplyDiscount}
              onChange={(event) => setCartDiscount(Math.max(0, Number(event.target.value)))}
            />
          </label>
          <label>
            <span>Subtotal</span>
            <input value={formatMoney(subtotal, data.currency)} readOnly tabIndex={-1} />
          </label>
          <label>
            <span>Discount</span>
            <input value={formatMoney(totalDiscount, data.currency)} readOnly tabIndex={-1} />
          </label>
          <label>
            <span>Total due</span>
            <input value={formatMoney(total, data.currency)} readOnly tabIndex={-1} />
          </label>
        </div>

        {overDiscountLimit && (
          <p className="login-error" role="alert">
            The discount exceeds your {data.maxDiscountPercent}% limit (
            {formatMoney(discountCeiling, data.currency)} on this cart). The server will reject the sale.
          </p>
        )}

        <div className="crm-form-actions">
          <button
            className="crm-button crm-button-primary"
            type="button"
            disabled={pending || cart.length === 0}
            onClick={submitSale}
          >
            {pending ? "Completing…" : `Complete sale · ${formatMoney(total, data.currency)}`}
          </button>
        </div>
      </section>

      {receipt && <ReceiptPanel receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function ReceiptPanel({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  function download() {
    const text = [
      receipt.entityName,
      `Invoice: ${receipt.invoiceNumber}`,
      `Date: ${new Date(receipt.soldAt).toLocaleString("en-GB")}`,
      `Served by: ${receipt.cashier}`,
      `Payment: ${receipt.paymentMethod}`,
      "",
      ...receipt.lines.map(
        (line) =>
          `${line.quantity} x ${line.productName} (${line.batchNumber}) @ ${line.unitPrice} = ${
            line.unitPrice * line.quantity - line.discount
          }`
      ),
      "",
      `Subtotal: ${receipt.subtotal}`,
      `Discount: ${receipt.discount}`,
      `Total: ${receipt.total} ${receipt.currency}`,
    ].join("\n");

    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${receipt.invoiceNumber}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="crm-panel crm-enter">
      <SectionHead title={`Receipt ${receipt.invoiceNumber}`} note={receipt.entityName}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="crm-row-action" type="button" onClick={() => window.print()}>
            Print
          </button>
          <button className="crm-row-action" type="button" onClick={download}>
            Download
          </button>
          <button className="crm-row-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </SectionHead>

      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Batch</th>
              <th style={{ textAlign: "right" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Price</th>
              <th style={{ textAlign: "right" }}>Discount</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, index) => (
              <tr key={`${line.batchId}-${index}`}>
                <td>
                  <strong>{line.productName}</strong>
                </td>
                <td>{line.batchNumber}</td>
                <td style={{ textAlign: "right" }}>{line.quantity}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(line.unitPrice, receipt.currency)}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(line.discount, receipt.currency)}</td>
                <td style={{ textAlign: "right" }}>
                  {formatMoney(line.unitPrice * line.quantity - line.discount, receipt.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12 }}>
        <strong>Total paid ({receipt.paymentMethod}): {formatMoney(receipt.total, receipt.currency)}</strong>
        <br />
        <small style={{ opacity: 0.7 }}>Served by {receipt.cashier}.</small>
      </p>
    </section>
  );
}
