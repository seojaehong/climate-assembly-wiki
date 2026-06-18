import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

function normalizeDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
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
