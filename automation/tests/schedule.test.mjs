import { test, expect } from 'vitest';
import { findActiveWorkshop } from '../lib/schedule.mjs';

const schedule = {
  workshops: [
    { date: '2026-08-29', name: '2차', start_kst: '09:00', end_kst: '18:00' }
  ]
};

test('returns workshop when today matches (string date)', () => {
  const now = new Date('2026-08-29T05:00:00Z'); // KST 14:00
  expect(findActiveWorkshop(schedule, now)?.name).toBe('2차');
});

test('returns workshop when date is a Date object (js-yaml parsed)', () => {
  const dateSchedule = {
    workshops: [
      { date: new Date('2026-08-29T00:00:00Z'), name: '2차', start_kst: '09:00', end_kst: '18:00' }
    ]
  };
  const now = new Date('2026-08-29T05:00:00Z');
  expect(findActiveWorkshop(dateSchedule, now)?.name).toBe('2차');
});

test('returns null when today does not match', () => {
  const now = new Date('2026-08-28T05:00:00Z');
  expect(findActiveWorkshop(schedule, now)).toBeNull();
});

test('returns null when outside workshop hours (before start)', () => {
  const now = new Date('2026-08-28T23:00:00Z'); // KST 08:00 on 8/29
  expect(findActiveWorkshop(schedule, now)).toBeNull();
});

test('returns null when outside workshop hours (after end)', () => {
  const now = new Date('2026-08-29T10:00:00Z'); // KST 19:00 on 8/29
  expect(findActiveWorkshop(schedule, now)).toBeNull();
});

test('loadSchedule parses workshop-schedule.yml from disk', async () => {
  const { loadSchedule } = await import('../lib/schedule.mjs');
  const { fileURLToPath } = await import('node:url');
  const p = fileURLToPath(new URL('../workshop-schedule.yml', import.meta.url));
  const s = await loadSchedule(p);
  expect(s.pages).toHaveLength(4);
  expect(s.workshops).toHaveLength(2);
});
