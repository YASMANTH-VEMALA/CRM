"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addEmployee,
  saveEmployeePermissions,
  setEmployeeEntityAccess,
  setEmployeeStatus,
} from "../actions/employees";
import type { EmployeeRow, EmployeesData } from "@/lib/data/employees";
import type { Role } from "@/lib/permissions";
import { isOverridable } from "@/lib/permissions";
import {
  Feedback,
  PageHead,
  PermissionNotice,
  SectionHead,
  StatStrip,
  Status,
  formatDateTime,
  useActionPanel,
} from "./shared";

export function EmployeesView({ data }: { data: EmployeesData }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();

  const [createState, createAction, creating] = useActionState(addEmployee, null);
  const [permState, permAction, permPending] = useActionState(saveEmployeePermissions, null);
  const [showForm, setShowForm] = useActionPanel(createState);

  // The permission editor closes itself once the save succeeds, derived from
  // the action result rather than synchronised in an effect.
  const [editTarget, setEditTarget] = useState<{ row: EmployeeRow; seen: unknown } | null>(null);
  const editSucceeded =
    editTarget !== null && editTarget.seen !== permState && Boolean(permState?.ok);
  const editing = editTarget && !editSucceeded ? editTarget.row : null;

  function openEditor(row: EmployeeRow) {
    setEditTarget({ row, seen: permState });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleStatus(row: EmployeeRow) {
    setMessage(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await setEmployeeStatus(row.id, row.status === "active" ? "disabled" : "active");
      setBusyId(null);
      setMessage(
        result.ok
          ? { ok: true, message: `${row.fullName} is now ${row.status === "active" ? "disabled" : "active"}.` }
          : { ok: false, message: result.error }
      );
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow={`Administration · ${data.entityName}`}
        title="Users and permissions"
        description="Role templates set the defaults; per-user overrides grant or revoke individual permissions on top. Every check is enforced on the server and in the database, not just in this interface."
      >
        {data.canManage && (
          <button
            className="crm-button crm-button-primary"
            type="button"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close" : "Add user"} <i>+</i>
          </button>
        )}
      </PageHead>

      <StatStrip stats={data.stats} />
      <Feedback state={message} />

      {!data.canManage && <PermissionNotice what="manage users and permissions" />}

      {showForm && data.canManage && (
        <section className="crm-panel crm-enter">
          <SectionHead
            title="Add user"
            note="Creates the staff record. Login access is granted separately by creating an auth account with the same email."
          />
          <form action={createAction} className="crm-form-grid">
            <label>
              <span>Full name</span>
              <input name="full_name" required />
            </label>
            <label>
              <span>Role</span>
              <select name="role" required defaultValue="sales_user">
                {data.roleOptions
                  .filter((option) => data.isMaster || option.value !== "master_admin")
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Username</span>
              <input name="username" />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" />
            </label>
            {data.isMaster && (
              <label>
                <span>Entity</span>
                <select name="branch_id" defaultValue="">
                  <option value="">Active entity</option>
                  {data.entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>Approval limit</span>
              <input name="approval_limit" type="number" min="0" step="1" />
            </label>
            <label>
              <span>Maximum discount %</span>
              <input name="max_discount_percent" type="number" min="0" max="100" step="0.1" defaultValue={0} />
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <Feedback
                state={
                  createState == null
                    ? null
                    : createState.ok
                      ? { ok: true, message: "User created." }
                      : { ok: false, message: createState.error }
                }
              />
            </div>
            <div className="crm-form-actions">
              <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="crm-button crm-button-primary" type="submit" disabled={creating}>
                {creating ? "Saving…" : "Create user"}
              </button>
            </div>
          </form>
        </section>
      )}

      {editing && data.canManage && (
        <PermissionEditor
          key={editing.id}
          data={data}
          employee={editing}
          action={permAction}
          pending={permPending}
          state={permState}
          onClose={() => setEditTarget(null)}
          onMessage={setMessage}
        />
      )}

      <section className="crm-panel crm-enter crm-enter-2">
        <SectionHead title="Users" note={`${data.employees.length} user${data.employees.length === 1 ? "" : "s"}.`} />
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Entity</th>
                <th style={{ textAlign: "right" }}>Extra entities</th>
                <th style={{ textAlign: "right" }}>Max discount</th>
                <th>Login</th>
                <th>Last login</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.employees.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", opacity: 0.6, padding: "24px 0" }}>
                    No users in this entity.
                  </td>
                </tr>
              )}
              {data.employees.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.fullName}</strong>
                    {row.username && (
                      <>
                        <br />
                        <small style={{ opacity: 0.7 }}>{row.username}</small>
                      </>
                    )}
                  </td>
                  <td>{row.email ?? "—"}</td>
                  <td>{row.roleLabel}</td>
                  <td>{row.entityName ?? (row.role === "master_admin" ? "All entities" : "—")}</td>
                  <td style={{ textAlign: "right" }}>{row.extraEntityIds.length || "—"}</td>
                  <td style={{ textAlign: "right" }}>{row.maxDiscountPercent}%</td>
                  <td>{row.hasLogin ? "Yes" : "No"}</td>
                  <td>{formatDateTime(row.lastLoginAt)}</td>
                  <td>
                    <Status value={row.status} />
                  </td>
                  <td>
                    {data.canManage && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="crm-row-action" type="button" onClick={() => openEditor(row)}>
                          Permissions
                        </button>
                        <button
                          className="crm-row-action"
                          type="button"
                          disabled={busyId === row.id || row.id === data.currentEmployeeId}
                          title={
                            row.id === data.currentEmployeeId
                              ? "You cannot change your own account status."
                              : undefined
                          }
                          onClick={() => toggleStatus(row)}
                        >
                          {busyId === row.id ? "Saving…" : row.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </div>
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

function PermissionEditor({
  data,
  employee,
  action,
  pending,
  state,
  onClose,
  onMessage,
}: {
  data: EmployeesData;
  employee: EmployeeRow;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { ok: true } | { ok: false; error: string } | null;
  onClose: () => void;
  onMessage: (message: { ok: boolean; message: string } | null) => void;
}) {
  const [role, setRole] = useState<Role>(employee.role);
  const [granted, setGranted] = useState<Set<string>>(new Set(employee.permissions));
  const [entityBusy, setEntityBusy] = useState<string | null>(null);
  const [extraEntities, setExtraEntities] = useState<Set<string>>(new Set(employee.extraEntityIds));
  const [, startTransition] = useTransition();

  // Deviations are computed against the role currently selected in the
  // dropdown, so the editor shows what will be saved rather than what was.
  const defaults = new Set(data.roleDefaults[role] ?? []);

  function applyRoleTemplate(nextRole: Role) {
    setRole(nextRole);
    setGranted(new Set(data.roleDefaults[nextRole] ?? []));
  }

  function toggleEntity(entityId: string, grant: boolean) {
    onMessage(null);
    setEntityBusy(entityId);
    startTransition(async () => {
      const result = await setEmployeeEntityAccess(employee.id, entityId, grant);
      setEntityBusy(null);
      if (result.ok) {
        setExtraEntities((current) => {
          const next = new Set(current);
          if (grant) next.add(entityId);
          else next.delete(entityId);
          return next;
        });
        onMessage({ ok: true, message: grant ? "Entity access granted." : "Entity access revoked." });
      } else {
        onMessage({ ok: false, message: result.error });
      }
    });
  }

  return (
    <section className="crm-panel crm-enter">
      <SectionHead
        title={`Permissions · ${employee.fullName}`}
        note="Ticking or unticking a box away from the role template is stored as a per-user override, so later changes to the template still reach users who were never customised."
      >
        <button className="crm-row-action" type="button" onClick={onClose}>
          Close
        </button>
      </SectionHead>

      <form action={action}>
        <input type="hidden" name="employee_id" value={employee.id} />

        <div className="crm-form-grid">
          <label>
            <span>Role template</span>
            <select
              name="role"
              value={role}
              onChange={(event) => applyRoleTemplate(event.target.value as Role)}
            >
              {data.roleOptions
                .filter((option) => data.isMaster || option.value !== "master_admin")
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Maximum discount %</span>
            <input
              name="max_discount_percent"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue={employee.maxDiscountPercent}
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Permissions</h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 8,
            }}
          >
            {data.permissionCatalogue.map((permission) => {
              const isGranted = granted.has(permission.value);
              const isDefault = defaults.has(permission.value);
              const overridden = isGranted !== isDefault;
              // Master-tier permissions come from the role template only. The
              // database rejects them as overrides, so showing an editable box
              // would promise something the server will refuse.
              const locked = !isOverridable(permission.value);
              return (
                <label
                  key={permission.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexDirection: "row",
                    opacity: locked ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    name={`perm_${permission.value}`}
                    checked={locked ? isDefault : isGranted}
                    disabled={locked}
                    title={locked ? "Set by the role template — change the role to grant this." : undefined}
                    onChange={(event) =>
                      setGranted((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(permission.value);
                        else next.delete(permission.value);
                        return next;
                      })
                    }
                  />
                  <span style={{ flex: 1 }}>
                    {permission.label}
                    {locked && (
                      <small style={{ marginLeft: 6, opacity: 0.75 }}>· role-only</small>
                    )}
                    {!locked && overridden && (
                      <small style={{ marginLeft: 6, opacity: 0.75 }}>
                        · overridden ({isDefault ? "template grants" : "template denies"})
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Feedback
            state={
              state == null
                ? null
                : state.ok
                  ? { ok: true, message: "Permissions saved." }
                  : { ok: false, message: state.error }
            }
          />
        </div>

        <div className="crm-form-actions">
          <button className="crm-button crm-button-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save permissions"}
          </button>
        </div>
      </form>

      <div style={{ marginTop: 20 }}>
        <SectionHead
          title="Entity access"
          note="Additional entities this user may switch into, beyond their home entity."
        />
        {employee.role === "master_admin" ? (
          <p style={{ opacity: 0.75 }}>
            Master administrators can access every entity, so no additional grants are needed.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 8,
            }}
          >
            {data.entities.map((entity) => {
              const isHome = entity.id === employee.entityId;
              const hasAccess = isHome || extraEntities.has(entity.id);
              return (
                <label
                  key={entity.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}
                >
                  <input
                    type="checkbox"
                    checked={hasAccess}
                    disabled={isHome || entityBusy === entity.id}
                    onChange={(event) => toggleEntity(entity.id, event.target.checked)}
                  />
                  <span>
                    {entity.name}
                    {isHome && <small style={{ marginLeft: 6, opacity: 0.75 }}>· home entity</small>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
