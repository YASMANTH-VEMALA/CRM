"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn } from "./actions";
import "./login.css";

// The demo credentials card used to hardcode a working master-admin password
// and print it on the page, which made every visitor a master admin. It is now
// opt-in and empty unless both variables are set — never set these in
// production.
const DEMO_USERNAME = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "";
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";
const SHOW_DEMO_CREDENTIALS = Boolean(DEMO_USERNAME && DEMO_PASSWORD);

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, undefined);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [helpVisible, setHelpVisible] = useState(false);
  // Read lazily rather than with useSearchParams, which would opt this page out
  // of static prerendering for the sake of one query flag. The initialiser runs
  // once on the client; on the server it is simply false.
  const [wasDisabled] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("disabled") === "1"
  );

  function useDemoCredentials() {
    setUsername(DEMO_USERNAME);
    setPassword(DEMO_PASSWORD);
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Mars Pharmacy CRM introduction">
        <Link className="login-brand" href="/" aria-label="Mars Pharmacy CRM home">
          <span>M</span>
          <div><strong>Mars Pharmacy CRM</strong><small>Pharmacy operations, connected</small></div>
        </Link>

        <div className="login-story-copy">
          <p className="login-label">Store 3 workspace</p>
          <h1>One clear view of your pharmacy.</h1>
          <p>
            Sales, stock, medicine expiry, suppliers, customers, expenses, and
            business performance—ready for your entire team.
          </p>
        </div>

        <div className="login-preview" aria-hidden="true">
          <div className="login-preview-head"><span>Today / Overview</span><span>Live</span></div>
          <div className="login-preview-grid">
            <div><small>Net sales</small><strong>TZS 2.68M</strong><i>↑ 8.4%</i></div>
            <div><small>Available stock</small><strong>17,219</strong><i>units</i></div>
            <div><small>Expiry alerts</small><strong>23</strong><i>within 90 days</i></div>
          </div>
        </div>

        <p className="login-story-foot">Mars Pharmacy Store 3</p>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-heading">
            <p>Welcome back</p>
            <h2>Sign in to manage your pharmacy</h2>
            <span>Enter the credentials issued by your administrator.</span>
          </div>

          {wasDisabled && (
            <p className="login-error" role="alert">
              This account has been disabled and its session was ended. Contact your
              administrator.
            </p>
          )}

          {SHOW_DEMO_CREDENTIALS && (
            <button className="credentials-card" type="button" onClick={useDemoCredentials}>
              <span>Demo credentials</span>
              <div><small>Username</small><strong>{DEMO_USERNAME}</strong></div>
              <div><small>Password</small><strong>{DEMO_PASSWORD}</strong></div>
              <em>Click to fill</em>
            </button>
          )}

          <form className="login-form" action={formAction}>
            <label>
              <span>Username or email</span>
              <input
                name="email"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin@marspharmacy.com"
                required
              />
            </label>

            <label>
              <span>Password</span>
              <div className="password-field">
                <input
                  name="password"
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <div className="login-options">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Remember me</span>
              </label>
              <button type="button" onClick={() => setHelpVisible((value) => !value)}>
                Forgot password?
              </button>
            </div>

            {helpVisible && (
              <p className="login-help" role="status">
                This demo does not send reset emails. Use the credentials shown above.
              </p>
            )}
            {state?.error && <p className="login-error" role="alert">{state.error}</p>}

            <button className="sign-in-button" type="submit" disabled={pending}>
              <span>{pending ? "Opening workspace…" : "Sign in"}</span>
              <i aria-hidden="true">→</i>
            </button>
          </form>

          <div className="login-links">
            <Link href="/">← Back to website</Link>
            <a href="mailto:hello@marspharmacycrm.com">Contact support</a>
          </div>
        </div>
        <p className="login-legal">Mars Pharmacy CRM · Store 3 workspace</p>
      </section>
    </main>
  );
}
