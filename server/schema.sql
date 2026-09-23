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