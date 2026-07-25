import { describe, expect, test } from 'vitest';
import {
  fullTeamRoster,
  buildTeamPlan,
  genUniqueCodes,
  formatCodeTable,
  sessionAction,
  SESSION_SLUG,
  SESSION_TITLE,
  SESSION_DATE,
  SESSION_DATE_MMDD,
  SESSION_CONFIG,
  TEAM_CAPACITY,
  joinCodeForTeam,
  joinCodeForTeamName,
  formatSessionSeedSql,
  formatJoinCodeSyncSql,
  formatJoinCodeRotationSql,
} from './seed-0829-lib.mjs';

describe('fullTeamRoster', () => {
  test('produces 15 teams, 5 per subgroup, named "N분과 M조"', () => {
    const roster = fullTeamRoster();
    expect(roster).toHaveLength(15);
    expect(roster.filter((t) => t.subgroup === '1분과')).toHaveLength(5);
    expect(roster.filter((t) => t.subgroup === '2분과')).toHaveLength(5);
    expect(roster.filter((t) => t.subgroup === '3분과')).toHaveLength(5);
    expect(roster[0]).toEqual({ name: '1분과 1조', subgroup: '1분과', ordinal: 1 });
    expect(roster.at(-1)).toEqual({ name: '3분과 5조', subgroup: '3분과', ordinal: 15 });
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

describe('date-based join codes', () => {
  test('formats MMDD + two-digit global team ordinal', () => {
    expect(joinCodeForTeam('0725', 1)).toBe('072501');
    expect(joinCodeForTeam('0829', 15)).toBe('082915');
  });

  test('maps the 8/29 roster to unique 082901..082915 codes', () => {
    const codes = fullTeamRoster().map((team) => joinCodeForTeamName(team.name));
    expect(codes[0]).toBe('082901');
    expect(codes.at(-1)).toBe('082915');
    expect(new Set(codes).size).toBe(15);
  });

  test('locks every official team name to an explicit global ordinal', () => {
    expect(fullTeamRoster().map(({ name, ordinal }) => [name, ordinal])).toEqual([
      ['1분과 1조', 1], ['1분과 2조', 2], ['1분과 3조', 3], ['1분과 4조', 4], ['1분과 5조', 5],
      ['2분과 1조', 6], ['2분과 2조', 7], ['2분과 3조', 8], ['2분과 4조', 9], ['2분과 5조', 10],
      ['3분과 1조', 11], ['3분과 2조', 12], ['3분과 3조', 13], ['3분과 4조', 14], ['3분과 5조', 15],
    ]);
  });

  test('emits an atomic admin transaction for syncing an existing roster', () => {
    const sql = formatJoinCodeSyncSql();
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain("'1분과 1조', '082901'");
    expect(sql).toContain("'3분과 5조', '082915'");
    expect(sql).toContain('complete official 15-team roster is required');
    expect(sql).toContain('join-code collision detected');
    expect(sql).toContain('join-code verification failed');
  });

  test('emits an atomic admin transaction for a new session roster', () => {
    const sql = formatSessionSeedSql();
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain("values ('0829-deliberation', '8/29 숙의'");
    expect(sql).toContain("'1분과 1조', '1분과', 1, '082901'");
    expect(sql).toContain('and not exists');
    expect(sql).not.toContain('on conflict (session_id, name)');
    expect(sql).toContain('session seed verification failed');
  });

  test('emits an atomic admin transaction for emergency code rotation', () => {
    const sql = formatJoinCodeRotationSql('1분과 1조', '654321');
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain("t.name = '1분과 1조'");
    expect(sql).toContain("set join_code = '654321'");
    expect(sql).toContain("t.join_code is distinct from '654321'");
    expect(() => formatJoinCodeRotationSql('없는 조', '654321')).toThrow();
    expect(() => formatJoinCodeRotationSql('1분과 1조', '12345')).toThrow();
  });

  test('rejects malformed dates, ordinals, and unknown teams', () => {
    expect(() => joinCodeForTeam('725', 1)).toThrow();
    expect(() => joinCodeForTeam('0725', 0)).toThrow();
    expect(() => joinCodeForTeamName('없는 조')).toThrow();
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

describe('sessionAction', () => {
  test('returns "use" when a session row already exists (never overwrite)', () => {
    expect(sessionAction({ id: 'abc-123', slug: SESSION_SLUG })).toBe('use');
  });

  test('returns "create" when no session row exists (null or undefined)', () => {
    expect(sessionAction(null)).toBe('create');
    expect(sessionAction(undefined)).toBe('create');
  });
});

describe('seed constants', () => {
  test('match the 0829 session spec', () => {
    expect(SESSION_DATE).toBe('2026-08-29');
    expect(SESSION_SLUG).toBe('0829-deliberation');
    expect(SESSION_TITLE).toBe('8/29 숙의');
    expect(SESSION_DATE_MMDD).toBe('0829');
    expect(SESSION_CONFIG).toEqual({ modules: ['poll', 'timer'] });
    expect(TEAM_CAPACITY).toBe(20);
  });
});
