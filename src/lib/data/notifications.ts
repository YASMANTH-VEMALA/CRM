import "server-only";
import { getScope } from "./scope";
import { formatDateTime } from "@/app/dashboard/views/shared";

export type NotificationsData = {
  stats: Array<[string, string, string]>;
  // [id, type, title, message, formattedTime, "Read" | "Unread"]
  rows: string[][];
};

export async function getNotificationsData(): Promise<NotificationsData> {
  const { supabase, entityId } = await getScope();

  let query = supabase.from("notifications").select("*").order("created_at", { ascending: false });
  // branch_id is nullable here: null rows are network-wide announcements that
  // every entity must keep seeing alongside its own.
  if (entityId) query = query.or(`branch_id.is.null,branch_id.eq.${entityId}`);

  const { data: notifications } = await query;

  const all = notifications ?? [];

  const unreadCount = all.filter((n) => !n.is_read).length;
  const countByType = (type: string) => all.filter((n) => n.type === type).length;

  const stats: Array<[string, string, string]> = [
    ["Unread", String(unreadCount), "Needs attention"],
    ["Inventory alerts", String(countByType("Inventory")), "Current"],
    ["Approval requests", String(countByType("Approval")), "Pending"],
    ["Security", String(countByType("Security")), "Reviewed"],
    ["Total notifications", String(all.length), "All types"],
  ];

  const rows = all.map((n) => [
    n.id,
    n.type,
    n.title,
    n.message ?? "—",
    formatDateTime(n.created_at),
    n.is_read ? "Read" : "Unread",
  ]);

  return { stats, rows };
}
