"use client";

import type { AuditLogsData } from "@/lib/data/auditLogs";
import { EmptyState, PageHead, SectionHead, StatStrip, StringTable } from "./shared";

export function AuditLogsView({ data }: { data: AuditLogsData }) {
  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Administration"
        title="Audit logs"
        description="Sensitive actions with their before and after values: price changes, permission changes, stock corrections, import confirmations, purchase confirmations, sale cancellations and supplier returns."
      />

      <StatStrip stats={data.stats} />

      <section className="crm-panel crm-enter">
        <SectionHead title="Recorded actions" note={`${data.rows.length} entr${data.rows.length === 1 ? "y" : "ies"}.`} />
        {data.rows.length === 0 ? (
          <EmptyState
            title="No audit history available"
            hint="Audit history requires the management reports permission, and is scoped to the entities you can access."
          />
        ) : (
          <StringTable
            columns={[
              "Employee",
              "Action",
              "Module / Record",
              "Previous → New",
              "Reason",
              "Entity",
              "Date / Session",
            ]}
            rows={data.rows}
            searchPlaceholder="Search by user, action, module or record…"
          />
        )}
      </section>
    </div>
  );
}
