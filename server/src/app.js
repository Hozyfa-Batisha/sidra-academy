const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const {
  bcrypt,
  hashToken,
  randomToken,
  randomTemporaryPassword,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} = require("./security");
const { authRequired, requireRole } = require("./authMiddleware");
const config = require("./config");
const { DateTime } = require("luxon");
const {
  buildWeeklyRule,
  expandSchedule,
  parseLocalDateTime,
  toUtcInstant,
  withinAvailability,
  dateBlocked,
  WEEKDAY_CODES,
} = require("./scheduling");

const validRoles = new Set(["admin", "teacher", "student"]);
const validLevels = new Set(["beginner", "intermediate", "advanced"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function publicUser(user, profile = null) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    status: user.status,
    mustResetPassword: Boolean(user.must_reset_password),
    profile,
  };
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 10;
}

function normalizeAvailabilityWindows(windows) {
  if (!Array.isArray(windows)) throw new Error("Availability windows must be an array");
  return windows.map((window) => {
    const dayOfWeek = Number(window.dayOfWeek);
    const startTimeLocal = window.startTimeLocal;
    const endTimeLocal = window.endTimeLocal;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new Error("dayOfWeek must be an integer from 0 (Sunday) to 6 (Saturday)");
    }
    if (!timePattern.test(startTimeLocal) || !timePattern.test(endTimeLocal) || startTimeLocal >= endTimeLocal) {
      throw new Error("Availability times must be valid local HH:MM values with start before end");
    }
    return { dayOfWeek, startTimeLocal, endTimeLocal };
  });
}

function validateDateRange(blockedDateFrom, blockedDateTo) {
  if (!datePattern.test(blockedDateFrom) || !datePattern.test(blockedDateTo) || blockedDateFrom > blockedDateTo) {
    throw new Error("Blocked dates must be valid YYYY-MM-DD values with the start on or before the end");
  }
}

function calendarBounds({ from, to, timezone }) {
  const start = from || DateTime.now().setZone(timezone).minus({ days: 30 }).toFormat("yyyy-MM-dd");
  const end = to || DateTime.now().setZone(timezone).plus({ days: 90 }).toFormat("yyyy-MM-dd");
  const startDate = DateTime.fromISO(start, { zone: timezone });
  const endDate = DateTime.fromISO(end, { zone: timezone });
  if (!startDate.isValid || !endDate.isValid || startDate.toFormat("yyyy-MM-dd") !== start || endDate.toFormat("yyyy-MM-dd") !== end || start > end) {
    throw new Error("Schedule dates must be valid YYYY-MM-DD values with start on or before end");
  }
  return {
    fromUtc: startDate.startOf("day").toUTC().toJSDate(),
    toUtc: endDate.endOf("day").toUTC().toJSDate(),
  };
}

function requestError(res, error) {
  if (error.code === "DUPLICATE_SLOT") return res.status(409).json({ error: "This teacher is already booked at one or more of those times" });
  if (error.code === "FORBIDDEN") return res.status(403).json({ error: error.message });
  if (error.code === "MARK_WINDOW_CLOSED") return res.status(409).json({ error: error.message });
  return res.status(400).json({ error: error.message || "Invalid request" });
}

