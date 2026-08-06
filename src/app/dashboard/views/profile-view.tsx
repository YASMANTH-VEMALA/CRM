"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProfileData } from "@/lib/data/profile";
import { PageHead, SectionHead, Status, StringTable } from "./shared";

export function ProfileView({ data }: { data: ProfileData }) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const initials = data.employee.full_name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const roleLabel = data.employee.role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  function togglePasswordForm() {
    setError("");
    setSuccess(false);
    setShowPasswordForm((value) => !value);
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(false);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Account / User profile"
        title={data.employee.full_name}
        description="Your account information, role, entity access and recent sign-ins."
      >
        <button className="crm-button crm-button-primary" type="button" onClick={togglePasswordForm}>
          {showPasswordForm ? "Close" : "Change password"} <i>+</i>
        </button>
      </PageHead>
      <div className="crm-profile-layout">
        <section className="crm-panel crm-profile-card">
          <div className="crm-profile-avatar">{initials || "—"}</div>
          <h2>{data.employee.full_name}</h2>
          <p>{roleLabel}</p>
          <Status value={data.employee.status} />
          <div>
            <span>Username</span>
            <strong>{data.employee.username ?? "—"}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{data.employee.email ?? "—"}</strong>
          </div>
          <div>
            <span>Assigned branch</span>
            <strong>{data.employee.branchName}</strong>
          </div>
        </section>

        <div className="crm-profile-detail">
          {showPasswordForm && (
            <section className="crm-panel crm-enter">
              <SectionHead title="Change password" note="Updates your Supabase Auth password for this account." />
              <form className="crm-form-grid" onSubmit={handlePasswordSubmit}>
                <label>
                  <span>New password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  <span>Confirm new password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </label>
                {error && (
                  <p className="login-error" role="alert">
                    {error}
                  </p>
                )}
                {success && (
                  <p role="status" style={{ margin: "0 1rem", color: "#2f7d32", fontSize: "0.55rem" }}>
                    Password updated.
                  </p>
                )}
                <div className="crm-form-actions">
                  <button className="crm-button crm-button-secondary" type="button" onClick={() => setShowPasswordForm(false)}>
                    Cancel
                  </button>
                  <button className="crm-button crm-button-primary" type="submit" disabled={pending}>
                    {pending ? "Updating…" : "Update password"}
                  </button>
                </div>
              </form>
            </section>
          )}

          <section className="crm-panel">
            <SectionHead title="Login history" note="Your most recent sign-ins to this account." />
            <StringTable
              columns={["Date & time", "Device", "Location", "Session", "Status"]}
              rows={data.loginHistory}
              emptyMessage="No sign-ins recorded yet."
            />
          </section>

          <section className="crm-panel">
            <SectionHead title="Active sessions" note="Your current signed-in session." />
            <div className="crm-session-row">
              <i />
              <div>
                <strong>{data.employee.branchName}</strong>
                <span>Current session</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
