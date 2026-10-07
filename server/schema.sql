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

CREATE TABLE IF NOT EXISTS courses (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  level VARCHAR(32) NOT NULL DEFAULT 'all',
  package_options JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO courses (id, title, description, level, package_options)
VALUES ('00000000-0000-4000-8000-000000000001', 'Qur’an & Arabic tutoring', 'General tutoring course for class scheduling.', 'all', JSON_ARRAY())
ON DUPLICATE KEY UPDATE title = VALUES(title);

CREATE TABLE IF NOT EXISTS classes (
  id CHAR(36) PRIMARY KEY,
  student_id CHAR(36) NOT NULL,
  teacher_id CHAR(36) NOT NULL,
  course_id CHAR(36) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  recurring_rule TEXT NOT NULL,
  zoom_link TEXT NULL,
  link_locked BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_class_student FOREIGN KEY (student_id) REFERENCES users(id),
  CONSTRAINT fk_class_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_class_course FOREIGN KEY (course_id) REFERENCES courses(id),
  INDEX idx_classes_teacher (teacher_id),
  INDEX idx_classes_student (student_id)
);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id CHAR(36) PRIMARY KEY,
  class_id CHAR(36) NOT NULL,
  teacher_id CHAR(36) NOT NULL,
  date_time_utc DATETIME NOT NULL,
  status ENUM('upcoming', 'completed', 'no_show_unexcused', 'excused_absence', 'cancelled', 'pending_review', 'needs_reassignment') NOT NULL DEFAULT 'upcoming',
  attendance_marked_by CHAR(36) NULL,
  attendance_marked_at DATETIME NULL,
  attendance_record ENUM('present', 'no_show', 'excused') NULL,
  CONSTRAINT fk_slot_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_slot_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_slot_attendance_actor FOREIGN KEY (attendance_marked_by) REFERENCES users(id),
  UNIQUE KEY uq_teacher_slot_time (teacher_id, date_time_utc),
  INDEX idx_slots_watchdog (status, date_time_utc),
  INDEX idx_slots_class_date (class_id, date_time_utc)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_created (created_at)
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