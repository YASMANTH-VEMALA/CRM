"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { createEntity, setEntityStatus, updateEntity } from "../actions/entities";
import type { EntitiesData, EntityRow } from "@/lib/data/entities";
import {
  Column,
  DataTable,
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatMoney,
  formatNumber,
} from "./shared";

const TABS = ["All entities", "Active", "Disabled"] as const;
type Tab = (typeof TABS)[number];

export function EntitiesView({ data }: { data: EntitiesData }) {
  const [tab, setTab] = useState<Tab>("All entities");
  const [statusFeedback, setStatusFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [createState, createAction, creating] = useActionState(createEntity, null);
  const [editState, editAction, editPending] = useActionState(updateEntity, null);
  const [statusPending, startStatus] = useTransition();

  // Panel visibility is derived from the action result, so a successful save
  // closes it without an effect and without reading a stale result.
  const [panel, setPanel] = useState<{
    mode: "create" | "edit";
    row: EntityRow | null;
    seen: unknown;
  } | null>(null);
  const panelState = panel?.mode === "edit" ? editState : createState;
  const panelSucceeded = panel !== null && panel.seen !== panelState && Boolean(panelState?.ok);
  const openPanel = panel && !panelSucceeded ? panel : null;
  const mode = openPanel?.mode ?? "none";
  const editing = openPanel?.row ?? null;

  const rows = useMemo(
    () =>
      data.entities.filter((entity) => {
        if (tab === "Active") return entity.isActive;
        if (tab === "Disabled") return !entity.isActive;
        return true;
      }),
    [data.entities, tab]
  );

  function toggleStatus(row: EntityRow) {
    setStatusFeedback(null);
    startStatus(async () => {
      const result = await setEntityStatus(row.id, !row.isActive);
      setStatusFeedback(
        result.ok
          ? { ok: true, message: `${row.name} is now ${row.isActive ? "disabled" : "active"}.` }
          : { ok: false, message: result.error }
      );
    });
  }

  const columns: Column<EntityRow>[] = [
    { key: "code", header: "Code", render: (row) => row.code, sortValue: (row) => row.code },
    {
      key: "name",
      header: "Entity",
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <small style={{ opacity: 0.7 }}>{row.registeredName ?? "No registered name"}</small>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    { key: "location", header: "Location", render: (row) => row.location ?? "—" },
    { key: "manager", header: "Manager", render: (row) => row.managerName ?? "—" },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <div>
          <div>{row.phone ?? "—"}</div>
          <small style={{ opacity: 0.7 }}>{row.email ?? "No email"}</small>
        </div>
      ),
      sortValue: (row) => `${row.phone ?? ""} ${row.email ?? ""}`.trim(),
    },
    { key: "currency", header: "Currency", render: (row) => row.currency },
    {
      key: "employees",
      header: "Employees",
      numeric: true,
      render: (row) => formatNumber(row.employeeCount),
      sortValue: (row) => row.employeeCount,
    },
    {
      key: "products",
      header: "Products",
      numeric: true,
      render: (row) => formatNumber(row.productCount),
      sortValue: (row) => row.productCount,
    },
    {
      key: "lowStock",
      header: "Low stock",
      numeric: true,
      render: (row) => formatNumber(row.lowStockCount),
      sortValue: (row) => row.lowStockCount,
    },
    ...(data.canViewCost
      ? [
          {
            key: "stockValue",
            header: "Stock value",
            numeric: true,
            render: (row: EntityRow) => formatMoney(row.stockValue, row.currency),
            sortValue: (row: EntityRow) => row.stockValue ?? 0,
          },
        ]
      : []),
    {
      key: "revenue",
      header: "Today's revenue",
      numeric: true,
      render: (row) => formatMoney(row.todayRevenue, row.currency),
      sortValue: (row) => row.todayRevenue,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Status value={row.isActive ? "Active" : "Disabled"} />,
    },
  ];

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Administration · Network"
        title="Entities"
        description="Every branch, pharmacy or company in the group, with its own code, currency, timezone and staff. Stock value is visible only to users with the purchase-cost permission."
      >
        {data.canManage && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() =>
              setPanel(mode === "create" ? null : { mode: "create", row: null, seen: createState })
            }
          >
            {mode === "create" ? "Close" : "Add entity"} <i>+</i>
          </button>
        )}
      </PageHead>

      <StatStrip stats={data.stats} />

      {data.canManage && mode === "create" && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Add entity"
            note="Creates a real entity. It starts active and can trade as soon as products are loaded."
          />
          <EntityForm
            key="create"
            action={createAction}
            pending={creating}
            state={createState}
            onCancel={() => setPanel(null)}
          />
        </section>
      )}

      {data.canManage && mode === "edit" && editing && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title={`Edit ${editing.name}`}
            note="Changing the currency affects how new figures are displayed; historical amounts are not converted."
          />
          <EntityForm
            key={editing.id}
            entity={editing}
            action={editAction}
            pending={editPending}
            state={editState}
            onCancel={() => setPanel(null)}
          />
        </section>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Entity views">
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

      {statusFeedback && (
        <div style={{ marginBottom: 12 }}>
          <Feedback state={statusFeedback} />
        </div>
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead
          title={tab}
          note={`${rows.length} entit${rows.length === 1 ? "y" : "ies"}.${statusPending ? " Updating status…" : ""}`}
        />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(row) => row.id}
          searchPlaceholder="Search by code, name, location or manager…"
          emptyMessage="No entities match this view."
          actions={
            data.canManage
              ? (row) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="crm-row-action"
                      type="button"
                      onClick={() => {
                        setPanel({ mode: "edit", row, seen: editState });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="crm-row-action"
                      type="button"
                      disabled={statusPending}
                      onClick={() => toggleStatus(row)}
                    >
                      {row.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )
              : undefined
          }
        />
      </section>

      {!data.canManage && <PermissionNotice what="manage entities" />}
    </div>
  );
}

function EntityForm({
  entity,
  action,
  pending,
  state,
  onCancel,
}: {
  entity?: EntityRow;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { ok: true } | { ok: false; error: string } | null;
  onCancel: () => void;
}) {
  return (
    <form action={action} className="crm-form-grid">
      {entity && <input type="hidden" name="entity_id" value={entity.id} />}

      <label>
        <span>Entity name</span>
        <input name="name" required defaultValue={entity?.name ?? ""} placeholder="Kariakoo Pharmacy" />
      </label>
      <label>
        {/* Server normalises to upper case and enforces 2-20 letters, digits or hyphens. */}
        <span>Entity code</span>
        <input name="code" required defaultValue={entity?.code ?? ""} placeholder="KRK-01" />
      </label>
      <label className="is-wide">
        <span>Registered / legal name</span>
        <input name="registered_name" defaultValue={entity?.registeredName ?? ""} />
      </label>
      <label>
        <span>Phone</span>
        <input name="phone" defaultValue={entity?.phone ?? ""} placeholder="+255 7XX XXX XXX" />
      </label>
      <label>
        <span>Email</span>
        <input name="email" type="email" defaultValue={entity?.email ?? ""} />
      </label>
      <label className="is-wide">
        <span>Address</span>
        <input name="address" defaultValue={entity?.address ?? ""} />
      </label>
      <label>
        <span>Location / city</span>
        <input name="location" defaultValue={entity?.location ?? ""} placeholder="Dar es Salaam" />
      </label>
      <label>
        <span>Manager name</span>
        <input name="manager_name" defaultValue={entity?.managerName ?? ""} />
      </label>
      <label>
        <span>Currency (three-letter code)</span>
        <input
          name="currency"
          maxLength={3}
          defaultValue={entity?.currency ?? "TZS"}
          placeholder="TZS"
        />
      </label>
      <label>
        <span>Timezone</span>
        <input
          name="timezone"
          defaultValue={entity?.timezone ?? "Africa/Dar_es_Salaam"}
          placeholder="Africa/Dar_es_Salaam"
        />
      </label>

      <div style={{ gridColumn: "1 / -1" }}>
        <Feedback
          state={
            state == null
              ? null
              : state.ok
                ? { ok: true, message: entity ? "Entity updated." : "Entity created." }
                : { ok: false, message: state.error }
          }
        />
      </div>

      <div className="crm-form-actions">
        <button className="crm-button crm-button-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : entity ? "Save changes" : "Create entity"}
        </button>
      </div>
    </form>
  );
}
