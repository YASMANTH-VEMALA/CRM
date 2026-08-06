"use client";

import { useMemo, useState, type ReactNode } from "react";

export type ActionHandler = (label: string) => void;

export function PageHead({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="crm-page-head crm-enter">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {children && <div className="crm-page-actions">{children}</div>}
    </div>
  );
}

export function SectionHead({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="crm-section-head">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </div>
  );
}

export function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const tone =
    lower.includes("active") ||
    lower.includes("complete") ||
    lower.includes("approved") ||
    lower.includes("confirmed") ||
    lower.includes("received")
      ? "good"
      : lower.includes("pending") || lower.includes("low") || lower.includes("draft") || lower.includes("partial") || lower.includes("review")
        ? "wait"
        : lower.includes("out") ||
            lower.includes("expired") ||
            lower.includes("rejected") ||
            lower.includes("cancelled") ||
            lower.includes("reversed") ||
            lower.includes("damaged") ||
            lower.includes("quarantined")
          ? "risk"
          : "default";
  return (
    <span className={`crm-status is-${tone}`}>
      <i />
      {value}
    </span>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  /** Cell content; return a string for plain text or a node for rich cells. */
  render: (row: T) => ReactNode;
  /** Text used for search and sort; falls back to the rendered string. */
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
};

/**
 * Sortable, searchable table over typed rows. Replaces the previous
 * string-matrix table so views can render real cells (status pills, actions)
 * and sort numerically rather than lexically.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  emptyMessage = "No records yet.",
  searchPlaceholder,
  actions,
  initialSort,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  actions?: (row: T) => ReactNode;
  initialSort?: { key: string; direction: "asc" | "desc" };
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    initialSort ?? null
  );

  const searchable = useMemo(
    () =>
      rows.map((row) => ({
        row,
        haystack: columns
          .map((column) => {
            const value = column.sortValue?.(row);
            if (value !== undefined) return String(value);
            const rendered = column.render(row);
            return typeof rendered === "string" || typeof rendered === "number" ? String(rendered) : "";
          })
          .join(" ")
          .toLowerCase(),
      })),
    [rows, columns]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle ? searchable.filter((item) => item.haystack.includes(needle)) : searchable;
    if (!sort) return base.map((item) => item.row);

    const column = columns.find((c) => c.key === sort.key);
    if (!column) return base.map((item) => item.row);

    const valueOf = (row: T): string | number => {
      if (column.sortValue) return column.sortValue(row);
      const rendered = column.render(row);
      return typeof rendered === "string" || typeof rendered === "number" ? rendered : "";
    };

    const direction = sort.direction === "desc" ? -1 : 1;
    return [...base]
      .sort((a, b) => {
        const left = valueOf(a.row);
        const right = valueOf(b.row);
        if (typeof left === "number" && typeof right === "number") {
          return (left - right) * direction;
        }
        return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
      })
      .map((item) => item.row);
  }, [searchable, query, sort, columns]);

  function toggleSort(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    );
  }

  return (
    <>
      {searchPlaceholder && (
        <div className="crm-filter-bar">
          <label>
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <span style={{ alignSelf: "center", opacity: 0.7, fontSize: "0.85em" }}>
            {filtered.length} of {rows.length}
          </span>
        </div>
      )}
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ textAlign: column.numeric ? "right" : undefined }}>
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    style={{
                      background: "none",
                      border: 0,
                      font: "inherit",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    aria-label={`Sort by ${column.header}`}
                  >
                    {column.header}
                    {sort?.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              {actions && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (actions ? 1 : 0)}
                  style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}
                >
                  {query ? `Nothing matches “${query}”.` : emptyMessage}
                </td>
              </tr>
            )}
            {filtered.map((row, index) => (
              <tr key={getKey(row, index)}>
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    style={{ textAlign: column.numeric ? "right" : undefined }}
                  >
                    {columnIndex === 0 ? <strong>{column.render(row)}</strong> : column.render(row)}
                  </td>
                ))}
                {actions && <td>{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Read-only table over the preformatted `string[][]` payloads that the
 * secondary modules still return. Supports search and status pills but no
 * row actions — screens that need actions use the typed `DataTable`.
 */
