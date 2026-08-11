import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { test, expect } from 'vitest';
import {
  captureCronForWorkshop,
  finalizeCronForWorkshop,
  findActiveWorkshop,
  loadSchedule,
  snapshotCronForWorkshop,
  validateSchedule,
} from '../lib/schedule.mjs';

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
  const p = fileURLToPath(new URL('../workshop-schedule.yml', import.meta.url));
  const s = await loadSchedule(p);
  expect(s.pages).toHaveLength(4);
  expect(s.workshops).toHaveLength(5);
  expect(s.workshops.every((workshop) => !('drive_folder_root' in workshop))).toBe(true);
});

test('archive workflows cover every workshop in the canonical schedule', async () => {
  const schedulePath = fileURLToPath(new URL('../workshop-schedule.yml', import.meta.url));
  const schedule = await loadSchedule(schedulePath);
  const captureWorkflow = yaml.load(readFileSync(
    new URL('../../.github/workflows/capture.yml', import.meta.url),
    'utf8',
  ));
  const finalizeWorkflow = yaml.load(readFileSync(
    new URL('../../.github/workflows/finalize.yml', import.meta.url),
    'utf8',
  ));
  const snapshotWorkflow = yaml.load(readFileSync(
    new URL('../../.github/workflows/snapshot.yml', import.meta.url),
    'utf8',
  ));
  const captureCrons = captureWorkflow.on.schedule.map((entry) => entry.cron);
  const finalizeCrons = finalizeWorkflow.on.schedule.map((entry) => entry.cron);
  const snapshotCrons = snapshotWorkflow.on.schedule.map((entry) => entry.cron);

  expect(captureCrons).toEqual(schedule.workshops.map((workshop) => captureCronForWorkshop(workshop)));
  expect(finalizeCrons).toEqual(schedule.workshops.map((workshop) => finalizeCronForWorkshop(workshop)));
  expect(snapshotCrons).toEqual(schedule.workshops.map((workshop) => snapshotCronForWorkshop(workshop)));
  expect(snapshotCrons.every((cron) => cron.startsWith('*/5 '))).toBe(true);
  expect(captureWorkflow.concurrency).toBeUndefined();
  expect(snapshotWorkflow.concurrency).toBeUndefined();
  const finalizeStep = finalizeWorkflow.jobs.finalize.steps.find((step) => step.name === 'Finalize report');
  expect(finalizeStep.env.SCHEDULED).toBe("${{ github.event_name == 'schedule' }}");
  for (const workshop of schedule.workshops) {
    const mapping = `(github.event.schedule == '${finalizeCronForWorkshop(workshop)}' && '${workshop.name}')`;
    expect(finalizeWorkflow.concurrency.group).toContain(mapping);
    expect(finalizeStep.env.WORKSHOP).toContain(mapping);
  }
});

test('rejects invalid calendar dates, times, and off-grid capture windows', () => {
  expect(() => captureCronForWorkshop({
    date: '2026-02-30',
    start_kst: '09:00',
    end_kst: '18:00',
  })).toThrow('invalid workshop date');
  expect(() => captureCronForWorkshop({
    date: '2026-08-29',
    start_kst: '24:00',
    end_kst: '18:00',
  })).toThrow('invalid workshop time');
  expect(() => captureCronForWorkshop({
    date: '2026-08-29',
    start_kst: '09:03',
    end_kst: '18:00',
  })).toThrow('workshop capture times must align to five minutes');
  expect(() => captureCronForWorkshop({
    date: '2026-08-29',
    start_kst: '18:00',
    end_kst: '09:00',
  })).toThrow('workshop end time precedes start time');
  expect(() => captureCronForWorkshop({
    date: '2026-08-29',
    start_kst: '08:00',
    end_kst: '09:00',
  })).toThrow('capture cron requires a single UTC date');
});

test('rejects incomplete, duplicate, and unordered canonical workshop rows', () => {
  const row = {
    date: '2026-08-29',
    name: '2차',
    start_kst: '09:00',
    end_kst: '18:00',
    supabase_round_id: 3,
  };
  expect(() => validateSchedule({ workshops: [{ ...row, name: '' }] }))
    .toThrow('invalid workshop name');
  expect(() => validateSchedule({ workshops: [{ ...row, supabase_round_id: 0 }] }))
    .toThrow('invalid workshop round id');
  expect(() => validateSchedule({ workshops: [row, { ...row, name: 'duplicate-date' }] }))
    .toThrow('duplicate workshop date');
  expect(() => validateSchedule({
    workshops: [row, { ...row, date: '2026-08-30' }],
  })).toThrow('duplicate workshop name');
  expect(() => validateSchedule({
    workshops: [
      { ...row, date: '2026-08-30', name: 'later' },
      { ...row, date: '2026-08-29', name: 'earlier' },
    ],
  })).toThrow('workshop dates must be strictly increasing');
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
