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
