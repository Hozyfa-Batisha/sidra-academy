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
    timezone: "Africa/Cairo",
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