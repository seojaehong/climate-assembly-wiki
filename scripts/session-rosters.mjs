// 세션(회차)별 조 구성 정의.
//
// ## 다음 회차를 추가하는 법 — 이 파일 말고는 고치지 않는다
// 1. 아래 SESSION_ROSTERS에 항목 하나를 추가한다.
//      '<MMDD>-<이름>': { date: 'YYYY-MM-DD', teams: [{ name, subgroup, ordinal }, ...] }
//    - slug는 반드시 date의 MMDD로 시작해야 한다. 접속코드는 date에서, 세션 조회는 slug에서
//      나오므로 둘이 어긋나면 코드와 세션이 다른 날을 가리킨다.
//    - ordinal은 그 세션 전체 조 순번이고 접속코드 뒷 두 자리가 된다(MMDD + NN).
//      위치에서 유도하지 않고 손으로 적는다 — 앞에 조를 끼워 넣어도 이미 인쇄해서
//      나눠 준 코드가 밀리면 안 되기 때문이다.
// 2. ACTIVE_SESSION_SLUG를 그 slug로 바꾼다.
// 3. `node scripts/seed-0829-teams.mjs --dry-run` 으로 코드표를 눈으로 확인한다.
//
// 예) 기획 A조·B조가 참여하는 회차는 15개 조 뒤에 ordinal 16·17로 두 줄만 더 적으면 된다.
//     (8/29에는 참여하지 않으므로 여기에 등록하지 않는다 — 등록하면 CLI 한 번에
//      아직 존재하지 않는 세션의 SQL이 나온다.)

/** 이번에 운영하는 회차. 회차가 바뀌면 이 한 줄과 위 정의만 바꾼다. */
export const ACTIVE_SESSION_SLUG = '0829-deliberation';

export const SESSION_ROSTERS = Object.freeze({
  '0829-deliberation': Object.freeze({
    date: '2026-08-29',
    teams: Object.freeze([
      { name: '1분과 1조', subgroup: '1분과', ordinal: 1 },
      { name: '1분과 2조', subgroup: '1분과', ordinal: 2 },
      { name: '1분과 3조', subgroup: '1분과', ordinal: 3 },
      { name: '1분과 4조', subgroup: '1분과', ordinal: 4 },
      { name: '1분과 5조', subgroup: '1분과', ordinal: 5 },
      { name: '2분과 1조', subgroup: '2분과', ordinal: 6 },
      { name: '2분과 2조', subgroup: '2분과', ordinal: 7 },
      { name: '2분과 3조', subgroup: '2분과', ordinal: 8 },
      { name: '2분과 4조', subgroup: '2분과', ordinal: 9 },
      { name: '2분과 5조', subgroup: '2분과', ordinal: 10 },
      { name: '3분과 1조', subgroup: '3분과', ordinal: 11 },
      { name: '3분과 2조', subgroup: '3분과', ordinal: 12 },
      { name: '3분과 3조', subgroup: '3분과', ordinal: 13 },
      { name: '3분과 4조', subgroup: '3분과', ordinal: 14 },
      { name: '3분과 5조', subgroup: '3분과', ordinal: 15 },
    ]),
  }),
});

