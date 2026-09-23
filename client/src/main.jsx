import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = async (path, options = {}) => {
  const token = sessionStorage.getItem("sidra_access");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api${path}`, { credentials: "include", ...options, headers });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error || "Something went wrong");
  return body;
};

function Brand() {
  return <div className="brand"><span className="brand-mark">S</span><span>Sidra Academy</span></div>;
}

function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError(""); setMessage("");
    try {
      if (mode === "request") {
        const result = await api("/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });
        setMessage("If the account exists, reset instructions are ready. In this local build, use the reset token shown below.");
        setResetToken(result.resetToken || "");
      } else if (mode === "confirm") {
        await api("/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token: resetToken, newPassword: password }) });
        setMessage("Password updated. You can now sign in.");
        setMode("login");
      } else {
        const result = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        sessionStorage.setItem("sidra_access", result.accessToken);
        onLogin(result.user);
      }
    } catch (err) { setError(err.message); }
  };
  return (
    <main className="auth-layout">
      <section className="auth-intro">
        <Brand />
        <div className="intro-copy">
          <p className="eyebrow">Qur’an & Arabic learning</p>
          <h1>Learning with care, one lesson at a time.</h1>
          <p>A calm place for the Sidra Academy team, teachers, and students to begin each session with clarity.</p>
        </div>
        <p className="muted">Managed academy access · Secure sign in</p>
      </section>
      <section className="auth-card-wrap">
        <form className="card auth-card" onSubmit={submit}>
          <p className="eyebrow">{mode === "login" ? "Welcome back" : "Account recovery"}</p>
          <h2>{mode === "login" ? "Sign in to Sidra" : mode === "request" ? "Reset your password" : "Choose a new password"}</h2>
          {mode !== "confirm" && <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>}
          {mode === "confirm" && <label>Reset token<input required value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="Paste your reset token" /></label>}
          {mode !== "request" && <label>{mode === "confirm" ? "New password" : "Password"}<input type="password" required minLength="10" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" /></label>}
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button className="button primary" type="submit">{mode === "login" ? "Sign in" : mode === "request" ? "Send reset instructions" : "Update password"}</button>
          {mode === "login" ? <button className="link-button" type="button" onClick={() => setMode("request")}>Forgot password?</button> : <button className="link-button" type="button" onClick={() => setMode("login")}>Back to sign in</button>}
          {mode === "request" && <button className="link-button" type="button" onClick={() => setMode("confirm")}>I already have a reset token</button>}
        </form>
      </section>
    </main>
  );
}

function ResetRequired({ user, onComplete, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try {
      const result = await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      onComplete(result.user);
    } catch (err) { setError(err.message); }
  };
  return <main className="center-layout"><form className="card reset-card" onSubmit={submit}>
    <Brand /><p className="eyebrow">One-time setup</p><h2>Choose your personal password</h2>
    <p className="muted">Welcome, {user.name}. Your temporary password must be replaced before you continue.</p>
    <label>Temporary password<input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
    <label>New password<input type="password" required minLength="10" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
    {error && <p className="error">{error}</p>}<button className="button primary">Save password</button>
    <button className="link-button" type="button" onClick={onLogout}>Sign out</button>
  </form></main>;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function AvailabilityPanel() {
  const [timezone, setTimezone] = useState("UTC");
  const [days, setDays] = useState(WEEKDAYS.map((name, dayOfWeek) => ({ name, dayOfWeek, enabled: false, startTimeLocal: "09:00", endTimeLocal: "12:00" })));
  const [blocks, setBlocks] = useState([]);
  const [blockForm, setBlockForm] = useState({ blockedDateFrom: "", blockedDateTo: "", reason: "" });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/teacher/availability").then((result) => {
      setTimezone(result.timezone);
      setBlocks(result.blocks || []);
      setDays((current) => current.map((day) => {
        const saved = (result.windows || []).find((window) => Number(window.day_of_week) === day.dayOfWeek);
        return saved ? { ...day, enabled: true, startTimeLocal: saved.start_time_local, endTimeLocal: saved.end_time_local } : day;
      }));
    }).catch((err) => setError(err.message));
  }, []);

  const updateDay = (dayOfWeek, changes) => setDays((current) => current.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, ...changes } : day));
  const saveAvailability = async (event) => {
    event.preventDefault(); setSaving(true); setError(""); setStatus("");
    try {
      const result = await api("/teacher/availability", {
        method: "PUT",
        body: JSON.stringify({ windows: days.filter((day) => day.enabled).map(({ dayOfWeek, startTimeLocal, endTimeLocal }) => ({ dayOfWeek, startTimeLocal, endTimeLocal })) }),
      });
      setTimezone(result.timezone); setStatus("Weekly availability saved in local time.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const addBlock = async (event) => {
    event.preventDefault(); setError(""); setStatus("");
    try {
      const result = await api("/teacher/availability/blocks", { method: "POST", body: JSON.stringify(blockForm) });
      setBlocks((current) => [...current, result.block].sort((a, b) => a.blocked_date_from.localeCompare(b.blocked_date_from)));
      setBlockForm({ blockedDateFrom: "", blockedDateTo: "", reason: "" }); setStatus("Date block added.");
    } catch (err) { setError(err.message); }
  };
  const removeBlock = async (id) => {
    try { await api(`/teacher/availability/blocks/${id}`, { method: "DELETE" }); setBlocks((current) => current.filter((block) => block.id !== id)); }
    catch (err) { setError(err.message); }
  };

  return <section className="card availability-panel">
    <div className="section-heading"><div><p className="eyebrow">Teacher availability</p><h2>When students can book you</h2></div><span className="timezone-pill">{timezone}</span></div>
    <p className="muted availability-note">These recurring windows stay in your local timezone. The system will resolve the correct UTC instant later for each scheduled date.</p>
    <form onSubmit={saveAvailability} className="availability-form">
      <div className="weekly-grid">{days.map((day) => <div className="day-row" key={day.dayOfWeek}>
        <label className="day-toggle"><input type="checkbox" checked={day.enabled} onChange={(e) => updateDay(day.dayOfWeek, { enabled: e.target.checked })} /><span>{day.name}</span></label>
        <input aria-label={`${day.name} start time`} type="time" value={day.startTimeLocal} disabled={!day.enabled} onChange={(e) => updateDay(day.dayOfWeek, { startTimeLocal: e.target.value })} />
        <span className="time-separator">to</span>
        <input aria-label={`${day.name} end time`} type="time" value={day.endTimeLocal} disabled={!day.enabled} onChange={(e) => updateDay(day.dayOfWeek, { endTimeLocal: e.target.value })} />
      </div>)}</div>
      {error && <p className="error">{error}</p>}{status && <p className="success">{status}</p>}
      <button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save weekly availability"}</button>
    </form>
    <div className="blocks-section"><div><p className="eyebrow">Date blocks</p><h3>Time away or unavailable</h3></div>
      <form className="block-form" onSubmit={addBlock}>
        <label>From<input type="date" required value={blockForm.blockedDateFrom} onChange={(e) => setBlockForm({ ...blockForm, blockedDateFrom: e.target.value })} /></label>
        <label>To<input type="date" required value={blockForm.blockedDateTo} onChange={(e) => setBlockForm({ ...blockForm, blockedDateTo: e.target.value })} /></label>
        <label>Reason<input value={blockForm.reason} maxLength="255" placeholder="Optional" onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} /></label>
        <button className="button secondary">Block dates</button>
      </form>
      {blocks.length > 0 && <div className="block-list">{blocks.map((block) => <div className="block-item" key={block.id}><span><strong>{block.blocked_date_from}</strong> → <strong>{block.blocked_date_to}</strong>{block.reason && ` · ${block.reason}`}</span><button className="link-button" type="button" onClick={() => removeBlock(block.id)}>Remove</button></div>)}</div>}
      {blocks.length === 0 && <p className="muted">No blocked dates yet.</p>}
    </div>
  </section>;
}

function Dashboard({ user, onLogout }) {
  const [invite, setInvite] = useState({ role: "student", name: "", email: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", level: "beginner" });
  const [inviteResult, setInviteResult] = useState(null);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [openInvite, setOpenInvite] = useState(false);
  useEffect(() => {
    api(`/${user.role}/dashboard`)
      .then(setDashboard)
      .catch((err) => {
        setError(err.message);
        if (err.message.includes("Authentication")) onLogout();
      });
  }, [user.role]);
  const title = user.role === "admin" ? "Academy overview" : user.role === "teacher" ? "Your teaching space" : "Your learning space";
  const subtitle = dashboard?.message || (user.role === "admin" ? "Manage the academy from one calm, focused place." : user.role === "teacher" ? "Your schedule, attendance, and teaching tools will live here." : "Your classes, materials, and package details will live here.");
  const submitInvite = async (event) => {
    event.preventDefault(); setError(""); setInviteResult(null);
    try { setInviteResult((await api("/admin/invites", { method: "POST", body: JSON.stringify(invite) })).invite); }
    catch (err) { setError(err.message); }
  };
  return <main className="app-shell">
    <header className="topbar"><Brand /><div className="user-menu"><span>{user.name}</span><span className="role-pill">{user.role}</span><button className="link-button" onClick={onLogout}>Sign out</button></div></header>
    <section className="dashboard">
      <p className="eyebrow">{user.role} dashboard</p><h1>{title}</h1><p className="lead">{subtitle}</p>
      <div className="empty-panel"><div className="empty-icon">✦</div><h2>{dashboard?.empty ? "Nothing here yet" : "Loading your dashboard…"}</h2><p>This dashboard is ready for the next phase of Sidra Academy.</p></div>
      {user.role === "teacher" && <AvailabilityPanel />}
      {user.role === "admin" && <section className="card admin-tools">
        <div className="section-heading"><div><p className="eyebrow">Account access</p><h2>Invite a team member or student</h2></div><button className="button secondary" onClick={() => setOpenInvite(!openInvite)}>{openInvite ? "Close" : "Create invite"}</button></div>
        {openInvite && <form className="invite-form" onSubmit={submitInvite}>
          <label>Account type<select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="student">Student</option><option value="teacher">Teacher</option></select></label>
          <label>Full name<input required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></label>
          <label>Email<input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></label>
          <label>Timezone<select value={invite.timezone} onChange={(e) => setInvite({ ...invite, timezone: e.target.value })}><option>UTC</option><option>Africa/Cairo</option><option>Asia/Dubai</option><option>Europe/London</option><option>America/New_York</option></select></label>
          {invite.role === "student" && <label>Course level<select value={invite.level} onChange={(e) => setInvite({ ...invite, level: e.target.value })}><option>beginner</option><option>intermediate</option><option>advanced</option></select></label>}
          {error && <p className="error">{error}</p>}<button className="button primary">Create account invite</button>
        </form>}
        {inviteResult && <div className="invite-result"><strong>Invite created for {inviteResult.user.name}</strong><span>Temporary password: <code>{inviteResult.temporaryPassword}</code></span><span>Invite path: <code>{inviteResult.invitePath}</code></span><small>Share these through your configured email channel. The recipient must reset the temporary password on first login.</small></div>}
      </section>}
    </section>
  </main>;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const logout = async () => { try { await api("/auth/logout", { method: "POST" }); } catch {} sessionStorage.removeItem("sidra_access"); setUser(null); };
  useEffect(() => {
    if (!sessionStorage.getItem("sidra_access")) { setLoading(false); return; }
    api("/auth/me").then((result) => setUser(result.user)).catch(() => sessionStorage.removeItem("sidra_access")).finally(() => setLoading(false));
  }, []);
  if (loading) return <main className="center-layout"><div className="loading">Loading Sidra Academy…</div></main>;
  if (!user) return <Login onLogin={setUser} />;
  if (user.mustResetPassword) return <ResetRequired user={user} onComplete={setUser} onLogout={logout} />;
  return <Dashboard user={user} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<App />);