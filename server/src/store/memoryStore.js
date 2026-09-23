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