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
 * 기획 A조·B조가 참여하는 회차의 정의 — **가상의 날짜**를 쓴다.
 *
 * 일부러 SESSION_ROSTERS에 등록하지 않는다. 등록하면 CLI 한 번에 존재하지 않는 세션의
 * SQL이 나올 수 있다. 그래서 이 자리에는 **실제로 열릴 일이 없는 날짜**를 둔다 —
 * 예전에는 여기에 9/12를 적어 두었는데, 9/12가 진짜 회차로 등록되면서 「등록하지 않는
 * 예시」라는 이 파일의 설명이 거짓이 되었다. 12/31은 회차 일정에 없다.
 */
const HYPOTHETICAL_SLUG = '1231-deliberation';
const HYPOTHETICAL_DEF = {
  date: '2026-12-31',
  teams: [
    ...officialFifteen(),
    { name: '기획 A조', subgroup: '기획', ordinal: 16 },
    { name: '기획 B조', subgroup: '기획', ordinal: 17 },
  ],
};

describe('활성 세션 — 값이 아니라 성질을 잰다', () => {
  /**
   * ★ 여기에 `'0829-deliberation'` 같은 값을 박지 않는다. 박으면 **회차를 넘길 때마다
   *   이 테스트가 깨지고**, 깨진 테스트를 값만 바꿔 고치는 일이 반복된다. 회차가 바뀌어도
   *   참이어야 하는 것은 「활성 슬러그가 등록돼 있고 정규화를 통과한다」는 성질이다.
   */
  test('활성 슬러그는 등록돼 있고 그대로 정규화된다', () => {
    expect(registeredSessionSlugs()).toContain(ACTIVE_SESSION_SLUG);
    expect(() => sessionRoster(ACTIVE_SESSION_SLUG)).not.toThrow();
  });

  test('인자 없이 부르면 활성 세션이 나오고 slug·date·mmdd·title이 서로 맞는다', () => {
    const roster = sessionRoster();
    expect(roster.slug).toBe(ACTIVE_SESSION_SLUG);
    // mmdd는 date에서 파생되고, slug는 그 mmdd로 시작해야 한다(코드와 세션이 같은 날을 가리킨다).
    const [, , month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roster.date);
    expect(roster.mmdd).toBe(`${month}${day}`);
    expect(roster.slug.startsWith(roster.mmdd)).toBe(true);
    expect(roster.title).toBe(`${Number(month)}/${Number(day)} 숙의`);
    expect(roster.teams.length).toBeGreaterThan(0);
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
    expect(() => sessionRoster('0101-deliberation')).toThrow(/0101-deliberation/);
    expect(() => sessionRoster('0101-deliberation')).toThrow(/0829-deliberation/);
  });
});

describe('8/29 로스터 — 지난 회차는 그대로 남는다', () => {
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

  test('8/29의 slug·date·mmdd·title·접속코드가 인쇄해 나눠 준 그대로다', () => {
    const roster = sessionRoster('0829-deliberation');
    expect(roster.date).toBe('2026-08-29');
    expect(roster.mmdd).toBe('0829');
    expect(roster.title).toBe('8/29 숙의');
    const codes = roster.teams.map((team) => joinCodeForTeam(roster.mmdd, team.ordinal));
    expect(codes[0]).toBe('082901');
    expect(codes.at(-1)).toBe('082915');
  });

  test('반환값은 사본이라 호출자가 바꿔도 등록된 정의가 오염되지 않는다', () => {
    const roster = sessionRoster('0829-deliberation');
    roster.teams[0].name = '망가진 조';
    roster.teams.push({ name: '끼워넣은 조', subgroup: '1분과', ordinal: 99 });
    expect(sessionRoster('0829-deliberation').teams).toHaveLength(15);
    expect(sessionRoster('0829-deliberation').teams[0].name).toBe('1분과 1조');
  });
});

