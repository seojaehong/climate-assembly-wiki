import { describe, expect, test } from 'vitest';
import { buildScoreRows, normalizeVoteCounts, scoreToPosition } from './agenda-vote-scoring.mjs';

describe('normalizeVoteCounts', () => {
  test('keeps live vote scores at zero when no responses exist', () => {
    expect(normalizeVoteCounts([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  test('normalizes vote counts to the visible 1.00-4.90 range', () => {
    expect(normalizeVoteCounts([10, 5, 0])).toEqual([4.9, 3, 1]);
  });

  test('never emits a display score below 1.00 or above 5.00', () => {
    const scores = normalizeVoteCounts([2, -1, 1, 999]);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...scores)).toBeLessThanOrEqual(4.9);
  });
});

describe('scoreToPosition', () => {
  test('places higher scores farther right and higher on the stage', () => {
    const low = scoreToPosition(2);
    const high = scoreToPosition(4.9);

    expect(high.x).toBeGreaterThan(low.x);
    expect(high.y).toBeGreaterThan(low.y);
  });

  test('spreads small score differences enough for a projector', () => {
    const lower = scoreToPosition(4.4);
    const higher = scoreToPosition(4.9);

    expect(higher.x - lower.x).toBeGreaterThanOrEqual(0.1);
    expect(higher.y - lower.y).toBeGreaterThanOrEqual(0.1);
  });
});

describe('buildScoreRows', () => {
  test('repeats the normalized score across all four bubble criteria columns', () => {
    const rows = buildScoreRows([
      { slot: '1', name: 'A', short: 'A', color: '#000000' },
      { slot: '2', name: 'B', short: 'B', color: '#ffffff' },
    ], { A: 4, B: 0 });

    expect(rows).toEqual([
      ['slot', 'name', 'short', 'color', 'c1', 'c2', 'c3', 'c4'],
      ['1', 'A', 'A', '#000000', 4.9, 4.9, 4.9, 4.9],
      ['2', 'B', 'B', '#ffffff', 1, 1, 1, 1],
    ]);
  });
});
