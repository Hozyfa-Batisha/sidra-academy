const { DateTime } = require("luxon");
const { RRule } = require("rrule");

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_CODES = Object.fromEntries(WEEKDAY_CODES.map((day, index) => [day, index]));
const HORIZON_DAYS = 56;

function parseLocalDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) {
    throw new Error("Use a valid local date and HH:MM time");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const dt = DateTime.utc(year, month, day, hour, minute);
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd HH:mm") !== `${date} ${time}`) throw new Error("Invalid local date or time");
  return dt.toJSDate();
}

function buildWeeklyRule({ startDate, startTime, daysOfWeek }) {
  if (!Array.isArray(daysOfWeek) || !daysOfWeek.length) throw new Error("Choose at least one recurring weekday");
  const normalized = [...new Set(daysOfWeek.map(Number))].sort((a, b) => a - b);
  if (normalized.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Weekdays must be integers from 0 (Sunday) to 6 (Saturday)");
  const dtstart = parseLocalDateTime(startDate, startTime);
  if (!normalized.includes(dtstart.getUTCDay())) throw new Error("The start date must be one of the selected recurring weekdays");
  const dayCodes = normalized.map((day) => WEEKDAY_CODES[day]).join(",");
  const dtstartString = `${startDate.replaceAll("-", "")}T${startTime.replace(":", "")}00`;
  return `DTSTART:${dtstartString}\nRRULE:FREQ=WEEKLY;BYDAY=${dayCodes}`;
}

function parseWeeklyRule(ruleText) {
  if (typeof ruleText !== "string") throw new Error("Recurring rule is required");
  const lines = ruleText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dtstartLine = lines.find((line) => line.startsWith("DTSTART:"));
  const rruleLine = lines.find((line) => line.startsWith("RRULE:"));
  const start = dtstartLine?.slice("DTSTART:".length).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!start || !rruleLine) throw new Error("Recurring rule must have a floating local DTSTART and RRULE");
  const dtstart = DateTime.utc(Number(start[1]), Number(start[2]), Number(start[3]), Number(start[4]), Number(start[5]), Number(start[6]));
  if (!dtstart.isValid) throw new Error("Recurring rule has an invalid DTSTART");
  const options = RRule.parseString(rruleLine.slice("RRULE:".length));
  if (options.freq !== RRule.WEEKLY || !options.byweekday?.length) throw new Error("Only weekly rules with BYDAY are supported");
  const weekdays = options.byweekday.map((weekday) => {
    const dayCode = weekday.toString().toUpperCase();
    const rruleWeekday = WEEKDAY_CODES.indexOf(dayCode);
    return rruleWeekday >= 0 ? rruleWeekday : DAY_CODES[dayCode];
  });
  if (weekdays.some((day) => day === undefined)) throw new Error("Recurring rule contains an unsupported BYDAY value");
  return { dtstart: dtstart.toJSDate(), options, weekdays, startTime: dtstart.toFormat("HH:mm"), startDate: dtstart.toFormat("yyyy-MM-dd") };
}

function floatingDate(dateTimeUtc) {
  return new Date(Date.UTC(dateTimeUtc.getUTCFullYear(), dateTimeUtc.getUTCMonth(), dateTimeUtc.getUTCDate()));
}

function toUtcInstant(fakeLocalDate, timeZone) {
  const target = {
    year: fakeLocalDate.getUTCFullYear(),
    month: fakeLocalDate.getUTCMonth() + 1,
    day: fakeLocalDate.getUTCDate(),
    hour: fakeLocalDate.getUTCHours(),
    minute: fakeLocalDate.getUTCMinutes(),
    second: 0,
    millisecond: 0,
  };
  const zoned = DateTime.fromObject(target, { zone: timeZone });
  if (!zoned.isValid || zoned.year !== target.year || zoned.month !== target.month || zoned.day !== target.day || zoned.hour !== target.hour || zoned.minute !== target.minute) {
    return null;
  }
  return zoned.toUTC().toJSDate();
}

function formatTime(dateTime) {
  return `${String(dateTime.getUTCHours()).padStart(2, "0")}:${String(dateTime.getUTCMinutes()).padStart(2, "0")}`;
}

function withinAvailability(availability, dayOfWeek, startTime, durationMinutes) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = startMinutes + durationMinutes;
  if (endMinutes > 24 * 60) return false;
  const windows = availability.filter((window) => Number(window.day_of_week) === dayOfWeek);
  return windows.some((window) => {
    const [windowStartHour, windowStartMinute] = window.start_time_local.split(":").map(Number);
    const [windowEndHour, windowEndMinute] = window.end_time_local.split(":").map(Number);
    return startMinutes >= windowStartHour * 60 + windowStartMinute && endMinutes <= windowEndHour * 60 + windowEndMinute;
  });
}

function dateBlocked(blocks, date) {
  return blocks.some((block) => block.blocked_date_from <= date && block.blocked_date_to >= date);
}

function expandSchedule({ ruleText, timezone, availability, blocks, durationMinutes, now = new Date(), horizonDays = HORIZON_DAYS }) {
  const rule = parseWeeklyRule(ruleText);
  const localNow = DateTime.fromJSDate(now, { zone: "utc" }).setZone(timezone);
  if (!localNow.isValid) throw new Error("Teacher timezone is not a valid IANA zone");
  const startOfRange = DateTime.utc(localNow.year, localNow.month, localNow.day).toJSDate();
  const endRange = DateTime.utc(localNow.year, localNow.month, localNow.day).plus({ days: horizonDays }).toJSDate();
  const recurrence = new RRule({ ...rule.options, dtstart: rule.dtstart });
  const occurrences = recurrence.between(startOfRange, endRange, true);
  const slots = [];
  for (const fakeLocal of occurrences) {
    const date = `${fakeLocal.getUTCFullYear()}-${String(fakeLocal.getUTCMonth() + 1).padStart(2, "0")}-${String(fakeLocal.getUTCDate()).padStart(2, "0")}`;
    const time = formatTime(fakeLocal);
    const dayOfWeek = fakeLocal.getUTCDay();
    if (fakeLocal.getTime() < rule.dtstart.getTime() || dateBlocked(blocks, date)) continue;
    if (!withinAvailability(availability, dayOfWeek, time, durationMinutes)) continue;
    const startUtc = toUtcInstant(fakeLocal, timezone);
    if (!startUtc || startUtc <= now) continue;
    slots.push({ date, time, dateTimeUtc: startUtc, dayOfWeek });
  }
  return slots;
}

function getLocalDayDate(date, timeZone) {
  const local = DateTime.fromJSDate(date, { zone: "utc" }).setZone(timeZone);
  return local.toFormat("yyyy-MM-dd");
}

module.exports = {
  WEEKDAY_CODES,
  DAY_CODES,
  HORIZON_DAYS,
  parseLocalDateTime,
  buildWeeklyRule,
  parseWeeklyRule,
  expandSchedule,
  toUtcInstant,
  withinAvailability,
  dateBlocked,
  getLocalDayDate,
};
