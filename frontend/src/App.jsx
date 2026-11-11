import { useEffect, useState } from "react";
import Auth from "./Auth";
import Dashboard from "./Dashboard";
import "./styles/booting.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);
  async function signOut() {
    try {
      const r = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not sign out. Please try again.");
      setUser(null);
    } catch (err) { window.alert(err.message); }
  }
  /* Shown for the length of the session check. It matches the two screens it
     sits between, so the app does not flash a light panel before deciding
     whether to show sign-in or the workspace. */
  if (checking) return (
    <div className="tp-booting" role="status" aria-live="polite">
      <span className="tp-booting-mark" aria-hidden="true" />
      <span>Opening Tracepoint…</span>
    </div>
  );
  if (!user) return <Auth onAuthenticated={setUser} />;
  return <Dashboard user={user} onSignOut={signOut} />;
}