function setRefreshCookie(res, user) {
  res.cookie("sidra_refresh", issueRefreshToken(user), {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function createApp({ store, seed = true, clock = () => new Date() } = {}) {
  if (!store) throw new Error("createApp requires a store");
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, service: "sidra-api" }));

  app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const user = await store.findUserByEmail(email);
    if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const profile = await store.getProfile(user);
    setRefreshCookie(res, user);
    return res.json({ accessToken: issueAccessToken(user), user: publicUser(user, profile) });
  });

  app.post("/auth/refresh", async (req, res) => {
    try {
      const payload = verifyRefreshToken(req.cookies.sidra_refresh);
      const user = await store.findUserById(payload.sub);
      if (!user || user.status !== "active") throw new Error("Account unavailable");
      return res.json({ accessToken: issueAccessToken(user), user: publicUser(user, await store.getProfile(user)) });
    } catch {
      return res.status(401).json({ error: "Refresh session is invalid or expired" });
    }
  });

  app.post("/auth/logout", (_req, res) => {
    res.clearCookie("sidra_refresh", { httpOnly: true, sameSite: "lax", path: "/" });
    res.status(204).end();
  });

  app.post("/auth/reset-password", authRequired(store), async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!validatePassword(newPassword)) return res.status(400).json({ error: "New password must be at least 10 characters" });
    if (!currentPassword || !(await bcrypt.compare(currentPassword, req.user.password_hash))) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    const user = await store.updateUser(req.user.id, {
      password_hash: await bcrypt.hash(newPassword, 12),
      must_reset_password: false,
    });
    return res.json({ user: publicUser(user, await store.getProfile(user)) });
  });

  app.post("/auth/password-reset/request", async (req, res) => {
    const user = req.body?.email ? await store.findUserByEmail(req.body.email) : null;
    const response = { message: "If an account exists, reset instructions have been issued." };
    if (!user) return res.json(response);
    const token = randomToken();
    await store.saveResetToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!config.isProduction) response.resetToken = token;
    return res.json(response);
  });

  app.post("/auth/password-reset/confirm", async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !validatePassword(newPassword)) {
      return res.status(400).json({ error: "A reset token and a new password of at least 10 characters are required" });
    }
    const reset = await store.consumeResetToken(hashToken(token));
    if (!reset) return res.status(400).json({ error: "Reset token is invalid or expired" });
    const user = await store.updateUser(reset.user_id, {
      password_hash: await bcrypt.hash(newPassword, 12),
      must_reset_password: false,
    });
    return res.json({ user: publicUser(user, await store.getProfile(user)) });
  });

  const auth = authRequired(store);
  app.get("/auth/me", auth, async (req, res) => {
    res.json({ user: publicUser(req.user, await store.getProfile(req.user)) });
  });

  app.post("/admin/invites", auth, requireRole("admin"), async (req, res) => {
    const { role, name, email, timezone = "UTC", level = "beginner" } = req.body || {};
    if (!validRoles.has(role) || role === "admin") return res.status(400).json({ error: "Invites can create teacher or student accounts only" });
    if (!name || !email || typeof timezone !== "string") return res.status(400).json({ error: "Name, email, and timezone are required" });
    if (role === "student" && !validLevels.has(level)) return res.status(400).json({ error: "Student level is invalid" });
    const temporaryPassword = randomTemporaryPassword();
    try {
      const user = await store.createUser({
        role,
        name,
        email,
        timezone,
        level,
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        mustResetPassword: true,
      });
      const inviteToken = randomToken();
      await store.saveInvite({
        userId: user.id,
        tokenHash: hashToken(inviteToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      res.status(201).json({
        message: "Account created. Send the invite link through the configured email service.",
        invite: {
          user: publicUser(user, await store.getProfile(user)),
          inviteToken: config.isProduction ? undefined : inviteToken,
          temporaryPassword: config.isProduction ? undefined : temporaryPassword,
          invitePath: `/login?invite=${inviteToken}`,
        },
      });
    } catch (error) {
      if (error.code === "DUPLICATE_EMAIL") return res.status(409).json({ error: "Email is already in use" });
      throw error;
    }
  });

  app.get("/teacher/availability", auth, requireRole("teacher"), async (req, res) => {
    const profile = await store.getProfile(req.user);
    res.json({
      timezone: profile?.timezone || "UTC",
      windows: await store.listTeacherAvailability(req.user.id),
      blocks: await store.listTeacherAvailabilityBlocks(req.user.id),
    });
  });

  app.put("/teacher/availability", auth, requireRole("teacher"), async (req, res) => {
    try {
      const windows = normalizeAvailabilityWindows(req.body?.windows);
      const byDay = new Set();
      for (const window of windows) {
        const key = `${window.dayOfWeek}:${window.startTimeLocal}:${window.endTimeLocal}`;
        if (byDay.has(key)) throw new Error("Duplicate availability windows are not allowed");
        byDay.add(key);
      }
      const saved = await store.replaceTeacherAvailability(req.user.id, windows);
      const profile = await store.getProfile(req.user);
      return res.json({ timezone: profile?.timezone || "UTC", windows: saved });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post("/teacher/availability/blocks", auth, requireRole("teacher"), async (req, res) => {
    const { blockedDateFrom, blockedDateTo, reason } = req.body || {};
    try {
      validateDateRange(blockedDateFrom, blockedDateTo);
      const block = await store.addTeacherAvailabilityBlock({
        teacherId: req.user.id,
        blockedDateFrom,
        blockedDateTo,
        reason: typeof reason === "string" ? reason.trim().slice(0, 255) : null,
      });
      return res.status(201).json({ block });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete("/teacher/availability/blocks/:id", auth, requireRole("teacher"), async (req, res) => {
    const deleted = await store.deleteTeacherAvailabilityBlock(req.user.id, req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: "Availability block not found" });
  });

  app.get("/admin/scheduling/options", auth, requireRole("admin"), async (_req, res) => {
    const [teachers, students, courses] = await Promise.all([
      store.listAccountsByRole("teacher"),
      store.listAccountsByRole("student"),
      store.listCourses(),
    ]);
    const enrichedTeachers = await Promise.all(teachers.map(async (teacher) => {
      const profile = await store.getTeacherSchedulingProfile(teacher.id);
      return { ...teacher, timezone: profile?.timezone || teacher.timezone, availability: profile?.availability || [], blocks: profile?.blocks || [] };
    }));
    res.json({ teachers: enrichedTeachers, students, courses });
  });

  app.post("/admin/classes", auth, requireRole("admin"), async (req, res) => {
    try {
      const { teacherId, studentId, courseId, startDate, startTime, durationMinutes = 60, daysOfWeek } = req.body || {};
      if (!teacherId || !studentId || !courseId) throw new Error("Teacher, student, and course are required");
      if (!Number.isInteger(Number(durationMinutes)) || Number(durationMinutes) < 15 || Number(durationMinutes) > 180) {
        throw new Error("Class duration must be a whole number from 15 to 180 minutes");
      }
      const normalizedDays = Array.isArray(daysOfWeek) ? [...new Set(daysOfWeek.map(Number))].sort((a, b) => a - b) : [];
      const recurringRule = buildWeeklyRule({ startDate, startTime, daysOfWeek: normalizedDays });
      const [teacher, student, course, profile] = await Promise.all([
        store.findUserById(teacherId),
        store.findUserById(studentId),
        store.findCourseById(courseId),
        store.getTeacherSchedulingProfile(teacherId),
      ]);
      if (!teacher || teacher.role !== "teacher" || teacher.status !== "active" || !profile) throw new Error("Select an active teacher");
      if (!student || student.role !== "student" || student.status !== "active") throw new Error("Select an active student");
      if (!course) throw new Error("Select a valid course");
      const duration = Number(durationMinutes);
      for (const weekday of normalizedDays) {
        if (!withinAvailability(profile.availability, weekday, startTime, duration)) {
          throw new Error(`The selected time is outside ${WEEKDAY_CODES[weekday]} availability in ${profile.timezone}`);
        }
      }
      const localStart = parseLocalDateTime(startDate, startTime);
      const startInstant = toUtcInstant(localStart, profile.timezone);
      if (!startInstant) throw new Error("That local time does not exist because of a daylight-saving transition");
      const now = clock();
      if (startInstant <= now || startInstant > new Date(now.getTime() + 56 * 24 * 60 * 60 * 1000)) {
        throw new Error("Choose a first class date within the next 8 weeks");
      }
      if (dateBlocked(profile.blocks, startDate)) throw new Error("The teacher has blocked this date");
      const slots = expandSchedule({
        ruleText: recurringRule,
        timezone: profile.timezone,
        availability: profile.availability,
        blocks: profile.blocks,
        durationMinutes: duration,
        now,
      });
      if (!slots.length) throw new Error("No valid class dates were found in the next 8 weeks");
      const created = await store.createClassWithSlots({
        teacherId,
        studentId,
        courseId,
        durationMinutes: duration,
        recurringRule,
        slots,
      });
      res.status(201).json({
        classId: created.classId,
        generatedSlots: created.slots.length,
        firstSlotUtc: created.slots[0]?.date_time_utc,
        teacherTimezone: profile.timezone,
      });
    } catch (error) {
      return requestError(res, error);
    }
  });

  const scheduleRoute = (role) => async (req, res) => {
    const profile = role === "teacher" || role === "student" ? await store.getProfile(req.user) : null;
    const timezone = profile?.timezone || "UTC";
    try {
      const bounds = calendarBounds({ from: req.query.from, to: req.query.to, timezone });
      const slots = await store.listSchedule({ role, userId: req.user.id, ...bounds });
      res.json({ timezone, slots });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  app.get("/admin/schedule", auth, requireRole("admin"), scheduleRoute("admin"));
  app.get("/teacher/schedule", auth, requireRole("teacher"), scheduleRoute("teacher"));
  app.get("/student/schedule", auth, requireRole("student"), scheduleRoute("student"));

  app.post("/teacher/slots/:id/attendance", auth, requireRole("teacher"), async (req, res) => {
    const attendanceRecord = req.body?.attendanceRecord;
    if (!["present", "no_show"].includes(attendanceRecord)) {
      return res.status(400).json({ error: "Attendance must be present or no_show" });
    }
    try {
      const slot = await store.recordTeacherAttendance({
        slotId: req.params.id,
        teacherId: req.user.id,
        attendanceRecord,
        now: clock(),
      });
      return slot ? res.json({ slot }) : res.status(404).json({ error: "Schedule slot not found" });
    } catch (error) {
      return requestError(res, error);
    }
  });

  app.put("/admin/slots/:id/attendance-override", auth, requireRole("admin"), async (req, res) => {
    const { attendanceRecord, reason } = req.body || {};
    if (!["present", "no_show", "excused"].includes(attendanceRecord)) {
      return res.status(400).json({ error: "Attendance must be present, no_show, or excused" });
    }
    if (typeof reason !== "string" || !reason.trim()) return res.status(400).json({ error: "A reason is required for attendance overrides" });
    try {
      const slot = await store.overrideAttendance({
        slotId: req.params.id,
        actorId: req.user.id,
        attendanceRecord,
        reason: reason.trim().slice(0, 1000),
        now: clock(),
      });
      return slot ? res.json({ slot }) : res.status(404).json({ error: "Schedule slot not found" });
    } catch (error) {
      return requestError(res, error);
    }
  });

  app.put("/admin/teachers/:id/status", auth, requireRole("admin"), async (req, res) => {
    const { status, reason } = req.body || {};
    if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "Status must be active or suspended" });
    if (typeof reason !== "string" || !reason.trim()) return res.status(400).json({ error: "A reason is required" });
    const result = await store.setTeacherStatusAndReassignFuture({
      teacherId: req.params.id,
      actorId: req.user.id,
      status,
      reason: reason.trim().slice(0, 1000),
      now: clock(),
    });
    return result ? res.json({ status: result.user.status, reassignedCount: result.reassignedCount }) : res.status(404).json({ error: "Teacher not found" });
  });

  app.get("/admin/audit-log", auth, requireRole("admin"), async (req, res) => {
    const limit = Number(req.query.limit || 100);
    res.json({ entries: await store.listAuditLog(limit) });
  });

  const dashboards = {
    admin: "Admin dashboard",
    teacher: "Teacher dashboard",
    student: "Student dashboard",
  };
  for (const [role, title] of Object.entries(dashboards)) {
    app.get(`/${role}/dashboard`, auth, requireRole(role), async (req, res) => {
      res.json({
        role,
        title,
        empty: false,
        message: role === "admin" ? "Manage class schedules and review attendance." : role === "teacher" ? "View your calendar and record attendance." : "View your upcoming and past classes.",
        user: publicUser(req.user, await store.getProfile(req.user)),
      });
    });
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

module.exports = { createApp, publicUser };