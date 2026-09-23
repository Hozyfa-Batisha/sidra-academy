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