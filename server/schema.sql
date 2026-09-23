CREATE DATABASE IF NOT EXISTS sidra_academy
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sidra_academy;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  role ENUM('admin', 'teacher', 'student') NOT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  must_reset_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_status (status)
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  user_id CHAR(36) PRIMARY KEY,
  bio TEXT NULL,
  subjects JSON NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  CONSTRAINT fk_teacher_profile_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id CHAR(36) PRIMARY KEY,
  level ENUM('beginner', 'intermediate', 'advanced') NOT NULL DEFAULT 'beginner',
  notes TEXT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  country VARCHAR(100) NULL,
  CONSTRAINT fk_student_profile_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teacher_availability (
  id CHAR(36) PRIMARY KEY,
  teacher_id CHAR(36) NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  start_time_local TIME NOT NULL,
  end_time_local TIME NOT NULL,
  CONSTRAINT fk_teacher_availability_user
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_teacher_availability_day CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_teacher_availability_order CHECK (start_time_local < end_time_local),
  UNIQUE KEY uq_teacher_availability_window (teacher_id, day_of_week, start_time_local, end_time_local),
  INDEX idx_teacher_availability_lookup (teacher_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS teacher_availability_blocks (
  id CHAR(36) PRIMARY KEY,
  teacher_id CHAR(36) NOT NULL,
  blocked_date_from DATE NOT NULL,
  blocked_date_to DATE NOT NULL,
  reason VARCHAR(255) NULL,
  CONSTRAINT fk_teacher_availability_block_user
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_teacher_availability_block_order CHECK (blocked_date_from <= blocked_date_to),
  INDEX idx_teacher_availability_blocks_lookup (teacher_id, blocked_date_from, blocked_date_to)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reset_token_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reset_token_lookup (token_hash, used_at, expires_at)
);

CREATE TABLE IF NOT EXISTS account_invites (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  invite_token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invite_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_invite_lookup (invite_token_hash, accepted_at, expires_at)
);