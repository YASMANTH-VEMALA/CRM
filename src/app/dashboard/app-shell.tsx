"use client";

import Link from "next/link";
import { useState } from "react";
import { visibleNavGroups } from "./mock-data";
import { NavIcon } from "./nav-icons";
import { EntitySwitcher } from "./entity-switcher";
import { ViewContent, type SectionData } from "./views";
import { signOutAction } from "../login/actions";
import type { CurrentEmployee } from "@/lib/dal";
import type { EntityContext } from "@/lib/entity";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Notification } from "@/lib/types";

export default function AppShell({
  section,
  employee,
  entityContext,
  notifications,
  data,
}: {
  section: string;
  employee: CurrentEmployee;
  entityContext: EntityContext;
  notifications: Notification[];
  data: SectionData;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const groups = visibleNavGroups(employee.permissions, employee.isMaster);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const activeLabel =
    groups.flatMap((group) => group.items).find((item) => item.slug === section)?.label ??
    (section === "profile" ? "User profile" : "Dashboard");

  const currentDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const initials = employee.full_name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  const roleLabel = ROLE_LABELS[employee.role] ?? employee.role;

  return (
    <div className={`crm-app ${sidebarCompact ? "crm-compact" : ""}`}>
      <div
        className={`crm-sidebar-overlay ${sidebarOpen ? "is-open" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <aside className={`crm-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="crm-sidebar-head">
          <Link className="crm-brand" href="/dashboard">
            <span>M</span>
            <div>
              <strong>Mars Pharmacy</strong>
              <small>{entityContext.activeEntity?.name ?? "All entities"}</small>
            </div>
          </Link>
          <button
            className="crm-sidebar-toggle"
            type="button"
            onClick={() => setSidebarCompact((value) => !value)}
            aria-label={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCompact ? "→" : "←"}
          </button>
        </div>

        <nav className="crm-nav" aria-label="Application navigation">
          {groups.map((group) => (
            <div className="crm-nav-group" key={group.label}>
              <span className="crm-nav-label">{group.label}</span>
              {group.items.map((item) => {
                const href = item.slug === "dashboard" ? "/dashboard" : `/dashboard/${item.slug}`;
                return (
                  <Link
                    className={section === item.slug ? "is-active" : ""}
                    href={href}
                    key={item.slug}
                    onClick={() => setSidebarOpen(false)}
                    title={item.label}
                  >
                    <NavIcon slug={item.slug} />
                    <span>{item.label}</span>
                    {item.slug === "notifications" && unreadCount > 0 && <em>{unreadCount}</em>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="crm-sidebar-foot">
          <div>
            <i /> <span>{employee.full_name}</span>
          </div>
          <small>{roleLabel}</small>
        </div>
      </aside>

      <div className="crm-workspace">
        <header className="crm-topbar">
          <div className="crm-topbar-left">
            <button
              className="crm-mobile-menu"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div className="crm-breadcrumb">
              <small>Mars Pharmacy</small>
              <strong>{activeLabel}</strong>
            </div>
            <EntitySwitcher context={entityContext} />
          </div>

          <div className="crm-topbar-actions">
            <div className="crm-date-block">
              <small suppressHydrationWarning>{currentDate}</small>
              <strong>
                <i /> {entityContext.activeEntity?.currency ?? "TZS"} ·{" "}
                {entityContext.activeEntityId ? "Entity view" : "Consolidated view"}
              </strong>
            </div>

            <div className="crm-popover-wrap">
              <button
                className="crm-icon-button"
                type="button"
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                onClick={() => {
                  setNotificationsOpen((value) => !value);
                  setProfileOpen(false);
                }}
              >
                <span aria-hidden="true">!</span>
                <i>{unreadCount}</i>
              </button>
              {notificationsOpen && (
                <div className="crm-popover crm-notification-popover">
                  <div className="crm-popover-head">
                    <strong>Notifications</strong>
                    <Link href="/dashboard/notifications" onClick={() => setNotificationsOpen(false)}>
                      View all
                    </Link>
                  </div>
                  {notifications.slice(0, 3).map((item) => (
                    <button key={item.id} onClick={() => setNotificationsOpen(false)}>
                      <i />
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.message}</span>
                      </div>
                    </button>
                  ))}
                  {notifications.length === 0 && <p style={{ padding: "12px 16px" }}>No notifications.</p>}
                </div>
              )}
            </div>

            <div className="crm-popover-wrap">
              <button
                className="crm-user-button"
                type="button"
                aria-expanded={profileOpen}
                onClick={() => {
                  setProfileOpen((value) => !value);
                  setNotificationsOpen(false);
                }}
              >
                <span>{initials}</span>
                <div>
                  <strong>{employee.full_name}</strong>
                  <small>{roleLabel}</small>
                </div>
                <i>⌄</i>
              </button>
              {profileOpen && (
                <div className="crm-popover crm-profile-popover">
                  <div>
                    <span>{initials}</span>
                    <p>
                      <strong>{employee.full_name}</strong>
                      <small>{employee.email}</small>
                    </p>
                  </div>
                  <Link href="/dashboard/profile" onClick={() => setProfileOpen(false)}>
                    Profile <span>→</span>
                  </Link>
                  <form action={signOutAction}>
                    <button type="submit">
                      Logout <span>→</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="crm-content">
          <ViewContent data={data} />
        </main>
      </div>
    </div>
  );
}
