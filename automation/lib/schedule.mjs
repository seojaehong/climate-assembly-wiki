import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

export function normalizeDate(d) {
  let date;
  if (d instanceof Date) {
    if (!Number.isFinite(d.getTime())
      || d.getUTCHours() !== 0
      || d.getUTCMinutes() !== 0
      || d.getUTCSeconds() !== 0
      || d.getUTCMilliseconds() !== 0) {
      throw new Error('invalid workshop date');
    }
    date = d.toISOString().slice(0, 10);
  } else {
    date = String(d);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid workshop date');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('invalid workshop date');
  }
  return date;
}

function workshopInstant(date, time) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error('invalid workshop time');
  }
  const instant = Date.parse(`${normalizeDate(date)}T${time}:00+09:00`);
  if (!Number.isFinite(instant)) throw new Error('invalid workshop time');
  return instant;
}

function sameUtcDate(first, second) {
  return first.getUTCFullYear() === second.getUTCFullYear()
    && first.getUTCMonth() === second.getUTCMonth()
    && first.getUTCDate() === second.getUTCDate();
}

function snapshotEndInstant(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00\+09:00$/.exec(value ?? '');
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) {
    throw new Error('invalid snapshot end');
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('invalid snapshot end');
  const normalizedKst = new Date(instant + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
  if (normalizedKst !== `${match[1]}T${match[2]}:${match[3]}:00`) {
    throw new Error('invalid snapshot end');
  }
  return instant;
}

export function captureCronForWorkshop(workshop) {
  const start = new Date(workshopInstant(workshop.date, workshop.start_kst));
  const end = new Date(workshopInstant(workshop.date, workshop.end_kst));
  if (end < start) throw new Error('workshop end time precedes start time');
  if (start.getUTCMinutes() % 5 !== 0 || end.getUTCMinutes() % 5 !== 0) {
    throw new Error('workshop capture times must align to five minutes');
  }
  if (!sameUtcDate(start, end)) throw new Error('capture cron requires a single UTC date');
  return `*/5 ${start.getUTCHours()}-${end.getUTCHours()} ${start.getUTCDate()} ${start.getUTCMonth() + 1} *`;
}

export function snapshotCronForWorkshop(workshop) {
  if (workshop.snapshot_until_kst === undefined) return captureCronForWorkshop(workshop);
  const start = new Date(workshopInstant(workshop.date, workshop.start_kst));
  const endExclusive = new Date(snapshotEndInstant(workshop.snapshot_until_kst));
  if (endExclusive <= start) {
    throw new Error('invalid snapshot end');
  }
  const lastRun = new Date(endExclusive.getTime() - 5 * 60 * 1000);
  if (start.getUTCMinutes() % 5 !== 0 || lastRun.getUTCMinutes() % 5 !== 0) {
    throw new Error('workshop snapshot times must align to five minutes');
  }
  if (!sameUtcDate(start, lastRun)) {
    throw new Error('snapshot cron requires a single UTC date');
  }
  const startHour = start.getUTCHours();
  const endHour = lastRun.getUTCHours();
  const hours = startHour === 0 && endHour === 23 ? '*' : `${startHour}-${endHour}`;
  return `*/5 ${hours} ${start.getUTCDate()} ${start.getUTCMonth() + 1} *`;
}

export function finalizeCronForWorkshop(workshop, delayHours = 4) {
  if (!Number.isSafeInteger(delayHours) || delayHours < 0) {
    throw new Error('invalid finalize delay');
  }
  const end = workshopInstant(workshop.date, workshop.end_kst);
  const finalizeAt = new Date(end + delayHours * 60 * 60 * 1000);
  return `${finalizeAt.getUTCMinutes()} ${finalizeAt.getUTCHours()} ${finalizeAt.getUTCDate()} ${finalizeAt.getUTCMonth() + 1} *`;
}

export function expectedCaptureTimestamps(workshop, intervalMinutes = 5) {
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error(`invalid capture interval: ${intervalMinutes}`);
  }
  captureCronForWorkshop(workshop);
  const start = workshopInstant(workshop.date, workshop.start_kst);
  const end = workshopInstant(workshop.date, workshop.end_kst);
  if (end < start) throw new Error('workshop end time precedes start time');
  const intervalMs = intervalMinutes * 60_000;
  const timestamps = [];
  for (let instant = start; instant <= end; instant += intervalMs) {
    timestamps.push(new Date(instant).toISOString().slice(0, 16).replace(/:/g, '-'));
  }
  return timestamps;
}

export function findActiveWorkshop(schedule, now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const hhmm = kst.toISOString().slice(11, 16);
  const ws = schedule.workshops.find(w => normalizeDate(w.date) === today);
  if (!ws) return null;
  if (hhmm < ws.start_kst || hhmm > ws.end_kst) return null;
  return ws;
}

export function findActiveSnapshotWorkshop(schedule, now = new Date()) {
  const extended = schedule.workshops.find((workshop) => {
    if (workshop.snapshot_until_kst === undefined) return false;
    snapshotCronForWorkshop(workshop);
    const start = workshopInstant(workshop.date, workshop.start_kst);
    const endExclusive = snapshotEndInstant(workshop.snapshot_until_kst);
    return now.getTime() >= start && now.getTime() < endExclusive;
  });
  return extended ?? findActiveWorkshop(schedule, now);
}

export function validateSchedule(schedule) {
  if (!schedule || !Array.isArray(schedule.workshops) || schedule.workshops.length === 0) {
    throw new Error('invalid workshop schedule');
  }
  const dates = new Set();
  const names = new Set();
  let previousDate = null;
  for (const workshop of schedule.workshops) {
    if (typeof workshop.name !== 'string' || workshop.name.trim().length === 0) {
      throw new Error('invalid workshop name');
    }
    if (!Number.isSafeInteger(workshop.supabase_round_id) || workshop.supabase_round_id <= 0) {
      throw new Error('invalid workshop round id');
    }
    const date = normalizeDate(workshop.date);
    if (dates.has(date)) throw new Error('duplicate workshop date');
    if (names.has(workshop.name)) throw new Error('duplicate workshop name');
    if (previousDate !== null && date <= previousDate) {
      throw new Error('workshop dates must be strictly increasing');
    }
    captureCronForWorkshop(workshop);
    snapshotCronForWorkshop(workshop);
    dates.add(date);
    names.add(workshop.name);
    previousDate = date;
  }
  return schedule;
}

export async function loadSchedule(path = 'workshop-schedule.yml') {
  const raw = await readFile(path, 'utf8');
  return validateSchedule(yaml.load(raw));
}
