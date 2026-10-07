const { randomUUID } = require("node:crypto");

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.teacherProfiles = new Map();
    this.studentProfiles = new Map();
    this.teacherAvailability = new Map();
    this.teacherAvailabilityBlocks = new Map();
    this.resetTokens = new Map();
    this.invites = new Map();
    this.courses = new Map([[
      "00000000-0000-4000-8000-000000000001",
      { id: "00000000-0000-4000-8000-000000000001", title: "Qur’an & Arabic tutoring", description: "General tutoring course for class scheduling.", level: "all", package_options: [] },
    ]]);
    this.classes = new Map();
    this.scheduleSlots = new Map();
    this.auditLog = [];
  }

  async createUser({ role, name, email, passwordHash, timezone = "UTC", level = "beginner", mustResetPassword = false }) {
    const normalizedEmail = email.trim().toLowerCase();
    if ([...this.users.values()].some((user) => user.email === normalizedEmail)) {
      const error = new Error("Email is already in use");
      error.code = "DUPLICATE_EMAIL";
      throw error;
    }
    const user = {
      id: randomUUID(),
      role,
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      status: "active",
      must_reset_password: Boolean(mustResetPassword),
      created_at: new Date(),
    };
    this.users.set(user.id, user);
    if (role === "teacher") this.teacherProfiles.set(user.id, { user_id: user.id, timezone });
    if (role === "student") this.studentProfiles.set(user.id, { user_id: user.id, timezone, level });
    return user;
  }

  async findUserByEmail(email) {
    return [...this.users.values()].find((user) => user.email === email.trim().toLowerCase()) || null;
  }

  async findUserById(id) {
    return this.users.get(id) || null;
  }

  async updateUser(id, changes) {
    const user = this.users.get(id);
    if (!user) return null;
    Object.assign(user, changes);
    return user;
  }

  async getProfile(user) {
    if (user.role === "teacher") return this.teacherProfiles.get(user.id) || null;
    if (user.role === "student") return this.studentProfiles.get(user.id) || null;
    return null;
  }

  async replaceTeacherAvailability(teacherId, windows) {
    for (const [id, window] of this.teacherAvailability) {
      if (window.teacher_id === teacherId) this.teacherAvailability.delete(id);
    }
    const saved = windows.map((window) => {
      const row = {
        id: randomUUID(),
        teacher_id: teacherId,
        day_of_week: window.dayOfWeek,
        start_time_local: window.startTimeLocal,
        end_time_local: window.endTimeLocal,
      };
      this.teacherAvailability.set(row.id, row);
      return row;
    });
    return saved;
  }

  async listTeacherAvailability(teacherId) {
    return [...this.teacherAvailability.values()]
      .filter((window) => window.teacher_id === teacherId)
      .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time_local.localeCompare(b.start_time_local));
  }

  async addTeacherAvailabilityBlock({ teacherId, blockedDateFrom, blockedDateTo, reason }) {
    const row = {
      id: randomUUID(),
      teacher_id: teacherId,
      blocked_date_from: blockedDateFrom,
      blocked_date_to: blockedDateTo,
      reason: reason || null,
    };
    this.teacherAvailabilityBlocks.set(row.id, row);
    return row;
  }

  async listTeacherAvailabilityBlocks(teacherId) {
    return [...this.teacherAvailabilityBlocks.values()]
      .filter((block) => block.teacher_id === teacherId)
      .sort((a, b) => a.blocked_date_from.localeCompare(b.blocked_date_from));
  }

  async deleteTeacherAvailabilityBlock(teacherId, blockId) {
    const block = this.teacherAvailabilityBlocks.get(blockId);
    if (!block || block.teacher_id !== teacherId) return false;
    this.teacherAvailabilityBlocks.delete(blockId);
    return true;
  }

  async listAccountsByRole(role) {
    return [...this.users.values()]
      .filter((user) => user.role === role && user.status === "active")
      .map((user) => {
        const profile = role === "teacher" ? this.teacherProfiles.get(user.id) : this.studentProfiles.get(user.id);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          timezone: profile?.timezone || "UTC",
          level: profile?.level || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listCourses() {
    return [...this.courses.values()];
  }

  async findCourseById(courseId) {
    return this.courses.get(courseId) || null;
  }

  async getTeacherSchedulingProfile(teacherId) {
    const profile = this.teacherProfiles.get(teacherId);
    if (!profile) return null;
    return {
      timezone: profile.timezone || "UTC",
      availability: await this.listTeacherAvailability(teacherId),
      blocks: await this.listTeacherAvailabilityBlocks(teacherId),
    };
  }

  async createClassWithSlots({ studentId, teacherId, courseId, durationMinutes, recurringRule, slots }) {
    const classId = randomUUID();
    for (const slot of slots) {
      const duplicate = [...this.scheduleSlots.values()].some(
        (existing) => existing.teacher_id === teacherId && existing.date_time_utc.getTime() === slot.dateTimeUtc.getTime(),
      );
      if (duplicate) {
        const error = new Error("Teacher already has a slot at this time");
        error.code = "DUPLICATE_SLOT";
        throw error;
      }
    }
    this.classes.set(classId, { id: classId, student_id: studentId, teacher_id: teacherId, course_id: courseId, duration_minutes: durationMinutes, recurring_rule: recurringRule });
    const createdSlots = [];
    for (const slot of slots) {
      const row = {
        id: randomUUID(),
        class_id: classId,
        teacher_id: teacherId,
        date_time_utc: slot.dateTimeUtc,
        status: "upcoming",
        attendance_marked_by: null,
        attendance_marked_at: null,
        attendance_record: null,
      };
      this.scheduleSlots.set(row.id, row);
      createdSlots.push(row);
    }
    return { classId, slots: createdSlots };
  }

  async listActiveClasses() {
    return [...this.classes.values()]
      .filter((row) => this.users.get(row.teacher_id)?.status === "active")
      .map((row) => ({
        ...row,
        duration_minutes: row.duration_minutes || 60,
        teacher_timezone: this.teacherProfiles.get(row.teacher_id)?.timezone || "UTC",
        availability: [...this.teacherAvailability.values()].filter((item) => item.teacher_id === row.teacher_id),
        blocks: [...this.teacherAvailabilityBlocks.values()].filter((item) => item.teacher_id === row.teacher_id),
      }));
  }

  async insertGeneratedSlot({ classId, teacherId, dateTimeUtc }) {
    const duplicate = [...this.scheduleSlots.values()].some(
      (slot) => slot.teacher_id === teacherId && slot.date_time_utc.getTime() === dateTimeUtc.getTime(),
    );
    if (duplicate) return false;
    const row = {
      id: randomUUID(),
      class_id: classId,
      teacher_id: teacherId,
      date_time_utc: dateTimeUtc,
      status: "upcoming",
      attendance_marked_by: null,
      attendance_marked_at: null,
      attendance_record: null,
    };
    this.scheduleSlots.set(row.id, row);
    return true;
  }

  async listSchedule({ role, userId, fromUtc, toUtc }) {
    const from = fromUtc.getTime();
    const to = toUtc.getTime();
    return [...this.scheduleSlots.values()]
      .filter((slot) => {
        if (slot.date_time_utc.getTime() < from || slot.date_time_utc.getTime() > to) return false;
        const classRow = this.classes.get(slot.class_id);
        if (!classRow) return false;
        if (role === "teacher" && classRow.teacher_id !== userId) return false;
        if (role === "student" && classRow.student_id !== userId) return false;
        return true;
      })
      .map((slot) => {
        const classRow = this.classes.get(slot.class_id);
        const teacher = this.users.get(classRow.teacher_id);
        const student = this.users.get(classRow.student_id);
        const course = this.courses.get(classRow.course_id);
        return {
          id: slot.id,
          classId: classRow.id,
          teacherId: teacher.id,
          teacherName: teacher.name,
          teacherTimezone: this.teacherProfiles.get(teacher.id)?.timezone || "UTC",
          studentId: student.id,
          studentName: student.name,
          studentTimezone: this.studentProfiles.get(student.id)?.timezone || "UTC",
          courseTitle: course?.title || "Tutoring",
          dateTimeUtc: slot.date_time_utc.toISOString(),
          status: slot.status,
          attendanceRecord: slot.attendance_record,
          attendanceMarkedAt: slot.attendance_marked_at?.toISOString() || null,
          zoomLink: classRow.zoom_link || null,
          linkLocked: classRow.link_locked !== false,
        };
      })
      .sort((a, b) => a.dateTimeUtc.localeCompare(b.dateTimeUtc));
  }

  async findScheduleSlot(slotId) {
    const slot = this.scheduleSlots.get(slotId);
    if (!slot) return null;
    const classRow = this.classes.get(slot.class_id);
    return classRow ? { ...slot, student_id: classRow.student_id } : null;
  }

  async recordTeacherAttendance({ slotId, teacherId, attendanceRecord, now = new Date() }) {
    const slot = this.scheduleSlots.get(slotId);
    if (!slot) return null;
    if (slot.teacher_id !== teacherId) {
      const error = new Error("Slot is not assigned to this teacher");
      error.code = "FORBIDDEN";
      throw error;
    }
    if (slot.status !== "upcoming" || slot.date_time_utc > now || now > new Date(slot.date_time_utc.getTime() + 24 * 60 * 60 * 1000)) {
      const error = new Error("Attendance can only be marked from the scheduled start through 24 hours after");
      error.code = "MARK_WINDOW_CLOSED";
      throw error;
    }
    slot.attendance_record = attendanceRecord;
    slot.attendance_marked_by = teacherId;
    slot.attendance_marked_at = now;
    slot.status = attendanceRecord === "present" ? "completed" : "no_show_unexcused";
    return slot;
  }

  async overrideAttendance({ slotId, actorId, attendanceRecord, reason, now = new Date() }) {
    const slot = this.scheduleSlots.get(slotId);
    if (!slot) return null;
    const before = { status: slot.status, attendance_record: slot.attendance_record, attendance_marked_by: slot.attendance_marked_by };
    slot.attendance_record = attendanceRecord;
    slot.attendance_marked_by = actorId;
    slot.attendance_marked_at = now;
    slot.status = attendanceRecord === "present" ? "completed" : attendanceRecord === "no_show" ? "no_show_unexcused" : "excused_absence";
    this.auditLog.push({
      id: randomUUID(),
      actor_id: actorId,
      action: "attendance.override",
      entity_type: "schedule_slot",
      entity_id: slotId,
      before_json: before,
      after_json: { status: slot.status, attendance_record: slot.attendance_record, attendance_marked_by: actorId },
      reason,
      created_at: now,
    });
    return slot;
  }

  async markPastUnmarkedSlotsPendingReview(now = new Date()) {
    let updated = 0;
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    for (const slot of this.scheduleSlots.values()) {
      if (slot.status === "upcoming" && !slot.attendance_record && slot.date_time_utc.getTime() <= cutoff) {
        slot.status = "pending_review";
        updated += 1;
      }
    }
    return updated;
  }

  async setTeacherStatusAndReassignFuture({ teacherId, actorId, status, reason, now = new Date() }) {
    const teacher = this.users.get(teacherId);
    if (!teacher || teacher.role !== "teacher") return null;
    const before = { status: teacher.status };
    teacher.status = status;
    let reassignedCount = 0;
    if (status === "suspended") {
      for (const slot of this.scheduleSlots.values()) {
        if (slot.teacher_id === teacherId && slot.status === "upcoming" && slot.date_time_utc > now) {
          slot.status = "needs_reassignment";
          reassignedCount += 1;
        }
      }
    }
    this.auditLog.push({
      id: randomUUID(),
      actor_id: actorId,
      action: status === "suspended" ? "account.suspend" : "account.reactivate",
      entity_type: "user",
      entity_id: teacherId,
      before_json: before,
      after_json: { status, reassignedCount },
      reason,
      created_at: now,
    });
    return { user: teacher, reassignedCount };
  }

  async listAuditLog(limit = 100) {
    return this.auditLog.slice(-limit).reverse();
  }

  async listTeachersForDigest() {
    return [...this.users.values()]
      .filter((user) => user.role === "teacher" && user.status === "active")
      .map((user) => ({ id: user.id, name: user.name, email: user.email }));
  }

  async getTeacherHoursDigest(teacherId, fromUtc, toUtc) {
    const lessons = [...this.scheduleSlots.values()].filter((slot) => {
      if (slot.teacher_id !== teacherId || slot.status !== "completed") return false;
      return slot.date_time_utc >= fromUtc && slot.date_time_utc < toUtc;
    });
    const classIds = new Set(lessons.map((slot) => slot.class_id));
    const minutes = lessons.reduce((sum, slot) => sum + (this.classes.get(slot.class_id)?.duration_minutes || 60), 0);
    return { sessions: lessons.length, minutes, classCount: classIds.size };
  }

  async saveResetToken({ userId, tokenHash, expiresAt }) {
    this.resetTokens.set(tokenHash, { id: randomUUID(), user_id: userId, token_hash: tokenHash, expires_at: expiresAt, used_at: null });
  }

  async consumeResetToken(tokenHash) {
    const token = this.resetTokens.get(tokenHash);
    if (!token || token.used_at || token.expires_at < new Date()) return null;
    token.used_at = new Date();
    return token;
  }

  async saveInvite({ userId, tokenHash, expiresAt }) {
    this.invites.set(tokenHash, { id: randomUUID(), user_id: userId, invite_token_hash: tokenHash, expires_at: expiresAt, accepted_at: null });
  }
}

module.exports = { MemoryStore };