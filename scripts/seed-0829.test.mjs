import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  fullTeamRoster,
  buildTeamPlan,
  genUniqueCodes,
  genRosterCodes,
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
import { ACTIVE_SESSION_SLUG, sessionRoster } from './session-rosters.mjs';

const SEED_SCRIPT = fileURLToPath(new URL('./seed-0829-teams.mjs', import.meta.url));
const ROTATE_SCRIPT = fileURLToPath(new URL('./rotate-join-code.mjs', import.meta.url));

function fixtureCodes(roster, start = 730001) {
  return roster.teams.map((_, index) => String(start + index));
}

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

  test('rejects values outside the six-digit range', () => {
    expect(() => genUniqueCodes(1, [], () => 99999)).toThrow(/100000 to 999999/);
    expect(() => genUniqueCodes(1, [], () => 1000000)).toThrow(/100000 to 999999/);
  });
});

describe('legacy 8/29 join-code fixtures', () => {
  test('formats historical MMDD + two-digit global team ordinal fixtures', () => {
    expect(joinCodeForTeam('0725', 1)).toBe('072501');
    expect(joinCodeForTeam('0829', 15)).toBe('082915');
  });

  test('keeps the legacy helper deterministic without using it in operational SQL', () => {
    const codes = fullTeamRoster().map((team) => joinCodeForTeamName(team.name));
    expect(codes[0]).toBe(`${SESSION_DATE_MMDD}01`);
    expect(codes.at(-1)).toBe(`${SESSION_DATE_MMDD}15`);
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
    const roster = sessionRoster();
    const codes = fixtureCodes(roster);
    const sql = formatJoinCodeSyncSql(roster, codes);
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain("'1분과 1조', '1분과', '730001'");
    expect(sql).toContain("'3분과 5조', '3분과', '730015'");
    expect(sql).not.toContain("'091201'");
    expect(sql).toContain('complete official 15-team roster is required');
    expect(sql).toContain('select count(*) into session_team_count');
    expect(sql).toContain('session_team_count <> 15');
    expect(sql).toContain('expected.subgroup = t.subgroup');
    expect(sql).toContain("t.status = 'active'");
    expect(sql).toContain(`t.capacity = ${TEAM_CAPACITY}`);
    expect(sql).toContain('join-code collision detected');
    expect(sql).toContain('join-code verification failed');
    expect(sql).toContain("where src.slug = '0829-deliberation'");
    expect(sql).toContain("target_session.held_on is distinct from date '2026-09-12'");
    expect(sql).toContain('existing session tenancy mismatch: 0912-deliberation');
    expect(sql).toContain('existing team tenancy mismatch: 0912-deliberation');
    expect(sql).not.toContain('set org_id =');
    expect(sql).not.toContain('set assembly_id =');
    expect(sql).not.toContain('set held_on =');
  });

  test('refuses to sync an existing session without an approved tenancy source', () => {
    const roster = { ...sessionRoster('0912-deliberation'), inheritTenancyFrom: null };

    expect(() => formatJoinCodeSyncSql(roster, fixtureCodes(roster))).toThrow(/approved tenancy source is required/);
  });

  test('emits an atomic admin transaction for a new session roster', () => {
    const roster = sessionRoster();
    const sql = formatSessionSeedSql(roster, fixtureCodes(roster));
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain(`'${SESSION_SLUG}', '${SESSION_TITLE}'`);
    expect(sql).toContain("'1분과 1조', '1분과', 1, '730001'");
    expect(sql).not.toContain("'091201'");
    expect(sql).toContain('and not exists');
    expect(sql).not.toContain('on conflict (session_id, name)');
    expect(sql).toContain('session seed verification failed');
  });

  test('fails closed when seed meets a partial existing session with invalid tenancy', () => {
    const roster = sessionRoster('0912-deliberation');
    const sql = formatSessionSeedSql(roster, fixtureCodes(roster));
    const conflictIndex = sql.indexOf('on conflict (slug) do nothing;');
    const sessionGuardIndex = sql.indexOf('existing session tenancy mismatch: 0912-deliberation');

    expect(conflictIndex).toBeGreaterThan(-1);
    expect(sessionGuardIndex).toBeGreaterThan(conflictIndex);
    expect(sql).toContain("target_session.held_on is distinct from date '2026-09-12'");
    expect(sql).toContain('existing team tenancy mismatch: 0912-deliberation');
    expect(sql).toContain('t.org_id is distinct from target_session.org_id');
  });

  test('rejects extra, inactive, or shape-mismatched teams in seed and sync packets', () => {
    const roster = sessionRoster();
    const codes = fixtureCodes(roster);
    for (const sql of [formatSessionSeedSql(roster, codes), formatJoinCodeSyncSql(roster, codes)]) {
      expect(sql).toContain('select count(*) into session_team_count');
      expect(sql).toContain('session_team_count <> 15');
      expect(sql).toContain('expected.subgroup = t.subgroup');
      expect(sql).toContain("t.status = 'active'");
      expect(sql).toContain(`t.capacity = ${TEAM_CAPACITY}`);
      expect(sql).toContain('complete official 15-team roster is required');
    }
  });

  test('refuses an on-conflict seed when no approved tenancy source can validate it', () => {
    const roster = sessionRoster('0829-deliberation');
    const sql = formatSessionSeedSql(roster, fixtureCodes(roster, 720001));

    expect(sql).toContain('returning id into seeded_session_id');
    expect(sql).toContain('if seeded_session_id is null then');
    expect(sql).toContain('existing session cannot be verified without approved tenancy source');
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
  /**
   * ★ 회차 값을 박지 않는다. 이 상수들은 전부 **활성 회차 정의에서 파생**되므로,
   *   값을 적어 두면 회차를 넘길 때마다 깨지고 값만 바꿔 고치게 된다. 회차가 바뀌어도
   *   참이어야 하는 것은 「활성 정의와 어긋나지 않는다」는 성질이다.
   *   (어느 회차인지를 못박는 검사는 scripts/session-rosters.test.mjs 가 한다.)
   */
  test('derive from the active session roster without drifting', () => {
    const active = sessionRoster(ACTIVE_SESSION_SLUG);
    expect(SESSION_SLUG).toBe(ACTIVE_SESSION_SLUG);
    expect(SESSION_SLUG).toBe(active.slug);
    expect(SESSION_DATE).toBe(active.date);
    expect(SESSION_TITLE).toBe(active.title);
    expect(SESSION_DATE_MMDD).toBe(active.mmdd);
    expect(SESSION_DATE_MMDD).toBe(SESSION_DATE.slice(5).replace('-', ''));
    expect(SESSION_SLUG.startsWith(SESSION_DATE_MMDD)).toBe(true);
  });

  test('회차와 무관한 상수는 고정이다', () => {
    expect(SESSION_CONFIG).toEqual({ modules: ['poll', 'timer'] });
    expect(TEAM_CAPACITY).toBe(20);
  });
});

describe('seed command safety boundary', () => {
  test('refuses a no-argument direct live write before loading any credentials', () => {
    const result = spawnSync(process.execPath, [SEED_SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'https://must-not-be-contacted.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-do-not-use',
      },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('직접 live 쓰기 경로는 비활성화');
  });

  test('rejects unknown or conflicting seed modes instead of guessing operator intent', () => {
    for (const args of [
      ['--print-seed-sql', '--dry-run'],
      ['--print-seed-sql', '--unknown'],
    ]) {
      const result = spawnSync(process.execPath, [SEED_SCRIPT, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('사용:');
    }
  });

  test('disables direct rotation and keeps dry-run codes masked', () => {
    const direct = spawnSync(process.execPath, [ROTATE_SCRIPT, '1분과 1조'], { encoding: 'utf8' });
    expect(direct.status).toBe(2);
    expect(direct.stdout).toBe('');
    expect(direct.stderr).toContain('직접 live 쓰기 경로는 비활성화');

    const dryRun = spawnSync(
      process.execPath,
      [ROTATE_SCRIPT, '1분과 1조', '--dry-run'],
      { encoding: 'utf8' },
    );
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain('new code:     ******');
    expect(dryRun.stdout).not.toMatch(/new code:\s+\d{6}/);
  });
});

describe('secure roster code generation', () => {
  test('creates one unique six-digit code per active team', () => {
    let next = 730000;
    const codes = genRosterCodes(undefined, () => next++);

    expect(codes).toHaveLength(15);
    expect(new Set(codes).size).toBe(15);
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(codes).not.toContain('091201');
  });

  test('accepts only a complete validated secure code set in generated SQL', () => {
    const secureCodes = Array.from({ length: 15 }, (_, index) => String(730001 + index));
    const sql = formatSessionSeedSql(undefined, secureCodes);

    expect(sql).toContain("'730001'");
    expect(sql).toContain("'730015'");
    expect(sql).not.toContain("'091201'");
    expect(() => formatSessionSeedSql(undefined, secureCodes.slice(1))).toThrow(/one unique six-digit code/);
  });

  test('refuses to generate operational SQL without caller-supplied secure codes', () => {
    expect(() => formatSessionSeedSql()).toThrow(/roster codes are required/);
    expect(() => formatJoinCodeSyncSql()).toThrow(/roster codes are required/);
  });
});
