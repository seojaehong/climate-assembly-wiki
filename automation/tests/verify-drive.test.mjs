import { test, expect } from 'vitest';
import { evaluateCoverage } from '../scripts/verify-drive.mjs';

test('within 5% missing → ok', () => {
  expect(evaluateCoverage({ actual: 104, expected: 108 }).status).toBe('ok');
});

test('exact 5% missing → ok (boundary)', () => {
  expect(evaluateCoverage({ actual: 103, expected: 108 }).status).toBe('ok');
});

test('over 5% missing → issue', () => {
  const r = evaluateCoverage({ actual: 100, expected: 108 });
  expect(r.status).toBe('issue');
  expect(r.missing).toBe(8);
});

test('perfect coverage → ok with missing 0', () => {
  expect(evaluateCoverage({ actual: 108, expected: 108 })).toEqual(
    expect.objectContaining({ status: 'ok', missing: 0, missingPct: 0 })
  );
});

test('over-capture (actual > expected) → ok, missing negative', () => {
  expect(evaluateCoverage({ actual: 110, expected: 108 }).status).toBe('ok');
});
