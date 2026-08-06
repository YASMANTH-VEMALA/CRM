"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveEntity } from "./actions/entity";
import type { EntityContext } from "@/lib/entity";

/**
 * Switches the active entity. Non-master users only ever see entities they
 * have been granted; master admins additionally get the consolidated
 * "All entities" option that drives the master dashboard and reports.
 */
export function EntitySwitcher({ context }: { context: EntityContext }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (context.entities.length === 0) {
    return (
      <label className="crm-branch-select">
        <span>Entity</span>
        <select disabled>
          <option>No entity assigned</option>
        </select>
      </label>
    );
  }

  if (!context.canSwitch) {
    return (
      <label className="crm-branch-select">
        <span>Entity</span>
        <select disabled value={context.activeEntityId ?? ""}>
          {context.entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function handleChange(value: string) {
    startTransition(async () => {
      const result = await setActiveEntity(value);
      if (result.ok) router.refresh();
    });
  }

  return (
    <label className="crm-branch-select">
      <span>Entity{pending ? " · switching…" : ""}</span>
      <select
        value={context.activeEntityId ?? "all"}
        disabled={pending}
        onChange={(event) => handleChange(event.target.value)}
      >
        {context.canViewAll && <option value="all">All entities (consolidated)</option>}
        {context.entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
            {entity.is_active ? "" : " (inactive)"}
          </option>
        ))}
      </select>
    </label>
  );
}
