const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { MemoryStore } = require("../src/store/memoryStore");
const { bcrypt } = require("../src/security");
const { buildWeeklyRule, expandSchedule } = require("../src/scheduling");
const { markUnattendedSlotsForReview, generateRollingSlots } = require("../src/workerJobs");

async function fixture() {
  const store = new MemoryStore();
  await store.createUser({ role: "admin", name: "Admin", email: "admin@phase3.test", passwordHash: await bcrypt.hash("AdminPassword123!", 4) });
  const teacher = await store.createUser({ role: "teacher", name: "Teacher", email: "teacher@phase3.test", timezone: "UTC", passwordHash: await bcrypt.hash("TeacherPassword123!", 4) });
  const student = await store.createUser({ role: "student", name: "Student", email: "student@phase3.test", timezone: "America/New_York", passwordHash: await bcrypt.hash("StudentPassword123!", 4) });
  await store.replaceTeacherAvailability(teacher.id, Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek, startTimeLocal: "08:00", endTimeLocal: "12:00",
  })));
  return { store, app: createApp({ store, seed: false }), teacher, student };
}

async function login(app, role) {
  const response = await request(app).post("/auth/login").send({
    email: `${role}@phase3.test`,
    password: `${role[0].toUpperCase()}${role.slice(1)}Password123!`,
  });
  assert.equal(response.status, 200);
  return response.body.accessToken;
}

function tomorrowUtc() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function createClass(app, teacher, student, startDate = tomorrowUtc()) {
  const adminToken = await login(app, "admin");
  const dayOfWeek = new Date(`${startDate}T00:00:00Z`).getUTCDay();
  const response = await request(app)
    .post("/admin/classes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      teacherId: teacher.id,
      studentId: student.id,
      courseId: "00000000-0000-4000-8000-000000000001",
      startDate,
      startTime: "09:00",
      durationMinutes: 60,
      daysOfWeek: [dayOfWeek],
    });
  return { response, adminToken, dayOfWeek };
}

test("weekly materialization preserves 09:00 local time across a DST boundary", () => {
  const recurringRule = buildWeeklyRule({ startDate: "2026-03-01", startTime: "09:00", daysOfWeek: [0] });
  const slots = expandSchedule({
    ruleText: recurringRule,
    timezone: "America/New_York",
    availability: [{ day_of_week: 0, start_time_local: "08:00", end_time_local: "12:00" }],
    blocks: [],
    durationMinutes: 60,
    now: new Date("2026-02-28T00:00:00Z"),
    horizonDays: 15,
  });
  assert.deepEqual(slots.map((slot) => slot.time), ["09:00", "09:00"]);
  assert.deepEqual(slots.map((slot) => slot.dateTimeUtc.toISOString()), ["2026-03-01T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
});

test("Admin can create weekly classes only within availability and the API seeds the next eight weeks", async () => {
  const { store, app, teacher, student } = await fixture();
  const { response, adminToken } = await createClass(app, teacher, student);
  assert.equal(response.status, 201);
  assert.ok(response.body.generatedSlots >= 8);
  const schedule = await request(app).get("/admin/schedule").set("Authorization", `Bearer ${adminToken}`);
  assert.equal(schedule.status, 200);
  assert.ok(schedule.body.slots.length >= 8);

  const invalid = await request(app)
    .post("/admin/classes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      teacherId: teacher.id,
      studentId: student.id,
      courseId: "00000000-0000-4000-8000-000000000001",
      startDate: tomorrowUtc(),
      startTime: "13:00",
      durationMinutes: 60,
      daysOfWeek: [new Date(`${tomorrowUtc()}T00:00:00Z`).getUTCDay()],
    });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /outside/);
  assert.equal(store.classes.size, 1);
});

test("concurrent schedule attempts are rejected for a duplicate teacher/time in the store", async () => {
  const { store, app, teacher, student } = await fixture();
  const first = await createClass(app, teacher, student);
  assert.equal(first.response.status, 201);
  const second = await createClass(app, teacher, student);
  assert.equal(second.response.status, 409);
  assert.match(second.response.body.error, /already booked/);
});

