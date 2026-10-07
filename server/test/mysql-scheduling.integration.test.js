const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mysql = require("mysql2/promise");
const request = require("supertest");
const { bcrypt } = require("../src/security");
const { createApp } = require("../src/app");
const { MysqlStore } = require("../src/store/mysqlStore");
const { generateRollingSlots } = require("../src/workerJobs");

const testDatabaseUrl = process.env.MYSQL_TEST_URL;
const marks = (values) => values.map(() => "?").join(", ");

test("database unique index rejects concurrent teacher double-booking; override writes audit", { skip: !testDatabaseUrl }, async () => {
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  assert.match(databaseName, /test/i, "MYSQL_TEST_URL must point to a database with 'test' in its name");
  const pool = mysql.createPool(testDatabaseUrl);
  const store = new MysqlStore(testDatabaseUrl);
  const adminId = randomUUID();
  const teacherId = randomUUID();
  const studentId = randomUUID();
  const courseId = randomUUID();
  const firstClassId = randomUUID();
  const secondClassId = randomUUID();
  const slotIds = [randomUUID(), randomUUID()];
  const appointment = "2030-04-10 10:00:00";

  try {
    const [indexes] = await pool.execute("SHOW INDEX FROM schedule_slots WHERE Key_name = 'uq_teacher_slot_time'");
    assert.deepEqual(indexes.map((index) => index.Column_name), ["teacher_id", "date_time_utc"]);

    await pool.execute(
      "INSERT INTO users (id, role, name, email, password_hash) VALUES (?, 'admin', 'DB Test Admin', ?, 'test'), (?, 'teacher', 'DB Test Teacher', ?, 'test'), (?, 'student', 'DB Test Student', ?, 'test')",
      [adminId, `${adminId}@sidra-test.invalid`, teacherId, `${teacherId}@sidra-test.invalid`, studentId, `${studentId}@sidra-test.invalid`],
    );
    await pool.execute("INSERT INTO teacher_profiles (user_id, timezone) VALUES (?, 'UTC')", [teacherId]);
    await pool.execute("INSERT INTO student_profiles (user_id, timezone, level) VALUES (?, 'UTC', 'beginner')", [studentId]);
    await pool.execute(
      "INSERT INTO courses (id, title, level, package_options) VALUES (?, 'Concurrency test course', 'all', JSON_ARRAY())",
      [courseId],
    );
    await pool.execute(
      "INSERT INTO classes (id, student_id, teacher_id, course_id, duration_minutes, recurring_rule) VALUES (?, ?, ?, ?, 60, 'test'), (?, ?, ?, ?, 60, 'test')",
      [firstClassId, studentId, teacherId, courseId, secondClassId, studentId, teacherId, courseId],
    );

    const attempts = await Promise.allSettled(slotIds.map((slotId, index) => pool.execute(
      "INSERT INTO schedule_slots (id, class_id, teacher_id, date_time_utc, status) VALUES (?, ?, ?, ?, 'upcoming')",
      [slotId, index === 0 ? firstClassId : secondClassId, teacherId, appointment],
    )));
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected" && result.reason.code === "ER_DUP_ENTRY").length, 1);

    const winnerIndex = attempts.findIndex((result) => result.status === "fulfilled");
    const slotId = slotIds[winnerIndex];
    await store.overrideAttendance({
      slotId,
      actorId: adminId,
      attendanceRecord: "excused",
      reason: "Integration-test override",
      now: new Date("2030-04-10T12:00:00Z"),
    });
    const [auditRows] = await pool.execute(
      "SELECT action, reason FROM audit_log WHERE entity_type = 'schedule_slot' AND entity_id = ?",
      [slotId],
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, "attendance.override");
    assert.equal(auditRows[0].reason, "Integration-test override");

    const pendingId = randomUUID();
    await pool.execute(
      "INSERT INTO schedule_slots (id, class_id, teacher_id, date_time_utc, status) VALUES (?, ?, ?, '2025-01-01 10:00:00', 'upcoming')",
      [pendingId, firstClassId, teacherId],
    );
    const changed = await store.markPastUnmarkedSlotsPendingReview(new Date("2025-01-03T12:00:00Z"));
    assert.equal(changed, 1);
    const [pendingRows] = await pool.execute("SELECT status FROM schedule_slots WHERE id = ?", [pendingId]);
    assert.equal(pendingRows[0].status, "pending_review");
  } finally {
    await pool.execute("DELETE FROM audit_log WHERE actor_id = ?", [adminId]).catch(() => {});
    await pool.execute("DELETE FROM schedule_slots WHERE class_id IN (?, ?)", [firstClassId, secondClassId]).catch(() => {});
    await pool.execute("DELETE FROM classes WHERE id IN (?, ?)", [firstClassId, secondClassId]).catch(() => {});
    await pool.execute("DELETE FROM courses WHERE id = ?", [courseId]).catch(() => {});
    await pool.execute("DELETE FROM teacher_profiles WHERE user_id = ?", [teacherId]).catch(() => {});
    await pool.execute("DELETE FROM student_profiles WHERE user_id = ?", [studentId]).catch(() => {});
    await pool.execute("DELETE FROM users WHERE id IN (?, ?, ?)", [adminId, teacherId, studentId]).catch(() => {});
    await store.close();
    await pool.end();
  }
});

