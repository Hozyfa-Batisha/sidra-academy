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

function dateForZone(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function timeForZone(instant, timezone) {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(instant);
}

function localTimeToUtc(date, time, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const observed = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
    timestamp += desired - observed;
  }
  const result = new Date(timestamp);
  if (dateForZone(result, timezone) !== date || timeForZone(result, timezone).includes("Invalid")) return null;
  const localParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(result);
  const values = Object.fromEntries(localParts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return values.hour === time.slice(0, 2) && values.minute === time.slice(3, 5) ? result : null;
}

function recurringStartInstants(startDate, startTime, weekdays, timezone) {
  if (!startDate || !startTime || !weekdays.length) return [];
  const first = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(first.getTime() + 56 * 24 * 60 * 60 * 1000);
  const results = [];
  for (let date = new Date(first); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (!weekdays.includes(date.getUTCDay())) continue;
    const value = localTimeToUtc(date.toISOString().slice(0, 10), startTime, timezone);
    if (value) results.push(value);
  }
  return results;
}

function localMonthDate(year, month, day = 1) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ScheduleCalendar({ user }) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const timezone = user.role === "admin" ? "UTC" : user.profile?.timezone || "UTC";
  const monthStart = localMonthDate(month.getFullYear(), month.getMonth());
  const monthEnd = localMonthDate(month.getFullYear(), month.getMonth(), new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate());
  const path = user.role === "admin" ? "/admin/schedule" : `/${user.role}/schedule`;

  useEffect(() => {
    api(`${path}?from=${monthStart}&to=${monthEnd}`)
      .then((result) => { setSlots(result.slots || []); setError(""); })
      .catch((err) => setError(err.message));
  }, [path, monthStart, monthEnd, reload]);
  useEffect(() => {
    const reloadSchedule = () => setReload((value) => value + 1);
    window.addEventListener("sidra-schedule-updated", reloadSchedule);
    return () => window.removeEventListener("sidra-schedule-updated", reloadSchedule);
  }, []);

  const groups = new Map();
  for (const slot of slots) {
    const localDate = dateForZone(new Date(slot.dateTimeUtc), timezone);
    if (!groups.has(localDate)) groups.set(localDate, []);
    groups.get(localDate).push(slot);
  }

  const markAttendance = async (slotId, attendanceRecord) => {
    try {
      await api(`/teacher/slots/${slotId}/attendance`, { method: "POST", body: JSON.stringify({ attendanceRecord }) });
      setReload((value) => value + 1);
    } catch (err) { setError(err.message); }
  };
  const [override, setOverride] = useState({});
  const overrideAttendance = async (slotId) => {
    const value = override[slotId] || {};
    if (!value.reason?.trim()) { setError("Add a reason before overriding attendance."); return; }
    try {
      await api(`/admin/slots/${slotId}/attendance-override`, {
        method: "PUT",
        body: JSON.stringify({ attendanceRecord: value.record || "excused", reason: value.reason }),
      });
      setOverride((current) => ({ ...current, [slotId]: { record: "excused", reason: "" } }));
      setError(""); setReload((current) => current + 1);
    } catch (err) { setError(err.message); }
  };

  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);
  return <section className="card schedule-calendar">
    <div className="section-heading">
      <div><p className="eyebrow">Schedule</p><h2>{month.toLocaleString(undefined, { month: "long", year: "numeric" })}</h2></div>
      <div className="calendar-nav"><button className="button secondary" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button className="button secondary" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
    </div>
    {error && <p className="error calendar-error">{error}</p>}
    <div className="calendar-grid">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
      {cells.map((day, index) => {
        const date = day ? localMonthDate(month.getFullYear(), month.getMonth(), day) : `empty-${index}`;
        return <div className={`calendar-day ${day ? "" : "calendar-day-empty"}`} key={date}>
          {day && <><span className="calendar-date">{day}</span>{(groups.get(date) || []).map((slot) => {
            const instant = new Date(slot.dateTimeUtc);
            const canMark = user.role === "teacher" && slot.status === "upcoming" && instant <= new Date() && new Date() <= new Date(instant.getTime() + 24 * 60 * 60 * 1000);
            return <article className={`slot-card slot-${slot.status}`} key={slot.id}>
              <strong>{timeForZone(instant, timezone)}</strong>
              <span>{slot.courseTitle}</span>
              {user.role === "admin" ? <small>{slot.teacherName} ↔ {slot.studentName}<br />{timeForZone(instant, slot.teacherTimezone)} · {timeForZone(instant, slot.studentTimezone)}</small> :
                <small>{user.role === "teacher" ? slot.studentName : slot.teacherName}</small>}
              <small className="slot-status">{slot.status.replaceAll("_", " ")}</small>
              {canMark && <div className="attendance-actions"><button onClick={() => markAttendance(slot.id, "present")}>Present</button><button onClick={() => markAttendance(slot.id, "no_show")}>No-show</button></div>}
              {user.role === "admin" && !["upcoming", "cancelled"].includes(slot.status) && <div className="override-controls">
                <select value={override[slot.id]?.record || "excused"} onChange={(event) => setOverride((current) => ({ ...current, [slot.id]: { ...current[slot.id], record: event.target.value } }))}>
                  <option value="excused">Excused</option><option value="present">Present</option><option value="no_show">Unexcused no-show</option>
                </select>
                <input aria-label="Override reason" placeholder="Reason required" value={override[slot.id]?.reason || ""} onChange={(event) => setOverride((current) => ({ ...current, [slot.id]: { ...current[slot.id], reason: event.target.value } }))} />
                <button onClick={() => overrideAttendance(slot.id)}>Apply</button>
              </div>}
            </article>;
          })}</>}
        </div>;
      })}
    </div>
    {slots.length === 0 && <p className="muted no-slots">No classes scheduled in this month.</p>}
  </section>;
}

