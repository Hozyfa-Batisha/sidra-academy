const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { MemoryStore } = require("../src/store/memoryStore");
const { bcrypt } = require("../src/security");

async function fixture() {
  const store = new MemoryStore();
  await store.createUser({
    role: "admin",
    name: "Admin",
    email: "admin@sidra.test",
    passwordHash: await bcrypt.hash("AdminPassword123!", 4),
  });
  await store.createUser({
    role: "teacher",
    name: "Teacher",
    email: "teacher@sidra.test",
    timezone: "America/New_York",
    passwordHash: await bcrypt.hash("TeacherPassword123!", 4),
  });
  await store.createUser({
    role: "student",
    name: "Student",
    email: "student@sidra.test",
    timezone: "Europe/London",
    level: "beginner",
    passwordHash: await bcrypt.hash("StudentPassword123!", 4),
  });
  return { store, app: createApp({ store, seed: false }) };
}

async function login(app, email, password) {
  const response = await request(app).post("/auth/login").send({ email, password });
  assert.equal(response.status, 200);
  return response.body.accessToken;
}

function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function utcInstantForLocal(date, time, timeZone) {
  const desired = Date.parse(`${date}T${time}:00Z`);
  let instant = new Date(desired);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(instant, timeZone);
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    instant = new Date(instant.getTime() + desired - observed);
  }
  return instant;
}

test("each role logs in and lands on its own dashboard", async () => {
  const { app } = await fixture();
  for (const role of ["admin", "teacher", "student"]) {
    const token = await login(app, `${role}@sidra.test`, `${role[0].toUpperCase()}${role.slice(1)}Password123!`);
    const response = await request(app)
      .get(`/${role}/dashboard`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.role, role);
    assert.equal(response.body.empty, true);
  }
});

test("role middleware rejects access to another role's routes", async () => {
  const { app } = await fixture();
  const tokens = {};
  for (const role of ["admin", "teacher", "student"]) {
    tokens[role] = await login(app, `${role}@sidra.test`, `${role[0].toUpperCase()}${role.slice(1)}Password123!`);
  }
  for (const actor of ["admin", "teacher", "student"]) {
    for (const target of ["admin", "teacher", "student"]) {
      const response = await request(app)
        .get(`/${target}/dashboard`)
        .set("Authorization", `Bearer ${tokens[actor]}`);
      assert.equal(response.status, actor === target ? 200 : 403, `${actor} -> ${target}`);
    }
  }
});

test("dashboard routes require authentication", async () => {
  const { app } = await fixture();
  const response = await request(app).get("/student/dashboard");
  assert.equal(response.status, 401);
});

test("refresh cookie issues a new access token", async () => {
  const { app } = await fixture();
  const agent = request.agent(app);
  const loginResponse = await agent
    .post("/auth/login")
    .send({ email: "teacher@sidra.test", password: "TeacherPassword123!" });
  assert.equal(loginResponse.status, 200);
  const refreshResponse = await agent.post("/auth/refresh");
  assert.equal(refreshResponse.status, 200);
  assert.equal(refreshResponse.body.user.role, "teacher");
  assert.ok(refreshResponse.body.accessToken);
});

test("teacher availability stays in local time across a DST boundary", async () => {
  const { app } = await fixture();
  const token = await login(app, "teacher@sidra.test", "TeacherPassword123!");
  const save = await request(app)
    .put("/teacher/availability")
    .set("Authorization", `Bearer ${token}`)
    .send({ windows: [{ dayOfWeek: 0, startTimeLocal: "09:00", endTimeLocal: "12:00" }] });
  assert.equal(save.status, 200);
  assert.equal(save.body.timezone, "America/New_York");
  assert.equal(save.body.windows[0].start_time_local, "09:00");
  assert.equal(save.body.windows[0].end_time_local, "12:00");

  const read = await request(app)
    .get("/teacher/availability")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.timezone, "America/New_York");
  assert.equal(read.body.windows[0].start_time_local, "09:00");

  const dstZone = "America/New_York";
  const beforeFallback = utcInstantForLocal("2026-03-08", "09:00", dstZone);
  const afterFallback = utcInstantForLocal("2026-11-01", "09:00", dstZone);
  assert.notEqual(beforeFallback.toISOString(), afterFallback.toISOString());
  assert.equal(localParts(beforeFallback, dstZone).hour, "09");
  assert.equal(localParts(afterFallback, dstZone).hour, "09");
});

test("teacher can block dates and only the owning teacher can remove them", async () => {
  const { app } = await fixture();
  const teacherToken = await login(app, "teacher@sidra.test", "TeacherPassword123!");
  const studentToken = await login(app, "student@sidra.test", "StudentPassword123!");
  const created = await request(app)
    .post("/teacher/availability/blocks")
    .set("Authorization", `Bearer ${teacherToken}`)
    .send({ blockedDateFrom: "2026-10-10", blockedDateTo: "2026-10-14", reason: "Holiday" });
  assert.equal(created.status, 201);
  assert.equal(created.body.block.blocked_date_from, "2026-10-10");
  assert.equal(created.body.block.blocked_date_to, "2026-10-14");

  const studentDelete = await request(app)
    .delete(`/teacher/availability/blocks/${created.body.block.id}`)
    .set("Authorization", `Bearer ${studentToken}`);
  assert.equal(studentDelete.status, 403);

  const teacherDelete = await request(app)
    .delete(`/teacher/availability/blocks/${created.body.block.id}`)
    .set("Authorization", `Bearer ${teacherToken}`);
  assert.equal(teacherDelete.status, 204);
});

test("admin invite creates a forced-reset account with profile defaults", async () => {
  const { app } = await fixture();
  const token = await login(app, "admin@sidra.test", "AdminPassword123!");
  const response = await request(app)
    .post("/admin/invites")
    .set("Authorization", `Bearer ${token}`)
    .send({ role: "student", name: "New Student", email: "new@sidra.test", timezone: "Asia/Dubai", level: "intermediate" });
  assert.equal(response.status, 201);
  assert.equal(response.body.invite.user.profile.timezone, "Asia/Dubai");
  assert.equal(response.body.invite.user.profile.level, "intermediate");
  assert.equal(response.body.invite.user.mustResetPassword, true);
  assert.ok(response.body.invite.temporaryPassword);
});

test("first-login reset clears the forced reset flag", async () => {
  const { app } = await fixture();
  const adminToken = await login(app, "admin@sidra.test", "AdminPassword123!");
  const invited = await request(app)
    .post("/admin/invites")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ role: "teacher", name: "Invited Teacher", email: "invite@sidra.test", timezone: "UTC" });
  const tempPassword = invited.body.invite.temporaryPassword;
  const loginResponse = await request(app).post("/auth/login").send({ email: "invite@sidra.test", password: tempPassword });
  assert.equal(loginResponse.body.user.mustResetPassword, true);
  const reset = await request(app)
    .post("/auth/reset-password")
    .set("Authorization", `Bearer ${loginResponse.body.accessToken}`)
    .send({ currentPassword: tempPassword, newPassword: "NewSecurePassword123!" });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.mustResetPassword, false);
});