export function StringTable({
  columns,
  rows,
  statusColumn,
  emptyMessage = "No records yet.",
  searchPlaceholder,
  actions,
}: {
  columns: string[];
  rows: string[][];
  /** Index of the column to render as a status pill. */
  statusColumn?: number;
  emptyMessage?: string;
  searchPlaceholder?: string;
  actions?: (row: string[], index: number) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows
        .map((row, index) => ({ row, index }))
        .filter((item) => item.row.join(" ").toLowerCase().includes(needle))
    : rows.map((row, index) => ({ row, index }));

  return (
    <>
      {searchPlaceholder && (
        <div className="crm-filter-bar">
          <label>
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <span style={{ alignSelf: "center", opacity: 0.7, fontSize: "0.85em" }}>
            {visible.length} of {rows.length}
          </span>
        </div>
      )}
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              {actions && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (actions ? 1 : 0)}
                  style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}
                >
                  {query ? `Nothing matches “${query}”.` : emptyMessage}
                </td>
              </tr>
            )}
            {visible.map(({ row, index }) => (
              <tr key={`${row[0]}-${index}`}>
                {columns.map((column, columnIndex) => (
                  <td key={column}>
                    {columnIndex === 0 ? (
                      <strong>{row[columnIndex]}</strong>
                    ) : columnIndex === statusColumn ? (
                      <Status value={row[columnIndex] ?? "—"} />
                    ) : (
                      (row[columnIndex] ?? "—")
                    )}
                  </td>
                ))}
                {actions && <td>{actions(row, index)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function StatStrip({ stats }: { stats: Array<[string, string, string]> }) {
  return (
    <div className="crm-stat-strip">
      {stats.map(([label, value, note]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </div>
      ))}
    </div>
  );
}

export function MetricStrip({
  metrics,
}: {
  metrics: Array<{ label: string; value: string; note: string }>;
}) {
  return (
    <div className="crm-stat-strip">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>{metric.note}</small>
        </div>
      ))}
    </div>
  );
}

/**
 * Open/closed state for a form panel that should close itself once the server
 * action succeeds. The closed state is *derived* from the action result rather
 * than synchronised in an effect, which avoids a cascading re-render and the
 * stale-by-one-submit bug of reading the result inside `onSubmit`.
 *
 * A failed submit keeps the panel open so the error stays visible.
 */
export function useActionPanel(
  state: { ok: boolean } | null | undefined
): [boolean, (open: boolean | ((previous: boolean) => boolean)) => void] {
  const [openedWith, setOpenedWith] = useState<{ seen: unknown } | null>(null);
  const succeeded = openedWith !== null && openedWith.seen !== state && Boolean(state?.ok);
  const isOpen = openedWith !== null && !succeeded;

  function setOpen(open: boolean | ((previous: boolean) => boolean)) {
    const next = typeof open === "function" ? open(isOpen) : open;
    setOpenedWith(next ? { seen: state } : null);
  }

  return [isOpen, setOpen];
}

/** Inline banner for action results. */
export function Feedback({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return state.ok ? (
    <p className="crm-feedback is-ok" role="status">
      ✓ {state.message}
    </p>
  ) : (
    <p className="login-error" role="alert">
      {state.message}
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="crm-empty-state">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function PermissionNotice({ what }: { what: string }) {
  return (
    <div className="crm-empty-state">
      <strong>Not available with your permissions</strong>
      <span>Ask an administrator if you need to {what}.</span>
    </div>
  );
}

export function formatMoney(value: number | null | undefined, currency = "TZS"): string {
  if (value == null) return "—";
  return `${currency} ${Math.round(value).toLocaleString("en-US")}`;
}

/** Pre-ERP call sites still use this; new code should pass the entity currency. */
export function formatTZS(value: number): string {
  return `TZS ${Math.round(value).toLocaleString("en-US")}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US");
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(value)
  );
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Days until expiry, rendered with a warning tone as the date approaches. */
export function ExpiryCell({ date, days }: { date: string | null; days: number | null }) {
  if (!date) return <>—</>;
  if (days === null) return <>{formatDate(date)}</>;
  const tone = days < 0 ? "risk" : days <= 90 ? "wait" : "good";
  const label = days < 0 ? `${formatDate(date)} · expired` : `${formatDate(date)} · ${days}d`;
  return (
    <span className={`crm-status is-${tone}`}>
      <i />
      {label}
    </span>
  );
}
