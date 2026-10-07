const { DateTime } = require("luxon");
const { expandSchedule } = require("./scheduling");

async function generateRollingSlots(store, now = new Date()) {
  const classes = await store.listActiveClasses();
  let inserted = 0;
  let conflicts = 0;
  let skipped = 0;
  for (const classRow of classes) {
    const profile = await store.getTeacherSchedulingProfile(classRow.teacher_id);
    if (!profile) {
      skipped += 1;
      continue;
    }
    const candidates = expandSchedule({
      ruleText: classRow.recurring_rule,
      timezone: profile.timezone,
      availability: profile.availability,
      blocks: profile.blocks,
      durationMinutes: Number(classRow.duration_minutes || 60),
      now,
    });
    for (const slot of candidates) {
      const created = await store.insertGeneratedSlot({
        classId: classRow.id,
        teacherId: classRow.teacher_id,
        dateTimeUtc: slot.dateTimeUtc,
      });
      if (created) inserted += 1;
      else conflicts += 1;
    }
  }
  return { classes: classes.length, inserted, conflicts, skipped };
}

async function markUnattendedSlotsForReview(store, now = new Date()) {
  const count = await store.markPastUnmarkedSlotsPendingReview(now);
  return { pendingReview: count, checkedAt: now.toISOString() };
}

async function sendTeacherHoursDigests(store, { now = new Date(), transportFactory } = {}) {
  const previousMonth = DateTime.fromJSDate(now, { zone: "utc" }).startOf("month").minus({ months: 1 });
  const fromUtc = previousMonth.toJSDate();
  const toUtc = previousMonth.plus({ months: 1 }).toJSDate();
  const teachers = await store.listTeachersForDigest();
  if (!process.env.SMTP_URL || !process.env.MAIL_FROM) {
    console.warn("Monthly teacher-hours digest skipped: SMTP_URL and MAIL_FROM are not configured.");
    return { month: previousMonth.toFormat("yyyy-MM"), teachers: teachers.length, sent: 0, skipped: true };
  }
  const nodemailer = require("nodemailer");
  const transporter = (transportFactory || nodemailer.createTransport)(process.env.SMTP_URL);
  let sent = 0;
  for (const teacher of teachers) {
    const digest = await store.getTeacherHoursDigest(teacher.id, fromUtc, toUtc);
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: teacher.email,
      subject: `Sidra Academy teaching summary — ${previousMonth.toFormat("LLLL yyyy")}`,
      text: `Hello ${teacher.name},\n\nYour confirmed teaching summary for ${previousMonth.toFormat("LLLL yyyy")}:\n${digest.sessions} completed sessions\n${(digest.minutes / 60).toFixed(1)} confirmed teaching hours\n\nThis is informational; salary remains managed separately by the academy.`,
    });
    sent += 1;
  }
  return { month: previousMonth.toFormat("yyyy-MM"), teachers: teachers.length, sent, skipped: false };
}

module.exports = { generateRollingSlots, markUnattendedSlotsForReview, sendTeacherHoursDigests };
