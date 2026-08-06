"use client";

import { useState, useTransition } from "react";
import { markAllRead, markNotificationRead } from "../actions/notifications";
import type { NotificationsData } from "@/lib/data/notifications";
import { PageHead, SectionHead, Status, StatStrip } from "./shared";

const TABS = [
  "All notifications",
  "Inventory",
  "Expiry",
  "Approvals",
  "Supplier orders",
  "Security",
  "System",
  "Unread",
];

// Tab labels are plural / friendlier than the raw `type` column stored on the
// notification row, so map them explicitly instead of assuming an exact match.
const TYPE_BY_TAB: Record<string, string> = {
  Inventory: "Inventory",
  Expiry: "Expiry",
  Approvals: "Approval",
  "Supplier orders": "Supplier order",
  Security: "Security",
  System: "System",
};

export function NotificationsView({ data }: { data: NotificationsData }) {
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = data.rows.filter((row) => {
    if (activeTab === "All notifications") return true;
    if (activeTab === "Unread") return row[5] === "Unread";
    return row[1] === (TYPE_BY_TAB[activeTab] ?? activeTab);
  });

  function handleOpen(id: string) {
    setPendingId(id);
    startTransition(async () => {
      await markNotificationRead(id);
      setPendingId(null);
    });
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Administration / Alerts"
        title="Notifications"
        description="Inventory, expiry, approval, supplier, security and system alerts for the entities you can access."
      >
        <button
          className="crm-button crm-button-primary"
          type="button"
          onClick={() => startTransition(async () => void (await markAllRead()))}
        >
          Mark all as read <i>✓</i>
        </button>
      </PageHead>
      <StatStrip stats={data.stats} />
      <div className="crm-tabs" role="tablist" aria-label="Notification views">
        {TABS.map((tab) => (
          <button
            className={activeTab === tab ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <section className="crm-panel crm-notification-list">
        <SectionHead title={activeTab} note="Live alerts from the Mars Pharmacy workspace." />
        {rows.map((row) => {
          const [id, type, title, message, time, state] = row;
          return (
            <article className={state === "Unread" ? "is-unread" : ""} key={id}>
              <i />
              <div>
                <span>{type}</span>
                <h3>{title}</h3>
                <p>{message}</p>
                <small>{time}</small>
              </div>
              <Status value={state} />
              <button
                type="button"
                disabled={isPending && pendingId === id}
                onClick={() => handleOpen(id)}
              >
                {isPending && pendingId === id ? "Opening…" : "Open →"}
              </button>
            </article>
          );
        })}
        {rows.length === 0 && <p style={{ padding: "12px 16px", opacity: 0.6 }}>No notifications.</p>}
      </section>
    </div>
  );
}