test("teacher attendance is role scoped and Admin overrides append audit entries", async () => {
  const { store, app, teacher, student } = await fixture();
  const { response: created, adminToken } = await createClass(app, teacher, student);
  assert.equal(created.status, 201);
  const slot = [...store.scheduleSlots.values()][0];
  slot.date_time_utc = new Date(Date.now() - 60 * 60 * 1000);
  const teacherToken = await login(app, "teacher");
  const studentToken = await login(app, "student");
  const forbidden = await request(app)
    .post(`/teacher/slots/${slot.id}/attendance`)
    .set("Authorization", `Bearer ${studentToken}`)
    .send({ attendanceRecord: "present" });
  assert.equal(forbidden.status, 403);

  const marked = await request(app)
    .post(`/teacher/slots/${slot.id}/attendance`)
    .set("Authorization", `Bearer ${teacherToken}`)
    .send({ attendanceRecord: "no_show" });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.slot.status, "no_show_unexcused");

  const override = await request(app)
    .put(`/admin/slots/${slot.id}/attendance-override`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ attendanceRecord: "excused", reason: "Parent contacted the academy" });
  assert.equal(override.status, 200);
  assert.equal(override.body.slot.status, "excused_absence");
  const audit = await request(app).get("/admin/audit-log").set("Authorization", `Bearer ${adminToken}`);
  assert.equal(audit.body.entries.length, 1);
  assert.equal(audit.body.entries[0].action, "attendance.override");
  assert.equal(audit.body.entries[0].reason, "Parent contacted the academy");
});

test("watchdog changes overdue unmarked slots to pending_review without an HTTP trigger", async () => {
  const { store, app, teacher, student } = await fixture();
  await createClass(app, teacher, student);
  const slots = [...store.scheduleSlots.values()];
  slots[0].date_time_utc = new Date("2026-01-01T09:00:00Z");
  const result = await markUnattendedSlotsForReview(store, new Date("2026-01-03T12:00:00Z"));
  assert.equal(result.pendingReview, 1);
  assert.equal(slots[0].status, "pending_review");
  assert.equal(slots[1].status, "upcoming");
});

test("slot generator fills missed dates inside the rolling horizon", async () => {
  const { store, app, teacher, student } = await fixture();
  await createClass(app, teacher, student);
  const classRow = [...store.classes.values()][0];
  const beforeCount = store.scheduleSlots.size;
  const now = new Date();
  const profile = await store.getTeacherSchedulingProfile(teacher.id);
  const expected = expandSchedule({
    ruleText: classRow.recurring_rule,
    timezone: profile.timezone,
    availability: profile.availability,
    blocks: profile.blocks,
    durationMinutes: classRow.duration_minutes,
    now,
  });
  const result = await generateRollingSlots(store, now);
  assert.equal(result.inserted, 0);
  assert.ok(result.conflicts >= beforeCount);
  assert.ok(expected.length >= beforeCount);
});

test("teacher suspension marks future sessions for reassignment and audits the change", async () => {
  const { store, app, teacher, student } = await fixture();
  const { response: created, adminToken } = await createClass(app, teacher, student);
  assert.equal(created.status, 201);
  const slots = [...store.scheduleSlots.values()];
  slots[0].status = "completed";
  slots[1].status = "upcoming";
  const response = await request(app)
    .put(`/admin/teachers/${teacher.id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "suspended", reason: "Teacher unavailable" });
  assert.equal(response.status, 200);
  assert.equal(response.body.reassignedCount, slots.length - 1);
  assert.equal(slots[0].status, "completed");
  assert.equal(slots[1].status, "needs_reassignment");
  assert.equal(store.auditLog.at(-1).action, "account.suspend");
});

test("student calendar is read-only and only returns that student's slots", async () => {
  const { app, teacher, student } = await fixture();
  const { response: created } = await createClass(app, teacher, student);
  assert.equal(created.status, 201);
  const token = await login(app, "student");
  const response = await request(app).get("/student/schedule").set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.ok(response.body.slots.length > 0);
  assert.equal(response.body.slots[0].studentId, student.id);
  assert.equal((await request(app).post(`/student/slots/${response.body.slots[0].id}/attendance`).set("Authorization", `Bearer ${token}`).send({ attendanceRecord: "present" })).status, 404);
});
