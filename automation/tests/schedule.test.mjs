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
  expect(s.workshops).toHaveLength(5);
});

// 법정 의결일 커버리지 검증 — 9/12·9/13·10/17이 findActiveWorkshop에서 active 반환되는지 확인
const legalSchedule = {
  workshops: [
    { date: '2026-09-12', name: '6차_분과권고안의결_경주합숙1일차', start_kst: '09:00', end_kst: '21:00' },
    { date: '2026-09-13', name: '7차_분과권고안의결_경주합숙2일차', start_kst: '09:00', end_kst: '18:00' },
    { date: '2026-10-17', name: '8차_전체법정의결', start_kst: '09:00', end_kst: '18:00' },
  ]
};

test('findActiveWorkshop matches 9/12 (6차 경주 1일차) KST 14:00', () => {
  const now = new Date('2026-09-12T05:00:00Z'); // KST 14:00
  expect(findActiveWorkshop(legalSchedule, now)?.name).toBe('6차_분과권고안의결_경주합숙1일차');
});

test('findActiveWorkshop matches 9/12 late (end_kst 21:00) KST 20:30', () => {
  const now = new Date('2026-09-12T11:30:00Z'); // KST 20:30
  expect(findActiveWorkshop(legalSchedule, now)?.name).toBe('6차_분과권고안의결_경주합숙1일차');
});

test('findActiveWorkshop matches 9/13 (7차 경주 2일차) KST 14:00', () => {
  const now = new Date('2026-09-13T05:00:00Z'); // KST 14:00
  expect(findActiveWorkshop(legalSchedule, now)?.name).toBe('7차_분과권고안의결_경주합숙2일차');
});

test('findActiveWorkshop matches 10/17 (8차 전체 법정 의결) KST 14:00', () => {
  const now = new Date('2026-10-17T05:00:00Z'); // KST 14:00
  expect(findActiveWorkshop(legalSchedule, now)?.name).toBe('8차_전체법정의결');
});

test('findActiveWorkshop returns null on 10/16 (법정의결 전날)', () => {
  const now = new Date('2026-10-16T05:00:00Z'); // KST 14:00 on 10/16
  expect(findActiveWorkshop(legalSchedule, now)).toBeNull();
});
