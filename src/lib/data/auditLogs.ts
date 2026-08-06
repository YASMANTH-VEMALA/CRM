import "server-only";
import { getScope } from "./scope";
import { formatDateTime } from "@/app/dashboard/views/shared";

export type AuditLogsData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
};

const EMPTY_STATS: Array<[string, string, string]> = [
  ["Events today", "0", "All modules"],
  ["Sensitive actions", "0", "Reason logged"],
  ["Active sessions", "0", "Distinct today"],
  ["Logged events", "0", "Most recent"],
];

export async function getAuditLogsData(): Promise<AuditLogsData> {
  const scope = await getScope();
  const { supabase, entityId } = scope;

  // Audit history is management-only: without the report permission the page
  // still renders, but it must not carry a single log line to the client.
  if (!scope.canViewReports) return { stats: EMPTY_STATS, rows: [] };

  let query = supabase
    .from("audit_logs")
    .select("*, employees(full_name), branches(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (entityId) query = query.eq("branch_id", entityId);

  const { data: logs } = await query;

  const allLogs = logs ?? [];

  const todayKey = new Date().toDateString();
  const isToday = (value: string) => new Date(value).toDateString() === todayKey;

  const eventsToday = allLogs.filter((log) => isToday(log.created_at)).length;
  const sensitiveActions = allLogs.filter((log) => log.reason !== null).length;
  const activeSessionsToday = new Set(
    allLogs
      .filter((log) => isToday(log.created_at) && log.session_ref !== null)
      .map((log) => log.session_ref)
  ).size;

  const stats: Array<[string, string, string]> = [
    ["Events today", String(eventsToday), "All modules"],
    ["Sensitive actions", String(sensitiveActions), "Reason logged"],
    ["Active sessions", String(activeSessionsToday), "Distinct today"],
    ["Logged events", String(allLogs.length), "Most recent"],
  ];

  const rows = allLogs.map((log) => {
    const employeeName = (log.employees as { full_name: string } | null)?.full_name ?? "System";
    const branchName = (log.branches as { name: string } | null)?.name ?? "—";
    const modulePart = log.module ?? "—";
    const recordPart = log.record_reference ?? "—";
    const prevNew =
      log.previous_value === null && log.new_value === null
        ? "—"
        : `${log.previous_value ?? "—"} → ${log.new_value ?? "—"}`;
    const dateSession = `${formatDateTime(log.created_at)}${log.session_ref ? ` · ${log.session_ref}` : ""}`;

    return [
      employeeName,
      log.action,
      `${modulePart} / ${recordPart}`,
      prevNew,
      log.reason ?? "—",
      branchName,
      dateSession,
    ];
  });

  return { stats, rows };
}
