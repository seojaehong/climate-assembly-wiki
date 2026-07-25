import { describe, expect, test } from 'vitest';
import {
  ACTIVE_SESSION_SLUG,
  SESSION_ROSTERS,
  registeredSessionSlugs,
  normalizeSessionRoster,
  sessionRoster,
} from './session-rosters.mjs';
import { joinCodeForTeam, formatSessionSeedSql } from './seed-0829-lib.mjs';

/** 8/29 세션의 15개 조를 사본으로 가져온다 (다음 회차 정의의 출발점). */
function officialFifteen() {
  return sessionRoster('0829-deliberation').teams;
}

/**
 * 기획 A조·B조가 참여하는 회차의 정의.
 * 일부러 SESSION_ROSTERS에 등록하지 않는다 — 이번 회차에는 활성화하지 않으므로
 * 등록하면 CLI 한 번에 존재하지 않는 세션의 SQL이 나올 수 있다.
 */
const PLANNING_SESSION_SLUG = '0912-deliberation';
const PLANNING_SESSION_DEF = {
  date: '2026-09-12',
  teams: [
    ...officialFifteen(),
    { name: '기획 A조', subgroup: '기획', ordinal: 16 },
    { name: '기획 B조', subgroup: '기획', ordinal: 17 },
  ],
};

describe('활성 세션 정의', () => {
  test('8/29 세션은 15개 조·분과별 5개·전체 순번 1..15를 그대로 유지한다', () => {
    const roster = sessionRoster('0829-deliberation');
    expect(roster.teams).toHaveLength(15);
    expect(roster.teams.filter((t) => t.subgroup === '1분과')).toHaveLength(5);
    expect(roster.teams.filter((t) => t.subgroup === '2분과')).toHaveLength(5);
    expect(roster.teams.filter((t) => t.subgroup === '3분과')).toHaveLength(5);
    expect(roster.teams.map(({ name, ordinal }) => [name, ordinal])).toEqual([
      ['1분과 1조', 1], ['1분과 2조', 2], ['1분과 3조', 3], ['1분과 4조', 4], ['1분과 5조', 5],
      ['2분과 1조', 6], ['2분과 2조', 7], ['2분과 3조', 8], ['2분과 4조', 9], ['2분과 5조', 10],
      ['3분과 1조', 11], ['3분과 2조', 12], ['3분과 3조', 13], ['3분과 4조', 14], ['3분과 5조', 15],
    ]);
  });

  test('인자 없이 부르면 활성 세션이 나오고 slug·date·mmdd·title이 서로 맞는다', () => {
    const roster = sessionRoster();
    expect(ACTIVE_SESSION_SLUG).toBe('0829-deliberation');
    expect(roster.slug).toBe('0829-deliberation');
    expect(roster.date).toBe('2026-08-29');
    expect(roster.mmdd).toBe('0829');
    expect(roster.title).toBe('8/29 숙의');
  });

  test('반환값은 사본이라 호출자가 바꿔도 등록된 정의가 오염되지 않는다', () => {
    const roster = sessionRoster();
    roster.teams[0].name = '망가진 조';
    roster.teams.push({ name: '끼워넣은 조', subgroup: '1분과', ordinal: 99 });
    expect(sessionRoster().teams).toHaveLength(15);
    expect(sessionRoster().teams[0].name).toBe('1분과 1조');
  });

  test('등록된 모든 세션 정의가 검증을 통과한다', () => {
    const slugs = registeredSessionSlugs();
    expect(slugs).toContain(ACTIVE_SESSION_SLUG);
    expect(slugs).toEqual(Object.keys(SESSION_ROSTERS));
    for (const slug of slugs) {
      expect(() => sessionRoster(slug)).not.toThrow();
    }
  });

  test('등록되지 않은 세션은 등록된 슬러그 목록을 담은 오류로 알린다', () => {
    expect(() => sessionRoster('1231-deliberation')).toThrow(/1231-deliberation/);
    expect(() => sessionRoster('1231-deliberation')).toThrow(/0829-deliberation/);
  });
});

