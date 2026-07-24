import { describe, expect, test } from 'vitest';
import {
  fullTeamRoster,
  buildTeamPlan,
  genUniqueCodes,
  formatCodeTable,
  SESSION_SLUG,
  SESSION_TITLE,
  SESSION_CONFIG,
  TEAM_CAPACITY,
} from './seed-0829-lib.mjs';

describe('fullTeamRoster', () => {
  test('produces 15 teams, 5 per subgroup, named "N분과 M조"', () => {
    const roster = fullTeamRoster();
    expect(roster).toHaveLength(15);
    expect(roster.filter((t) => t.subgroup === '1분과')).toHaveLength(5);
    expect(roster.filter((t) => t.subgroup === '2분과')).toHaveLength(5);
    expect(roster.filter((t) => t.subgroup === '3분과')).toHaveLength(5);
    expect(roster[0]).toEqual({ name: '1분과 1조', subgroup: '1분과' });
    expect(roster.at(-1)).toEqual({ name: '3분과 5조', subgroup: '3분과' });
    expect(new Set(roster.map((t) => t.name)).size).toBe(15);
  });
});

describe('buildTeamPlan', () => {
  test('returns the full 15-team roster when nothing exists yet', () => {
    const plan = buildTeamPlan([]);
    expect(plan).toHaveLength(15);
  });

  test('skips teams that already exist (idempotent)', () => {
    const plan = buildTeamPlan(['1분과 1조', '1분과 2조', '3분과 5조']);
    expect(plan).toHaveLength(12);
    expect(plan.find((t) => t.name === '1분과 1조')).toBeUndefined();
    expect(plan.find((t) => t.name === '2분과 1조')).toBeDefined();
  });

  test('is a no-op plan when all 15 already exist', () => {
    const plan = buildTeamPlan(fullTeamRoster().map((t) => t.name));
    expect(plan).toHaveLength(0);
  });
});

describe('genUniqueCodes', () => {
  test('generates n codes with no duplicates and none in the taken set', () => {
    let seq = [111111, 222222, 222222, 333333]; // duplicate 222222 forces a retry
    let i = 0;
    const randomInt = () => seq[i++];
    const codes = genUniqueCodes(3, ['999999'], randomInt);
    expect(codes).toEqual(['111111', '222222', '333333']);
    expect(new Set(codes).size).toBe(3);
  });

  test('avoids codes already taken', () => {
    let seq = [111111, 222222, 333333];
    let i = 0;
    const randomInt = () => seq[i++];
    const codes = genUniqueCodes(2, ['111111'], randomInt);
    expect(codes).toEqual(['222222', '333333']);
  });

  test('throws without an injected randomInt generator', () => {
    expect(() => genUniqueCodes(1, [])).toThrow();
  });
});

describe('formatCodeTable', () => {
  test('renders an aligned two-column table with header and rule', () => {
    const table = formatCodeTable([
      { name: '1분과 1조', code: '482910' },
      { name: '3분과 5조', code: '119203' },
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toContain('조 이름');
    expect(lines[0]).toContain('코드');
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[2]).toContain('1분과 1조');
    expect(lines[2]).toContain('482910');
    expect(lines[3]).toContain('3분과 5조');
  });
});

describe('seed constants', () => {
  test('match the 0829 session spec', () => {
    expect(SESSION_SLUG).toBe('0829-deliberation');
    expect(SESSION_TITLE).toBe('8/29 숙의');
    expect(SESSION_CONFIG).toEqual({ modules: ['poll', 'timer'] });
    expect(TEAM_CAPACITY).toBe(20);
  });
});
