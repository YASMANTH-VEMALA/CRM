"use client";

import { useActionState, useState } from "react";
import { saveSettings } from "../actions/settings";
import type { SettingsData } from "@/lib/data/settings";
import { PageHead, SectionHead } from "./shared";

const SECTIONS = [
  "Pharmacy profile",
  "Branch settings",
  "Currency",
  "Tax configuration",
  "Invoice settings",
  "Receipt settings",
  "Payment methods",
  "Loyalty settings",
  "Inventory settings",
  "Expiry-alert periods",
  "Approval rules",
  "User roles",
  "Notification preferences",
  "Backup settings",
  "Security settings",
];

const TOGGLES: Array<{ key: keyof SettingsData["toggles"]; label: string; note: string }> = [
  { key: "prevent_expired_sales", label: "Prevent expired-product sales", note: "Blocks checkout when only an expired batch is available." },
  { key: "use_fefo", label: "Use FEFO batch allocation", note: "Recommends the earliest-expiry valid batch first." },
  { key: "require_reversal_approval", label: "Require approval for reversals", note: "Sale reversals must be reviewed before taking effect." },
  { key: "send_low_stock_alerts", label: "Send low-stock alerts", note: "Notifies when available stock reaches the reorder level." },
  { key: "detailed_audit_history", label: "Record detailed audit history", note: "Logs granular employee actions across every module." },
  { key: "auto_backup_schedule", label: "Run automatic backup schedule", note: "Schedules routine backups of pharmacy data." },
];

export function SettingsView({ data }: { data: SettingsData }) {
  const [active, setActive] = useState(SECTIONS[0]);
  const [state, formAction, pending] = useActionState(saveSettings, null);
  const isProfileSection = active === "Pharmacy profile";

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Administration / Configuration"
        title="Settings"
        description="Organisation-wide settings. These apply across every entity and can only be changed by a master administrator."
      />
      <div className="crm-settings-layout">
        <nav className="crm-settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item, index) => (
            <button
              className={active === item ? "is-active" : ""}
              onClick={() => setActive(item)}
              key={item}
              type="button"
            >
              <i>{String(index + 1).padStart(2, "0")}</i>
              <span>{item}</span>
            </button>
          ))}
        </nav>

        <section className="crm-panel crm-settings-form crm-enter crm-enter-2">
          <SectionHead
            title={active}
            note={isProfileSection ? "Saved to the shared pharmacy profile settings." : "Not yet configurable here."}
          />

          {isProfileSection ? (
            <form action={formAction}>
              <div className="crm-form-grid">
                <label>
                  <span>Pharmacy name</span>
                  <input name="name" defaultValue={data.pharmacyProfile.name} required />
                </label>
                <label>
                  <span>Business email</span>
                  <input name="email" type="email" defaultValue={data.pharmacyProfile.email} />
                </label>
                <label>
                  <span>Phone</span>
                  <input name="phone" defaultValue={data.pharmacyProfile.phone} />
                </label>
                <label className="is-wide">
                  <span>Address</span>
                  <input name="address" defaultValue={data.pharmacyProfile.address} />
                </label>
                <label>
                  <span>Currency</span>
                  <select name="currency" defaultValue={data.pharmacyProfile.currency}>
                    <option value="TZS">TZS — Tanzanian Shilling</option>
                    <option value="USD">USD — US Dollar</option>
                  </select>
                </label>
                <label>
                  <span>Tax mode</span>
                  <select name="tax_mode" defaultValue={data.pharmacyProfile.tax_mode}>
                    <option value="Inclusive">Inclusive</option>
                    <option value="Exclusive">Exclusive</option>
                  </select>
                </label>
              </div>

              <div className="crm-setting-toggles">
                {TOGGLES.map((toggle) => (
                  <label key={toggle.key}>
                    <div>
                      <strong>{toggle.label}</strong>
                      <span>{toggle.note}</span>
                    </div>
                    <input type="checkbox" name={toggle.key} defaultChecked={data.toggles[toggle.key]} />
                  </label>
                ))}
              </div>

              {state && !state.ok && <p className="login-error" role="alert">{state.error}</p>}
              {state?.ok && (
                <p role="status" style={{ margin: "0 1rem", color: "#2f7d32", fontSize: "0.55rem" }}>
                  Settings saved.
                </p>
              )}

              <div className="crm-form-actions">
                <button className="crm-button crm-button-secondary" type="reset">
                  Reset
                </button>
                <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ padding: "0 1rem 1.2rem", color: "#777", fontSize: "0.58rem", lineHeight: 1.6 }}>
              <p>
                This section is part of the original interface design but isn&apos;t backed by a real settings
                column yet, so nothing entered here would actually be saved.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