describe('9/12 로스터 — 6·7차(경주 1박2일)', () => {
  test('숙의참여단만 오므로 8.29와 같은 15조 구조다 (기획 조 없음)', () => {
    const roster = sessionRoster('0912-deliberation');
    expect(roster.date).toBe('2026-09-12');
    expect(roster.mmdd).toBe('0912');
    expect(roster.title).toBe('9/12 숙의');
    expect(roster.teams).toHaveLength(15);
    expect(roster.teams.filter((t) => t.subgroup === '기획')).toHaveLength(0);
    expect(roster.teams.map(({ name, ordinal }) => [name, ordinal])).toEqual(
      sessionRoster('0829-deliberation').teams.map(({ name, ordinal }) => [name, ordinal])
    );
  });

  test('접속코드는 091201..091215이고 겹치지 않는다', () => {
    const roster = sessionRoster('0912-deliberation');
    const codes = roster.teams.map((team) => joinCodeForTeam(roster.mmdd, team.ordinal));
    expect(codes[0]).toBe('091201');
    expect(codes.at(-1)).toBe('091215');
    expect(new Set(codes).size).toBe(15);
    // 지난 회차 코드와도 겹치지 않는다 — 날짜가 앞 네 자리라 구조적으로 갈린다.
    const previous = sessionRoster('0829-deliberation').teams.map((t) => joinCodeForTeam('0829', t.ordinal));
    expect(codes.some((code) => previous.includes(code))).toBe(false);
  });

  test('org_id를 8.29에서 물려받도록 표시돼 있다 (p1b NOT NULL에서 시드가 죽지 않는다)', () => {
    expect(sessionRoster('0912-deliberation').inheritTenancyFrom).toBe('0829-deliberation');
    expect(sessionRoster('0829-deliberation').inheritTenancyFrom).toBeNull();
  });

  test('시드 SQL은 9/12 세션을 만들 뿐 8.29를 고치지 않는다', () => {
    const sql = formatSessionSeedSql(sessionRoster('0912-deliberation'));
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain("'0912-deliberation', '9/12 숙의'");
    expect(sql).toContain("('1분과 1조', '1분과', 1, '091201')");
    expect(sql).toContain("('3분과 5조', '3분과', 15, '091215')");
    expect(sql).toContain('session seed verification failed: % of 15');
    // 테넌시 상속 — 원본이 없으면 조용히 0건이 아니라 예외로 멈춘다.
    expect(sql).toContain('tenancy source session not found: 0829-deliberation');
    expect(sql).toContain("src.org_id, src.assembly_id, date '2026-09-12'");
    // ★ 8.29를 지우거나 옮기지 않는다 — 이 SQL에는 파괴 구문이 하나도 없다.
    expect(sql).not.toMatch(/\b(delete|update|drop|truncate|alter)\b/i);
    // 8.29가 나오는 자리는 「읽는 곳」 셋뿐이다(preflight 조회·오류 문구·insert의 select).
    expect(sql.match(/0829-deliberation/g)).toHaveLength(3);
  });

  test('8.29 시드 SQL은 예전 모양 그대로다 (상속 없는 회차는 values 그대로)', () => {
    const sql = formatSessionSeedSql(sessionRoster('0829-deliberation'));
    expect(sql).toContain("values ('0829-deliberation', '8/29 숙의'");
    expect(sql).toContain("'1분과 1조', '1분과', 1, '082901'");
    expect(sql).toContain('session seed verification failed: % of 15');
    expect(sql).not.toContain('tenancy source session not found');
    expect(sql).not.toContain('org_id');
    expect(sql).not.toContain('0912');
  });
});

