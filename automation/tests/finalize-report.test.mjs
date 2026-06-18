import { test, expect } from 'vitest';
import { buildSummaryMarkdown, resolveWorkshop } from '../finalize-report.mjs';

test('summary markdown contains workshop name, set count, finalVotes', () => {
  const stats = { workshop: '2차_의제선정', date: '2026-08-29', captureSets: 105, snapshotCount: 530, finalVotes: 230 };
  const md = buildSummaryMarkdown(stats);
  expect(md).toContain('2차_의제선정');
  expect(md).toContain('2026-08-29');
  expect(md).toContain('105');
  expect(md).toContain('230');
});

test('flags missing sets when below 95% of expected', () => {
  const stats = { workshop: 'x', date: 'x', captureSets: 90, expectedSets: 108, snapshotCount: 500, finalVotes: 200 };
  const md = buildSummaryMarkdown(stats);
  expect(md).toMatch(/누락.*16\.7%|누락.*16%/);
});

test('does not flag when missing is within 5% threshold', () => {
  const stats = { workshop: 'x', date: 'x', captureSets: 104, expectedSets: 108, snapshotCount: 500, finalVotes: 200 };
  const md = buildSummaryMarkdown(stats);
  expect(md).not.toMatch(/누락/);
});

test('resolveWorkshop uses explicit name when provided', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: '2차', now: new Date('2026-08-30T13:00:00Z') });
  expect(out?.name).toBe('2차');
});

test('resolveWorkshop auto-detects yesterday-KST workshop when name not given', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: null, now: new Date('2026-08-29T19:00:00Z') });
  expect(out?.name).toBe('2차');
});

test('resolveWorkshop auto-detects today-KST workshop when running same day late evening', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: null, now: new Date('2026-08-29T13:00:00Z') });
  expect(out?.name).toBe('2차');
});

test('resolveWorkshop returns null when no matching date', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: null, now: new Date('2026-12-01T13:00:00Z') });
  expect(out).toBeNull();
});