/** 등록된 세션 슬러그 목록 (오류 문구와 전수 검증용). */
export function registeredSessionSlugs() {
  return Object.keys(SESSION_ROSTERS);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 세션 정의 하나를 검증해 정규화된 형태로 돌려준다. 등록 여부와 무관한 순수 함수 —
 * 다음 회차 정의를 활성화하지 않고도 이 함수로 확인할 수 있다.
 *
 * @param {string} slug
 * @param {{ date: string, teams: Array<{name: string, subgroup: string, ordinal: number}> }} definition
 * @returns {{ slug: string, date: string, mmdd: string, title: string, teams: Array<{name: string, subgroup: string, ordinal: number}> }}
 */
export function normalizeSessionRoster(slug, definition) {
  if (!isNonEmptyString(slug)) {
    throw new Error('normalizeSessionRoster: slug가 비어 있습니다 — 세션 슬러그를 문자열로 주세요.');
  }
  if (!definition || typeof definition !== 'object') {
    throw new Error(`normalizeSessionRoster: "${slug}" 정의가 객체가 아닙니다 — { date, teams } 형태로 적으세요.`);
  }

  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(definition.date ?? '');
  if (!dateParts) {
    throw new Error(`normalizeSessionRoster: "${slug}"의 date는 YYYY-MM-DD여야 합니다 (받은 값: ${definition.date}).`);
  }
  const [, , month, day] = dateParts;
  const mmdd = `${month}${day}`;

  if (!slug.startsWith(mmdd)) {
    throw new Error(
      `normalizeSessionRoster: 슬러그 "${slug}"가 행사일 ${definition.date}의 MMDD(${mmdd})로 시작하지 않습니다 — ` +
        '접속코드는 날짜에서, 세션 조회는 슬러그에서 나오므로 둘이 어긋나면 안 됩니다.'
    );
  }

  const teams = definition.teams;
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error(`normalizeSessionRoster: "${slug}"의 teams가 비어 있습니다 — 조를 최소 하나 적으세요.`);
  }

  const seenNames = new Set();
  const seenOrdinals = new Set();
  const normalized = teams.map((team, index) => {
    const where = `"${slug}" ${index + 1}번째 조`;
    if (!team || typeof team !== 'object') {
      throw new Error(`normalizeSessionRoster: ${where} 정의가 객체가 아닙니다.`);
    }
    if (!isNonEmptyString(team.name)) {
      throw new Error(`normalizeSessionRoster: ${where}의 name이 비어 있습니다.`);
    }
    if (!isNonEmptyString(team.subgroup)) {
      throw new Error(`normalizeSessionRoster: ${where}(${team.name})의 subgroup이 비어 있습니다.`);
    }
    if (!Number.isInteger(team.ordinal) || team.ordinal < 1 || team.ordinal > 99) {
      throw new Error(
        `normalizeSessionRoster: ${where}(${team.name})의 ordinal은 1..99 정수여야 합니다 ` +
          `(받은 값: ${team.ordinal}). 접속코드 뒷 두 자리가 이 값입니다.`
      );
    }
    if (seenNames.has(team.name)) {
      throw new Error(`normalizeSessionRoster: "${slug}"에 조 이름 "${team.name}"이 두 번 있습니다.`);
    }
    if (seenOrdinals.has(team.ordinal)) {
      throw new Error(
        `normalizeSessionRoster: "${slug}"에 ordinal ${team.ordinal}이 두 번 있습니다 — ` +
          '같은 접속코드가 두 조에 발급됩니다.'
      );
    }
    seenNames.add(team.name);
    seenOrdinals.add(team.ordinal);
    return { name: team.name, subgroup: team.subgroup, ordinal: team.ordinal };
  });

  return {
    slug,
    date: definition.date,
    mmdd,
    title: `${Number(month)}/${Number(day)} 숙의`,
    teams: normalized,
  };
}

/**
 * 등록된 세션 정의를 정규화해 돌려준다. 반환값은 사본이라 호출자가 바꿔도 정의가 오염되지 않는다.
 * @param {string} [slug] 생략하면 활성 세션.
 */
export function sessionRoster(slug = ACTIVE_SESSION_SLUG) {
  const definition = SESSION_ROSTERS[slug];
  if (!definition) {
    throw new Error(
      `sessionRoster: 등록되지 않은 세션 "${slug}" — scripts/session-rosters.mjs의 SESSION_ROSTERS에 ` +
        `정의를 추가하세요 (현재 등록됨: ${registeredSessionSlugs().join(', ')}).`
    );
  }
  return normalizeSessionRoster(slug, definition);
}