describe('다음 회차 — 정의만 추가하면 쓸 수 있는 구조', () => {
  test('기획 A조·B조를 더한 17개 구성이 등록 없이 그대로 정규화된다', () => {
    const roster = normalizeSessionRoster(PLANNING_SESSION_SLUG, PLANNING_SESSION_DEF);
    expect(roster.teams).toHaveLength(17);
    expect(roster.slug).toBe('0912-deliberation');
    expect(roster.mmdd).toBe('0912');
    expect(roster.title).toBe('9/12 숙의');
    expect(roster.teams.at(-2)).toEqual({ name: '기획 A조', subgroup: '기획', ordinal: 16 });
    expect(roster.teams.at(-1)).toEqual({ name: '기획 B조', subgroup: '기획', ordinal: 17 });
  });

  test('접속코드 규칙(MMDD + 전체 조 순번)이 17개 구성에서도 그대로 적용된다', () => {
    const roster = normalizeSessionRoster(PLANNING_SESSION_SLUG, PLANNING_SESSION_DEF);
    const codes = roster.teams.map((team) => joinCodeForTeam(roster.mmdd, team.ordinal));
    expect(codes[0]).toBe('091201');
    expect(codes[14]).toBe('091215');
    expect(codes[15]).toBe('091216');
    expect(codes.at(-1)).toBe('091217');
    expect(new Set(codes).size).toBe(17);
  });

  test('기획 조를 뒤에 붙여도 앞 15개 조의 순번은 밀리지 않는다', () => {
    const next = normalizeSessionRoster(PLANNING_SESSION_SLUG, PLANNING_SESSION_DEF);
    const active = sessionRoster('0829-deliberation');
    expect(next.teams.slice(0, 15).map((t) => t.ordinal)).toEqual(
      active.teams.map((t) => t.ordinal)
    );
  });

  test('17개 구성으로도 시드 SQL이 그대로 나온다 (활성 세션은 15개 그대로)', () => {
    const roster = normalizeSessionRoster(PLANNING_SESSION_SLUG, PLANNING_SESSION_DEF);
    const sql = formatSessionSeedSql(roster);
    expect(sql).toContain("values ('0912-deliberation', '9/12 숙의'");
    expect(sql).toContain("('기획 A조', '기획', 16, '091216')");
    expect(sql).toContain("('기획 B조', '기획', 17, '091217')");
    expect(sql).toContain('session seed verification failed: % of 17');

    const activeSql = formatSessionSeedSql();
    expect(activeSql).toContain("values ('0829-deliberation', '8/29 숙의'");
    expect(activeSql).toContain('session seed verification failed: % of 15');
    expect(activeSql).not.toContain('기획 A조');
  });
});

describe('정의 검증 — 잘못된 회차 정의는 조용히 통과하지 않는다', () => {
  const base = () => ({ date: '2026-09-12', teams: officialFifteen() });

  test('같은 순번을 두 조에 주면 거부한다 (같은 접속코드가 두 조에 발급된다)', () => {
    const def = base();
    def.teams[1] = { ...def.teams[1], ordinal: 1 };
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, def)).toThrow(/ordinal/);
  });

  test('같은 이름을 두 조에 주면 거부한다', () => {
    const def = base();
    def.teams[1] = { ...def.teams[1], name: '1분과 1조' };
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, def)).toThrow(/1분과 1조/);
  });

  test('순번이 정수 1..99를 벗어나면 거부한다 (접속코드 두 자리를 넘는다)', () => {
    for (const bad of [0, 100, 1.5, '3', null]) {
      const def = base();
      def.teams[0] = { ...def.teams[0], ordinal: bad };
      expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, def)).toThrow();
    }
  });

  test('이름·분과가 비면 거부한다', () => {
    const noName = base();
    noName.teams[0] = { ...noName.teams[0], name: '  ' };
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, noName)).toThrow();

    const noSubgroup = base();
    noSubgroup.teams[0] = { ...noSubgroup.teams[0], subgroup: '' };
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, noSubgroup)).toThrow();
  });

  test('날짜 형식이 어긋나거나 조 목록이 비면 거부한다', () => {
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, { date: '2026-9-12', teams: officialFifteen() })).toThrow();
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, { date: '2026-09-12', teams: [] })).toThrow();
    expect(() => normalizeSessionRoster(PLANNING_SESSION_SLUG, null)).toThrow();
  });

  test('슬러그가 날짜의 MMDD로 시작하지 않으면 거부한다 (코드와 세션이 다른 날을 가리킨다)', () => {
    expect(() => normalizeSessionRoster('0913-deliberation', base())).toThrow(/0912/);
    expect(() => normalizeSessionRoster('0912-rehearsal', base())).not.toThrow();
  });
});