describe('다음 회차 — 정의만 추가하면 쓸 수 있는 구조', () => {
  test('기획 A조·B조를 더한 17개 구성이 등록 없이 그대로 정규화된다', () => {
    const roster = normalizeSessionRoster(HYPOTHETICAL_SLUG, HYPOTHETICAL_DEF);
    expect(registeredSessionSlugs()).not.toContain(HYPOTHETICAL_SLUG);
    expect(roster.teams).toHaveLength(17);
    expect(roster.slug).toBe('1231-deliberation');
    expect(roster.mmdd).toBe('1231');
    expect(roster.title).toBe('12/31 숙의');
    expect(roster.teams.at(-2)).toEqual({ name: '기획 A조', subgroup: '기획', ordinal: 16 });
    expect(roster.teams.at(-1)).toEqual({ name: '기획 B조', subgroup: '기획', ordinal: 17 });
  });

  test('접속코드 규칙(MMDD + 전체 조 순번)이 17개 구성에서도 그대로 적용된다', () => {
    const roster = normalizeSessionRoster(HYPOTHETICAL_SLUG, HYPOTHETICAL_DEF);
    const codes = roster.teams.map((team) => joinCodeForTeam(roster.mmdd, team.ordinal));
    expect(codes[0]).toBe('123101');
    expect(codes[14]).toBe('123115');
    expect(codes[15]).toBe('123116');
    expect(codes.at(-1)).toBe('123117');
    expect(new Set(codes).size).toBe(17);
  });

  test('기획 조를 뒤에 붙여도 앞 15개 조의 순번은 밀리지 않는다', () => {
    const next = normalizeSessionRoster(HYPOTHETICAL_SLUG, HYPOTHETICAL_DEF);
    const official = sessionRoster('0829-deliberation');
    expect(next.teams.slice(0, 15).map((t) => t.ordinal)).toEqual(
      official.teams.map((t) => t.ordinal)
    );
  });

  test('17개 구성으로도 시드 SQL이 그대로 나온다 (등록된 회차는 건드리지 않는다)', () => {
    const roster = normalizeSessionRoster(HYPOTHETICAL_SLUG, HYPOTHETICAL_DEF);
    const sql = formatSessionSeedSql(roster);
    expect(sql).toContain("values ('1231-deliberation', '12/31 숙의'");
    expect(sql).toContain("('기획 A조', '기획', 16, '123116')");
    expect(sql).toContain("('기획 B조', '기획', 17, '123117')");
    expect(sql).toContain('session seed verification failed: % of 17');

    const activeSql = formatSessionSeedSql();
    expect(activeSql).toContain(`'${ACTIVE_SESSION_SLUG}'`);
    expect(activeSql).not.toContain('기획 A조');
  });
});

describe('정의 검증 — 잘못된 회차 정의는 조용히 통과하지 않는다', () => {
  const base = () => ({ date: '2026-12-31', teams: officialFifteen() });

  test('같은 순번을 두 조에 주면 거부한다 (같은 접속코드가 두 조에 발급된다)', () => {
    const def = base();
    def.teams[1] = { ...def.teams[1], ordinal: 1 };
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, def)).toThrow(/ordinal/);
  });

  test('같은 이름을 두 조에 주면 거부한다', () => {
    const def = base();
    def.teams[1] = { ...def.teams[1], name: '1분과 1조' };
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, def)).toThrow(/1분과 1조/);
  });

  test('순번이 정수 1..99를 벗어나면 거부한다 (접속코드 두 자리를 넘는다)', () => {
    for (const bad of [0, 100, 1.5, '3', null]) {
      const def = base();
      def.teams[0] = { ...def.teams[0], ordinal: bad };
      expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, def)).toThrow();
    }
  });

  test('이름·분과가 비면 거부한다', () => {
    const noName = base();
    noName.teams[0] = { ...noName.teams[0], name: '  ' };
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, noName)).toThrow();

    const noSubgroup = base();
    noSubgroup.teams[0] = { ...noSubgroup.teams[0], subgroup: '' };
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, noSubgroup)).toThrow();
  });

  test('날짜 형식이 어긋나거나 조 목록이 비면 거부한다', () => {
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, { date: '2026-12-3', teams: officialFifteen() })).toThrow();
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, { date: '2026-12-31', teams: [] })).toThrow();
    expect(() => normalizeSessionRoster(HYPOTHETICAL_SLUG, null)).toThrow();
  });

  test('슬러그가 날짜의 MMDD로 시작하지 않으면 거부한다 (코드와 세션이 다른 날을 가리킨다)', () => {
    expect(() => normalizeSessionRoster('1230-deliberation', base())).toThrow(/1231/);
    expect(() => normalizeSessionRoster('1231-rehearsal', base())).not.toThrow();
  });

  test('테넌시 상속이 비었거나 자기 자신이면 거부한다', () => {
    expect(() =>
      normalizeSessionRoster(HYPOTHETICAL_SLUG, { ...base(), inheritTenancyFrom: '   ' })
    ).toThrow(/inheritTenancyFrom/);
    expect(() =>
      normalizeSessionRoster(HYPOTHETICAL_SLUG, { ...base(), inheritTenancyFrom: HYPOTHETICAL_SLUG })
    ).toThrow(/자기 자신/);
    // 없는 것은 정상이다 — 8.29처럼 org_id 이전에 만들어진 회차가 그렇다.
    expect(normalizeSessionRoster(HYPOTHETICAL_SLUG, base()).inheritTenancyFrom).toBeNull();
  });
});
