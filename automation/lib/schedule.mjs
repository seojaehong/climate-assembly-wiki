import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

export function normalizeDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

function workshopInstant(date, time) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`invalid workshop time: ${time}`);
  const instant = Date.parse(`${normalizeDate(date)}T${time}:00+09:00`);
  if (!Number.isFinite(instant)) throw new Error(`invalid workshop time: ${time}`);
  return instant;
}

export function expectedCaptureTimestamps(workshop, intervalMinutes = 5) {
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error(`invalid capture interval: ${intervalMinutes}`);
  }
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

export async function loadSchedule(path = 'workshop-schedule.yml') {
  const raw = await readFile(path, 'utf8');
  return yaml.load(raw);
}
