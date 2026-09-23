const mysql = require("mysql2/promise");
const { randomUUID } = require("node:crypto");

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