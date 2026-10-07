const mysql = require("mysql2/promise");
const { randomUUID } = require("node:crypto");

function mysqlUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function auditInsert(connection, entry) {
  return connection.execute(
    "INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before_json, after_json, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      randomUUID(),
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId,
      JSON.stringify(entry.before),
      JSON.stringify(entry.after),
      entry.reason,
    ],
  );
}

class MysqlStore {
  constructor(url = process.env.DATABASE_URL) {
    if (!url) throw new Error("DATABASE_URL is required for the MySQL store");
    this.pool = mysql.createPool(url);
  }

  async createUser({ role, name, email, passwordHash, timezone = "UTC", level = "beginner", mustResetPassword = false }) {
    const id = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO users (id, role, name, email, password_hash, must_reset_password) VALUES (?, ?, ?, ?, ?, ?)",
        [id, role, name.trim(), email.trim().toLowerCase(), passwordHash, mustResetPassword],
      );
      if (role === "teacher") {
        await connection.execute("INSERT INTO teacher_profiles (user_id, timezone) VALUES (?, ?)", [id, timezone]);
      }
      if (role === "student") {
        await connection.execute("INSERT INTO student_profiles (user_id, timezone, level) VALUES (?, ?, ?)", [id, timezone, level]);
      }
      await connection.commit();
      return this.findUserById(id);
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") error.code = "DUPLICATE_EMAIL";
      throw error;
    } finally {
      connection.release();
    }
  }

  async findUserByEmail(email) {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    return rows[0] || null;
  }

  async findUserById(id) {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE id = ?", [id]);
    return rows[0] || null;
  }

  async updateUser(id, changes) {
    const allowed = { password_hash: "password_hash", must_reset_password: "must_reset_password", status: "status" };
    const entries = Object.entries(changes).filter(([key]) => allowed[key]);
    if (!entries.length) return this.findUserById(id);
    const set = entries.map(([key]) => `${allowed[key]} = ?`).join(", ");
    await this.pool.execute(`UPDATE users SET ${set} WHERE id = ?`, [...entries.map(([, value]) => value), id]);
    return this.findUserById(id);
  }

  async getProfile(user) {
    if (user.role === "teacher") {
      const [rows] = await this.pool.execute("SELECT * FROM teacher_profiles WHERE user_id = ?", [user.id]);
      return rows[0] || null;
    }
    if (user.role === "student") {
      const [rows] = await this.pool.execute("SELECT * FROM student_profiles WHERE user_id = ?", [user.id]);
      return rows[0] || null;
    }
    return null;
  }

  async replaceTeacherAvailability(teacherId, windows) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM teacher_availability WHERE teacher_id = ?", [teacherId]);
      for (const window of windows) {
        await connection.execute(
          "INSERT INTO teacher_availability (id, teacher_id, day_of_week, start_time_local, end_time_local) VALUES (?, ?, ?, ?, ?)",
          [randomUUID(), teacherId, window.dayOfWeek, window.startTimeLocal, window.endTimeLocal],
        );
      }
      await connection.commit();
      return this.listTeacherAvailability(teacherId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listTeacherAvailability(teacherId) {
    const [rows] = await this.pool.execute(
      "SELECT id, teacher_id, day_of_week, TIME_FORMAT(start_time_local, '%H:%i') AS start_time_local, TIME_FORMAT(end_time_local, '%H:%i') AS end_time_local FROM teacher_availability WHERE teacher_id = ? ORDER BY day_of_week, start_time_local",
      [teacherId],
    );
    return rows;
  }

  async addTeacherAvailabilityBlock({ teacherId, blockedDateFrom, blockedDateTo, reason }) {
    const id = randomUUID();
    await this.pool.execute(
      "INSERT INTO teacher_availability_blocks (id, teacher_id, blocked_date_from, blocked_date_to, reason) VALUES (?, ?, ?, ?, ?)",
      [id, teacherId, blockedDateFrom, blockedDateTo, reason || null],
    );
    const [rows] = await this.pool.execute("SELECT * FROM teacher_availability_blocks WHERE id = ?", [id]);
    return rows[0];
  }

  async listTeacherAvailabilityBlocks(teacherId) {
    const [rows] = await this.pool.execute(
      "SELECT id, teacher_id, DATE_FORMAT(blocked_date_from, '%Y-%m-%d') AS blocked_date_from, DATE_FORMAT(blocked_date_to, '%Y-%m-%d') AS blocked_date_to, reason FROM teacher_availability_blocks WHERE teacher_id = ? ORDER BY blocked_date_from",
      [teacherId],
    );
    return rows;
  }

  async deleteTeacherAvailabilityBlock(teacherId, blockId) {
    const [result] = await this.pool.execute(
      "DELETE FROM teacher_availability_blocks WHERE id = ? AND teacher_id = ?",
      [blockId, teacherId],
    );
    return result.affectedRows === 1;
  }

  async listAccountsByRole(role) {
    const profileTable = role === "teacher" ? "teacher_profiles" : "student_profiles";
    const extra = role === "student" ? ", p.level" : "";
    const [rows] = await this.pool.execute(
      `SELECT u.id, u.name, u.email, COALESCE(p.timezone, 'UTC') AS timezone${extra} FROM users u LEFT JOIN ${profileTable} p ON p.user_id = u.id WHERE u.role = ? AND u.status = 'active' ORDER BY u.name`,
      [role],
    );
    return rows;
  }

  async listCourses() {
    const [rows] = await this.pool.execute("SELECT id, title, description, level FROM courses ORDER BY title");
    return rows;
  }

  async findCourseById(courseId) {
    const [rows] = await this.pool.execute("SELECT id, title, description, level FROM courses WHERE id = ?", [courseId]);
    return rows[0] || null;
  }

  async getTeacherSchedulingProfile(teacherId) {
    const [profiles] = await this.pool.execute("SELECT timezone FROM teacher_profiles WHERE user_id = ?", [teacherId]);
    if (!profiles[0]) return null;
    return {
      timezone: profiles[0].timezone || "UTC",
      availability: await this.listTeacherAvailability(teacherId),
      blocks: await this.listTeacherAvailabilityBlocks(teacherId),
    };
  }

  async createClassWithSlots({ studentId, teacherId, courseId, durationMinutes, recurringRule, slots }) {
    const id = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO classes (id, student_id, teacher_id, course_id, duration_minutes, recurring_rule) VALUES (?, ?, ?, ?, ?, ?)",
        [id, studentId, teacherId, courseId, durationMinutes, recurringRule],
      );
      const createdSlots = [];
      for (const slot of slots) {
        const slotId = randomUUID();
        await connection.execute(
          "INSERT INTO schedule_slots (id, class_id, teacher_id, date_time_utc, status) VALUES (?, ?, ?, ?, 'upcoming')",
          [slotId, id, teacherId, mysqlUtc(slot.dateTimeUtc)],
        );
        createdSlots.push({ id: slotId, date_time_utc: slot.dateTimeUtc.toISOString(), status: "upcoming" });
      }
      await connection.commit();
      return { classId: id, slots: createdSlots };
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") error.code = "DUPLICATE_SLOT";
      throw error;
    } finally {
      connection.release();
    }
  }

  async listActiveClasses() {
    const [rows] = await this.pool.execute(
      `SELECT c.id, c.student_id, c.teacher_id, c.course_id, c.duration_minutes, c.recurring_rule, p.timezone AS teacher_timezone
       FROM classes c
       JOIN users t ON t.id = c.teacher_id AND t.status = 'active'
       JOIN teacher_profiles p ON p.user_id = c.teacher_id`,
    );
    return rows;
  }

  async insertGeneratedSlot({ classId, teacherId, dateTimeUtc }) {
    try {
      await this.pool.execute(
        "INSERT INTO schedule_slots (id, class_id, teacher_id, date_time_utc, status) VALUES (?, ?, ?, ?, 'upcoming')",
        [randomUUID(), classId, teacherId, mysqlUtc(dateTimeUtc)],
      );
      return true;
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return false;
      throw error;
    }
  }

  async listSchedule({ role, userId, fromUtc, toUtc }) {
    let roleWhere = "";
    const params = [mysqlUtc(fromUtc), mysqlUtc(toUtc)];
    if (role === "teacher") {
      roleWhere = "AND c.teacher_id = ?";
      params.push(userId);
    } else if (role === "student") {
      roleWhere = "AND c.student_id = ?";
      params.push(userId);
    }
    const [rows] = await this.pool.execute(
      `SELECT s.id, c.id AS class_id, t.id AS teacher_id, t.name AS teacher_name, COALESCE(tp.timezone, 'UTC') AS teacher_timezone,
              st.id AS student_id, st.name AS student_name, COALESCE(sp.timezone, 'UTC') AS student_timezone,
              co.title AS course_title, DATE_FORMAT(s.date_time_utc, '%Y-%m-%dT%H:%i:%sZ') AS date_time_utc,
              s.status, s.attendance_record, DATE_FORMAT(s.attendance_marked_at, '%Y-%m-%dT%H:%i:%sZ') AS attendance_marked_at,
              c.zoom_link, c.link_locked
       FROM schedule_slots s
       JOIN classes c ON c.id = s.class_id
       JOIN users t ON t.id = c.teacher_id
       JOIN users st ON st.id = c.student_id
       JOIN courses co ON co.id = c.course_id
       LEFT JOIN teacher_profiles tp ON tp.user_id = t.id
       LEFT JOIN student_profiles sp ON sp.user_id = st.id
       WHERE s.date_time_utc >= ? AND s.date_time_utc <= ? ${roleWhere}
       ORDER BY s.date_time_utc`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      classId: row.class_id,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      teacherTimezone: row.teacher_timezone,
      studentId: row.student_id,
      studentName: row.student_name,
      studentTimezone: row.student_timezone,
      courseTitle: row.course_title,
      dateTimeUtc: row.date_time_utc,
      status: row.status,
      attendanceRecord: row.attendance_record,
      attendanceMarkedAt: row.attendance_marked_at,
      zoomLink: row.zoom_link,
      linkLocked: Boolean(row.link_locked),
    }));
  }

  async findScheduleSlot(slotId) {
    const [rows] = await this.pool.execute(
      `SELECT s.id, s.class_id, s.teacher_id, c.student_id, DATE_FORMAT(s.date_time_utc, '%Y-%m-%dT%H:%i:%sZ') AS date_time_utc,
              s.status, s.attendance_record
       FROM schedule_slots s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      [slotId],
    );
    return rows[0] || null;
  }

  async recordTeacherAttendance({ slotId, teacherId, attendanceRecord, now = new Date() }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT s.id, s.teacher_id, DATE_FORMAT(s.date_time_utc, '%Y-%m-%dT%H:%i:%sZ') AS date_time_utc, s.status
         FROM schedule_slots s WHERE s.id = ? FOR UPDATE`,
        [slotId],
      );
      const slot = rows[0];
      if (!slot) {
        await connection.rollback();
        return null;
      }
      if (slot.teacher_id !== teacherId) {
        const error = new Error("Slot is not assigned to this teacher");
        error.code = "FORBIDDEN";
        throw error;
      }
      const start = new Date(slot.date_time_utc);
      if (slot.status !== "upcoming" || start > now || now > new Date(start.getTime() + 24 * 60 * 60 * 1000)) {
        const error = new Error("Attendance can only be marked from the scheduled start through 24 hours after");
        error.code = "MARK_WINDOW_CLOSED";
        throw error;
      }
      const status = attendanceRecord === "present" ? "completed" : "no_show_unexcused";
      await connection.execute(
        "UPDATE schedule_slots SET attendance_record = ?, attendance_marked_by = ?, attendance_marked_at = ?, status = ? WHERE id = ?",
        [attendanceRecord, teacherId, mysqlUtc(now), status, slotId],
      );
      await connection.commit();
      return { ...slot, attendance_record: attendanceRecord, attendance_marked_by: teacherId, attendance_marked_at: now.toISOString(), status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async overrideAttendance({ slotId, actorId, attendanceRecord, reason, now = new Date() }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        "SELECT id, status, attendance_record, attendance_marked_by FROM schedule_slots WHERE id = ? FOR UPDATE",
        [slotId],
      );
      const slot = rows[0];
      if (!slot) {
        await connection.rollback();
        return null;
      }
      const status = attendanceRecord === "present" ? "completed" : attendanceRecord === "no_show" ? "no_show_unexcused" : "excused_absence";
      await connection.execute(
        "UPDATE schedule_slots SET attendance_record = ?, attendance_marked_by = ?, attendance_marked_at = ?, status = ? WHERE id = ?",
        [attendanceRecord, actorId, mysqlUtc(now), status, slotId],
      );
      await auditInsert(connection, {
        actorId,
        action: "attendance.override",
        entityType: "schedule_slot",
        entityId: slotId,
        before: { status: slot.status, attendance_record: slot.attendance_record, attendance_marked_by: slot.attendance_marked_by },
        after: { status, attendance_record: attendanceRecord, attendance_marked_by: actorId },
        reason,
      });
      await connection.commit();
      return { ...slot, attendance_record: attendanceRecord, attendance_marked_by: actorId, attendance_marked_at: now.toISOString(), status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async markPastUnmarkedSlotsPendingReview(now = new Date()) {
    const [result] = await this.pool.execute(
      `UPDATE schedule_slots SET status = 'pending_review'
       WHERE status = 'upcoming' AND attendance_record IS NULL AND date_time_utc <= ?`,
      [mysqlUtc(new Date(now.getTime() - 24 * 60 * 60 * 1000))],
    );
    return result.affectedRows;
  }

  async setTeacherStatusAndReassignFuture({ teacherId, actorId, status, reason, now = new Date() }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT id, role, status FROM users WHERE id = ? FOR UPDATE", [teacherId]);
      const teacher = rows[0];
      if (!teacher || teacher.role !== "teacher") {
        await connection.rollback();
        return null;
      }
      const reassignedCount = status === "suspended" ? (
        await connection.execute(
          "UPDATE schedule_slots SET status = 'needs_reassignment' WHERE teacher_id = ? AND status = 'upcoming' AND date_time_utc > ?",
          [teacherId, mysqlUtc(now)],
        )
      )[0].affectedRows : 0;
      await connection.execute("UPDATE users SET status = ? WHERE id = ?", [status, teacherId]);
      await auditInsert(connection, {
        actorId,
        action: status === "suspended" ? "account.suspend" : "account.reactivate",
        entityType: "user",
        entityId: teacherId,
        before: { status: teacher.status },
        after: { status, reassignedCount },
        reason,
      });
      await connection.commit();
      return { user: { ...teacher, status }, reassignedCount };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listAuditLog(limit = 100) {
    const [rows] = await this.pool.execute(
      "SELECT id, actor_id, action, entity_type, entity_id, before_json, after_json, reason, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?",
      [Math.max(1, Math.min(500, Number(limit) || 100))],
    );
    return rows;
  }

  async listTeachersForDigest() {
    const [rows] = await this.pool.execute(
      "SELECT u.id, u.name, u.email FROM users u WHERE u.role = 'teacher' ORDER BY u.name",
    );
    return rows;
  }

  async getTeacherHoursDigest(teacherId, fromUtc, toUtc) {
    const [rows] = await this.pool.execute(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(c.duration_minutes), 0) AS minutes, COUNT(DISTINCT c.id) AS class_count
       FROM schedule_slots s JOIN classes c ON c.id = s.class_id
       WHERE s.teacher_id = ? AND s.status = 'completed' AND s.date_time_utc >= ? AND s.date_time_utc < ?`,
      [teacherId, mysqlUtc(fromUtc), mysqlUtc(toUtc)],
    );
    return { sessions: Number(rows[0].sessions), minutes: Number(rows[0].minutes), classCount: Number(rows[0].class_count) };
  }

  async close() {
    await this.pool.end();
  }

  async saveResetToken({ userId, tokenHash, expiresAt }) {
    await this.pool.execute(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      [randomUUID(), userId, tokenHash, expiresAt],
    );
  }

  async consumeResetToken(tokenHash) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        "SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE",
        [tokenHash],
      );
      if (!rows[0]) {
        await connection.rollback();
        return null;
      }
      await connection.execute("UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?", [rows[0].id]);
      await connection.commit();
      return rows[0];
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async saveInvite({ userId, tokenHash, expiresAt }) {
    await this.pool.execute(
      "INSERT INTO account_invites (id, user_id, invite_token_hash, expires_at) VALUES (?, ?, ?, ?)",
      [randomUUID(), userId, tokenHash, expiresAt],
    );
  }
}

module.exports = { MysqlStore };