test("MySQL-backed Admin scheduling, role calendars, attendance, and suspension flow", { skip: !testDatabaseUrl }, async () => {
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  assert.match(databaseName, /test/i, "MYSQL_TEST_URL must point to a database with 'test' in its name");
  const pool = mysql.createPool(testDatabaseUrl);
  const store = new MysqlStore(testDatabaseUrl);
  const ownerIds = [];
  const classIds = [];
  try {
    const passwordHash = await bcrypt.hash("Phase3MysqlTestPassword!", 4);
    const admin = await store.createUser({ role: "admin", name: "API Test Admin", email: `${randomUUID()}@sidra-test.invalid`, passwordHash });
    const teacher = await store.createUser({ role: "teacher", name: "API Test Teacher", email: `${randomUUID()}@sidra-test.invalid`, timezone: "UTC", passwordHash });
    const student = await store.createUser({ role: "student", name: "API Test Student", email: `${randomUUID()}@sidra-test.invalid`, timezone: "America/New_York", passwordHash });
    ownerIds.push(admin.id, teacher.id, student.id);
    await store.replaceTeacherAvailability(teacher.id, Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek, startTimeLocal: "08:00", endTimeLocal: "12:00",
    })));
    const app = createApp({ store, seed: false });
    const accessToken = async (role, email) => {
      const result = await request(app).post("/auth/login").send({ email, password: "Phase3MysqlTestPassword!" });
      assert.equal(result.status, 200, `login ${role}`);
      return result.body.accessToken;
    };
    const adminToken = await accessToken("admin", admin.email);
    const teacherToken = await accessToken("teacher", teacher.email);
    const studentToken = await accessToken("student", student.email);
    const startDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayOfWeek = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    const created = await request(app).post("/admin/classes").set("Authorization", `Bearer ${adminToken}`).send({
      teacherId: teacher.id,
      studentId: student.id,
      courseId: "00000000-0000-4000-8000-000000000001",
      startDate,
      startTime: "09:00",
      durationMinutes: 60,
      daysOfWeek: [dayOfWeek],
    });
    assert.equal(created.status, 201, created.body.error);
    assert.ok(created.body.generatedSlots >= 8);
    const [classRows] = await pool.execute("SELECT id FROM classes WHERE teacher_id = ? AND student_id = ?", [teacher.id, student.id]);
    classIds.push(...classRows.map((row) => row.id));
    let [slots] = await pool.execute("SELECT id FROM schedule_slots WHERE class_id = ? ORDER BY date_time_utc", [created.body.classId]);
    assert.ok(slots.length >= 8);
    await pool.execute("DELETE FROM schedule_slots WHERE id = ?", [slots[1].id]);
    const generated = await generateRollingSlots(store);
    assert.equal(generated.inserted, 1);
    const [rematerialized] = await pool.execute("SELECT COUNT(*) AS count FROM schedule_slots WHERE class_id = ?", [created.body.classId]);
    assert.equal(Number(rematerialized[0].count), slots.length);
    [slots] = await pool.execute("SELECT id FROM schedule_slots WHERE class_id = ? ORDER BY date_time_utc", [created.body.classId]);

    const teacherSchedule = await request(app).get("/teacher/schedule").set("Authorization", `Bearer ${teacherToken}`);
    const studentSchedule = await request(app).get("/student/schedule").set("Authorization", `Bearer ${studentToken}`);
    assert.equal(teacherSchedule.status, 200);
    assert.equal(studentSchedule.status, 200);
    assert.ok(teacherSchedule.body.slots.every((slot) => slot.teacherId === teacher.id));
    assert.ok(studentSchedule.body.slots.every((slot) => slot.studentId === student.id));

    const markSlotId = slots[0].id;
    const pastStart = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    await pool.execute("UPDATE schedule_slots SET date_time_utc = ? WHERE id = ?", [pastStart, markSlotId]);
    const marked = await request(app).post(`/teacher/slots/${markSlotId}/attendance`)
      .set("Authorization", `Bearer ${teacherToken}`).send({ attendanceRecord: "no_show" });
    assert.equal(marked.status, 200, marked.body.error);
    assert.equal(marked.body.slot.status, "no_show_unexcused");
    const overridden = await request(app).put(`/admin/slots/${markSlotId}/attendance-override`)
      .set("Authorization", `Bearer ${adminToken}`).send({ attendanceRecord: "excused", reason: "Verified absence note" });
    assert.equal(overridden.status, 200, overridden.body.error);
    assert.equal(overridden.body.slot.status, "excused_absence");
    assert.ok((await store.listAuditLog()).some((entry) => entry.entity_id === markSlotId && entry.action === "attendance.override"));

    const [currentSlots] = await pool.execute("SELECT id FROM schedule_slots WHERE class_id = ? ORDER BY date_time_utc", [created.body.classId]);
    await pool.execute("UPDATE schedule_slots SET status = 'completed', attendance_record = 'present' WHERE id = ?", [currentSlots[1].id]);
    const digest = await store.getTeacherHoursDigest(teacher.id, new Date("2020-01-01T00:00:00Z"), new Date("2040-01-01T00:00:00Z"));
    assert.equal(digest.sessions, 1);
    assert.equal(digest.minutes, 60);

    const suspended = await request(app).put(`/admin/teachers/${teacher.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`).send({ status: "suspended", reason: "Test schedule reassignment" });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.reassignedCount, slots.length - 2);
    const [reassigned] = await pool.execute("SELECT COUNT(*) AS count FROM schedule_slots WHERE class_id = ? AND status = 'needs_reassignment'", [created.body.classId]);
    assert.equal(Number(reassigned[0].count), slots.length - 2);
  } finally {
    if (ownerIds.length) {
      await pool.execute(`DELETE FROM audit_log WHERE actor_id IN (${marks(ownerIds)})`, ownerIds).catch(() => {});
      if (classIds.length) {
        await pool.execute(`DELETE FROM schedule_slots WHERE class_id IN (${marks(classIds)})`, classIds).catch(() => {});
        await pool.execute(`DELETE FROM classes WHERE id IN (${marks(classIds)})`, classIds).catch(() => {});
      }
      await pool.execute("DELETE FROM teacher_availability_blocks WHERE teacher_id = ?", [ownerIds[1]]).catch(() => {});
      await pool.execute("DELETE FROM teacher_availability WHERE teacher_id = ?", [ownerIds[1]]).catch(() => {});
      await pool.execute("DELETE FROM teacher_profiles WHERE user_id = ?", [ownerIds[1]]).catch(() => {});
      await pool.execute("DELETE FROM student_profiles WHERE user_id = ?", [ownerIds[2]]).catch(() => {});
      await pool.execute(`DELETE FROM users WHERE id IN (${marks(ownerIds)})`, ownerIds).catch(() => {});
    }
    await store.close();
    await pool.end();
  }
});
