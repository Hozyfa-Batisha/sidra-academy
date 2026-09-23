const { randomUUID } = require("node:crypto");

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.teacherProfiles = new Map();
    this.studentProfiles = new Map();
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