function AdminSchedulePanel() {
  const [options, setOptions] = useState({ teachers: [], students: [], courses: [] });
  const [form, setForm] = useState({ teacherId: "", studentId: "", courseId: "", startDate: "", startTime: "09:00", durationMinutes: 60 });
  const [daysOfWeek, setDaysOfWeek] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingSlots, setExistingSlots] = useState([]);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  useEffect(() => { api("/admin/scheduling/options").then((result) => {
    setOptions(result);
    setForm((current) => ({ ...current, teacherId: result.teachers[0]?.id || "", studentId: result.students[0]?.id || "", courseId: result.courses[0]?.id || "" }));
  }).catch((err) => setError(err.message)); }, []);
  useEffect(() => {
    if (!form.startDate) return;
    const start = new Date(`${form.startDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(`${form.startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 57);
    api(`/admin/schedule?from=${start.toISOString().slice(0, 10)}&to=${end.toISOString().slice(0, 10)}`)
      .then((result) => setExistingSlots(result.slots || []))
      .catch(() => setExistingSlots([]));
  }, [form.startDate, scheduleRefresh]);
  useEffect(() => {
    const refresh = () => setScheduleRefresh((value) => value + 1);
    window.addEventListener("sidra-schedule-updated", refresh);
    return () => window.removeEventListener("sidra-schedule-updated", refresh);
  }, []);

  const teacher = options.teachers.find((item) => item.id === form.teacherId);
  const student = options.students.find((item) => item.id === form.studentId);
  const dateWeekday = form.startDate ? new Date(`${form.startDate}T00:00:00Z`).getUTCDay() : null;
  const matchingWindows = (teacher?.availability || []).filter((window) => daysOfWeek.includes(Number(window.day_of_week)));
  const windowAvailable = daysOfWeek.length > 0 && daysOfWeek.every((day) => {
    const start = form.startTime.split(":").reduce((hours, part) => hours * 60 + Number(part), 0);
    const end = start + Number(form.durationMinutes);
    return (teacher?.availability || []).some((window) => {
      if (Number(window.day_of_week) !== day) return false;
      const windowStart = window.start_time_local.split(":").reduce((hours, part) => hours * 60 + Number(part), 0);
      const windowEnd = window.end_time_local.split(":").reduce((hours, part) => hours * 60 + Number(part), 0);
      return start >= windowStart && end <= windowEnd;
    });
  });
  const instant = form.startDate && teacher ? localTimeToUtc(form.startDate, form.startTime, teacher.timezone) : null;
  const blockedStart = (teacher?.blocks || []).some((block) => block.blocked_date_from <= form.startDate && form.startDate <= block.blocked_date_to);
  const recurringInstants = teacher ? recurringStartInstants(form.startDate, form.startTime, daysOfWeek, teacher.timezone) : [];
  const collision = recurringInstants.some((candidate) => existingSlots.some((slot) =>
    slot.teacherId === teacher?.id && new Date(slot.dateTimeUtc).getTime() === candidate.getTime()));

  const handleDate = (startDate) => {
    setForm((current) => ({ ...current, startDate }));
    if (startDate) setDaysOfWeek([new Date(`${startDate}T00:00:00Z`).getUTCDay()]);
  };
  const handleSubmit = async (event) => {
    event.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    try {
      const result = await api("/admin/classes", {
        method: "POST",
        body: JSON.stringify({ ...form, daysOfWeek }),
      });
      setSuccess(`Class created. ${result.generatedSlots} occurrences are on the calendar for the next 8 weeks.`);
      window.dispatchEvent(new Event("sidra-schedule-updated"));
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return <section className="card admin-tools schedule-builder">
    <div className="section-heading"><div><p className="eyebrow">Admin scheduling</p><h2>Create a recurring 1:1 class</h2></div></div>
    <p className="muted availability-note">Only declared teacher availability is bookable. Times below are entered in the teacher’s timezone.</p>
    {!options.teachers.length || !options.students.length ? <div className="notice">Create active teacher and student accounts from the Admin invite panel first, then set teacher availability.</div> :
      <form className="schedule-form" onSubmit={handleSubmit}>
        <label>Teacher<select required value={form.teacherId} onChange={(event) => {
          const selected = options.teachers.find((item) => item.id === event.target.value);
          setForm((current) => ({ ...current, teacherId: event.target.value, startTime: selected?.availability?.[0]?.start_time_local || current.startTime }));
        }}>{options.teachers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.timezone}</option>)}</select></label>
        <label>Student<select required value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}>{options.students.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.timezone}</option>)}</select></label>
        <label>Course<select required value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}>{options.courses.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>First class date<input type="date" required value={form.startDate} onChange={(event) => handleDate(event.target.value)} /></label>
        <label>Teacher local start time<input type="time" required value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></label>
        <label>Duration<select value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
        <fieldset className="weekday-picker"><legend>Repeat on</legend>{WEEKDAYS.map((day, dayOfWeek) => <label key={day}><input type="checkbox" checked={daysOfWeek.includes(dayOfWeek)} onChange={(event) => setDaysOfWeek((current) => event.target.checked ? [...current, dayOfWeek].sort((a, b) => a - b) : current.filter((value) => value !== dayOfWeek))} />{day}</label>)}</fieldset>
        {form.startDate && teacher && <div className={`availability-feedback ${windowAvailable && !blockedStart && instant && !collision ? "feedback-good" : "feedback-warning"}`}>
          <strong>{collision ? "Conflict: teacher already has a class at this time" : windowAvailable && !blockedStart && instant ? "Availability looks good" : blockedStart ? "This date is blocked" : "Conflict: outside teacher availability"}</strong>
          <span>{form.startTime} {teacher.timezone}{instant ? ` · ${timeForZone(instant, student?.timezone || "UTC")} ${student?.timezone || "UTC"}` : ""}</span>
          {matchingWindows.length > 0 && <small>Matching availability: {matchingWindows.map((window) => `${WEEKDAYS[window.day_of_week]} ${window.start_time_local}–${window.end_time_local}`).join(", ")}</small>}
        </div>}
        {error && <p className="error">{error}</p>}{success && <p className="success">{success}</p>}
        <button className="button primary" disabled={saving}>{saving ? "Creating…" : "Create class & generate next 8 weeks"}</button>
      </form>}
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
      <ScheduleCalendar user={user} />
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
      {user.role === "admin" && <AdminSchedulePanel />}
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