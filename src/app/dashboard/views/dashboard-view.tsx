import Link from "next/link";
import type { DashboardData, EntityDashboard, MasterDashboard } from "@/lib/data/dashboard";
import { MetricStrip, SectionHead, Status, formatDateTime, formatMoney, formatNumber } from "./shared";

export function DashboardView({ data }: { data: DashboardData }) {
  return data.kind === "master" ? <MasterView data={data} /> : <EntityView data={data} />;
}

function Panel({
  title,
  note,
  children,
  href,
  linkLabel,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <section className="crm-panel crm-enter">
      <SectionHead title={title} note={note}>
        {href && (
          <Link className="crm-row-action" href={href}>
            {linkLabel ?? "Open"} →
          </Link>
        )}
      </SectionHead>
      {children}
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <p style={{ opacity: 0.7, padding: "8px 0" }}>{message}</p>;
}

function EntityView({ data }: { data: EntityDashboard }) {
  return (
    <div className="crm-page">
      <div className="crm-page-head crm-enter">
        <div>
          <p>Overview · {data.entityName}</p>
          <h1>Dashboard</h1>
          <span>
            Today&apos;s trading, stock position and the items needing attention in this entity.
          </span>
        </div>
      </div>

      <MetricStrip metrics={data.metrics} />

      <Panel
        title="Low stock"
        note="Products at or below their minimum quantity."
        href="/dashboard/low-stock"
        linkLabel="Stock requirement"
      >
        {data.lowStock.length === 0 ? (
          <Empty message="Nothing is below its minimum quantity." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>Available</th>
                  <th style={{ textAlign: "right" }}>Minimum</th>
                  <th style={{ textAlign: "right" }}>Reorder</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.map((row) => (
                  <tr key={row.sku}>
                    <td>
                      <strong>{row.sku}</strong>
                    </td>
                    <td>{row.name}</td>
                    <td style={{ textAlign: "right" }}>{row.available}</td>
                    <td style={{ textAlign: "right" }}>{row.minimum}</td>
                    <td style={{ textAlign: "right" }}>{row.reorder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Out of stock" note="No sellable quantity remaining." href="/dashboard/low-stock">
        {data.outOfStock.length === 0 ? (
          <Empty message="Everything active is in stock." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Default supplier</th>
                </tr>
              </thead>
              <tbody>
                {data.outOfStock.map((row) => (
                  <tr key={row.sku}>
                    <td>
                      <strong>{row.sku}</strong>
                    </td>
                    <td>{row.name}</td>
                    <td>{row.supplierName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent sales" href="/dashboard/sales-history" linkLabel="Sales history">
        {data.recentSales.length === 0 ? (
          <Empty message="No sales recorded yet." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Served by</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSales.map((sale) => (
                  <tr key={sale.invoice}>
                    <td>
                      <strong>{sale.invoice}</strong>
                    </td>
                    <td>{sale.customer}</td>
                    <td>{sale.cashier}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(sale.total, data.currency)}</td>
                    <td>
                      <Status value={sale.status} />
                    </td>
                    <td>{formatDateTime(sale.soldAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent stock inward" href="/dashboard/stock-inward">
        {data.recentInward.length === 0 ? (
          <Empty message="No stock has been received yet." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Supplier</th>
                  <th style={{ textAlign: "right" }}>Units</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.recentInward.map((row) => (
                  <tr key={row.reference}>
                    <td>
                      <strong>{row.reference}</strong>
                    </td>
                    <td>{row.type.replace(/_/g, " ")}</td>
                    <td>{row.supplier}</td>
                    <td style={{ textAlign: "right" }}>{row.units}</td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>{formatDateTime(row.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Top-selling products" note="By revenue this month.">
        {data.topProducts.length === 0 ? (
          <Empty message="No sales this month yet." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((row) => (
                  <tr key={row.sku}>
                    <td>
                      <strong>{row.sku}</strong>
                    </td>
                    <td>{row.name}</td>
                    <td style={{ textAlign: "right" }}>{formatNumber(row.quantity)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.revenue, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Employee performance" note="Sales revenue this month.">
        {data.employeePerformance.length === 0 ? (
          <Empty message="No attributed sales this month." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign: "right" }}>Transactions</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.employeePerformance.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td style={{ textAlign: "right" }}>{row.transactions}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.revenue, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Pending supplier returns"
        note="Awaiting approval; stock has not moved yet."
        href="/dashboard/returns"
      >
        {data.pendingSupplierReturns.length === 0 ? (
          <Empty message="No supplier returns are awaiting approval." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th>Resolution</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingSupplierReturns.map((row) => (
                  <tr key={row.reference}>
                    <td>
                      <strong>{row.reference}</strong>
                    </td>
                    <td>{row.product}</td>
                    <td style={{ textAlign: "right" }}>{row.quantity}</td>
                    <td>{row.resolution ?? "—"}</td>
                    <td>
                      <Status value={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function MasterView({ data }: { data: MasterDashboard }) {
  return (
    <div className="crm-page">
      <div className="crm-page-head crm-enter">
        <div>
          <p>Overview · All entities</p>
          <h1>Master dashboard</h1>
          <span>
            Consolidated performance across every pharmacy. Switch to a single entity in the entity
            selector for its operational view.
          </span>
        </div>
      </div>

      <MetricStrip metrics={data.metrics} />

      <Panel
        title="Entity comparison"
        note={data.bestEntity ? `Best performer this month: ${data.bestEntity}.` : "No sales this month yet."}
        href="/dashboard/reports?report=consolidated"
        linkLabel="Consolidated report"
      >
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Entity</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Transactions</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
                {data.canViewProfit && <th style={{ textAlign: "right" }}>Gross profit</th>}
                {data.canViewCost && <th style={{ textAlign: "right" }}>Stock value</th>}
                <th style={{ textAlign: "right" }}>Low stock</th>
              </tr>
            </thead>
            <tbody>
              {data.entities.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No entities yet.
                  </td>
                </tr>
              )}
              {data.entities.map((entity) => (
                <tr key={entity.id}>
                  <td>
                    <strong>{entity.code}</strong>
                  </td>
                  <td>{entity.name}</td>
                  <td>
                    <Status value={entity.isActive ? "Active" : "Inactive"} />
                  </td>
                  <td style={{ textAlign: "right" }}>{formatNumber(entity.transactions)}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(entity.revenue, data.currency)}</td>
                  {data.canViewProfit && (
                    <td style={{ textAlign: "right" }}>{formatMoney(entity.profit, data.currency)}</td>
                  )}
                  {data.canViewCost && (
                    <td style={{ textAlign: "right" }}>
                      {formatMoney(entity.stockValue, data.currency)}
                    </td>
                  )}
                  <td style={{ textAlign: "right" }}>{entity.lowStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Employee revenue comparison" note="Across all entities, this month.">
        {data.employeeComparison.length === 0 ? (
          <Empty message="No attributed sales this month." />
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Entity</th>
                  <th style={{ textAlign: "right" }}>Transactions</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.employeeComparison.map((row) => (
                  <tr key={`${row.name}-${row.entity}`}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.entity}</td>
                    <td style={{ textAlign: "right" }}>{row.transactions}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.revenue, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
