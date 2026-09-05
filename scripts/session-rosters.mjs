// 세션(회차)별 조 구성 정의.
//
// ## 다음 회차를 추가하는 법 — 이 파일 말고는 고치지 않는다
// 1. 아래 SESSION_ROSTERS에 항목 하나를 추가한다.
//      '<MMDD>-<이름>': { date: 'YYYY-MM-DD', teams: [{ name, subgroup, ordinal }, ...] }
//    - slug는 운영자가 행사일을 즉시 대조할 수 있도록 date의 MMDD로 시작한다.
//    - ordinal은 그 세션 전체 조의 고정 정렬 순서다. 접속코드는 ordinal과 무관하게
//      보안 난수원으로 별도 생성한다. 위치에서 유도하지 않고 손으로 적어 조를 끼워 넣어도
//      화면·명찰·배부표의 기존 순서가 밀리지 않게 한다.
//    - inheritTenancyFrom(선택)은 org_id·assembly_id를 물려받을 **기존 세션의 slug**다.
//      아래 「테넌시 상속」 참조. 새 회차에는 사실상 필수다.
// 2. ACTIVE_SESSION_SLUG를 그 slug로 바꾼다.
// 3. `node scripts/seed-0829-teams.mjs --dry-run` 으로 조 목록과 마스킹된 코드표를 확인한다.
//
// 예) 기획 A조·B조가 참여하는 회차는 15개 조 뒤에 ordinal 16·17로 두 줄만 더 적으면 된다.
//     (숙의참여단만 오는 회차에는 등록하지 않는다.)
//
// ## 테넌시 상속(inheritTenancyFrom) — 왜 필요한가
//
// `platform_p1_tenancy.sql`이 session·team에 org_id를 붙였고(운영 적용됨 — s6가 운영에서
// `session.org_id`를 읽고 돌았다), `platform_p1b_backfill.sql`은 그 컬럼을 **NOT NULL로**
// 전환한다. p1b가 적용된 DB에서 org_id 없이 세션을 insert하면 시드가 통째로 실패한다.
// 나중에 update로 메울 수도 없다 — insert 자체가 막히기 때문이다.
//
// 그래서 새 회차는 **이미 도는 세션의 org_id·assembly_id를 그대로 물려받는다.** p1b 적용
// 여부와 무관하게 맞는 유일한 값이고(미적용이면 상속값이 null, 적용됐으면 8.29와 같은 org),
// 사무국이 나중에 s6를 본떠 꼭지를 열 때 그 SQL이 읽는 `session.org_id`도 이걸로 채워진다.

/** 이번에 운영하는 회차. 회차가 바뀌면 이 한 줄과 위 정의만 바꾼다. */
export const ACTIVE_SESSION_SLUG = '0912-deliberation';

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

  // 6·7차 숙의 — 2026-09-12(토)~13(일) 경주 교원드림센터, 1박2일. 숙의참여단만 온다
  // (기획참여단 제외 → 기획 A·B조를 두지 않는다).
  //
  // ★ 조 편성은 「바뀐다」는 언급만 있고 확정값을 받지 못했다. 그래서 8.29와 같은
  //   3분과 × 5조 = 15조 **구조**로 연다. 여기 적는 것은 조의 이름·분과·정렬 순번이지
  //   누가 몇 조인지가 아니다 — 조원 배정은 assembly_member·team_assignment라는 다른 층이고
  //   이 파일이 다루지 않는다. 사무국이 조 편성을 확정해 주면 그때 이 목록만 고친다.
  '0912-deliberation': Object.freeze({
    date: '2026-09-12',
    inheritTenancyFrom: '0829-deliberation',
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

const SESSION_SLUG_PATTERN = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/**
 * 세션 정의 하나를 검증해 정규화된 형태로 돌려준다. 등록 여부와 무관한 순수 함수 —
 * 다음 회차 정의를 활성화하지 않고도 이 함수로 확인할 수 있다.
 *
 * @param {string} slug
 * @param {{ date: string, inheritTenancyFrom?: string, teams: Array<{name: string, subgroup: string, ordinal: number}> }} definition
 * @returns {{ slug: string, date: string, mmdd: string, title: string, inheritTenancyFrom: string|null, teams: Array<{name: string, subgroup: string, ordinal: number}> }}
 */
export function normalizeSessionRoster(slug, definition) {
  if (!isNonEmptyString(slug)) {
    throw new Error('normalizeSessionRoster: slug가 비어 있습니다 — 세션 슬러그를 문자열로 주세요.');
  }
  if (!SESSION_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `normalizeSessionRoster: 슬러그 "${slug}"는 MMDD로 시작하고 소문자 영문·숫자·하이픈만 써야 합니다.`
    );
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
        '현장 배부표와 세션 조회에서 같은 회차임을 즉시 확인할 수 있도록 날짜 표기를 맞추세요.'
    );
  }

  // 테넌시 상속 — 있으면 문자열이어야 하고 자기 자신을 가리킬 수 없다(자기를 읽는 insert가 된다).
  const inheritTenancyFrom = definition.inheritTenancyFrom ?? null;
  if (inheritTenancyFrom !== null) {
    if (!isNonEmptyString(inheritTenancyFrom)) {
      throw new Error(
        `normalizeSessionRoster: "${slug}"의 inheritTenancyFrom은 비어 있지 않은 슬러그여야 합니다 ` +
          `(받은 값: ${inheritTenancyFrom}). org_id를 물려받을 기존 세션의 slug를 적으세요.`
      );
    }
    if (inheritTenancyFrom === slug) {
      throw new Error(
        `normalizeSessionRoster: "${slug}"의 inheritTenancyFrom이 자기 자신입니다 — ` +
          '아직 없는 세션에서 org_id를 읽는 시드가 됩니다.'
      );
    }
    if (!SESSION_SLUG_PATTERN.test(inheritTenancyFrom)) {
      throw new Error(
        `normalizeSessionRoster: "${slug}"의 inheritTenancyFrom 형식이 안전하지 않습니다.`
      );
    }
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
    if (hasControlCharacters(team.name) || hasControlCharacters(team.subgroup)) {
      throw new Error(`normalizeSessionRoster: ${where}의 name/subgroup에 제어 문자를 쓸 수 없습니다.`);
    }
    if (!Number.isInteger(team.ordinal) || team.ordinal < 1 || team.ordinal > 99) {
      throw new Error(
        `normalizeSessionRoster: ${where}(${team.name})의 ordinal은 1..99 정수여야 합니다 ` +
          `(받은 값: ${team.ordinal}). 화면·명찰·배부표에서 사용할 고정 정렬 순서입니다.`
      );
    }
    if (seenNames.has(team.name)) {
      throw new Error(`normalizeSessionRoster: "${slug}"에 조 이름 "${team.name}"이 두 번 있습니다.`);
    }
    if (seenOrdinals.has(team.ordinal)) {
      throw new Error(
        `normalizeSessionRoster: "${slug}"에 ordinal ${team.ordinal}이 두 번 있습니다 — ` +
          '조 정렬 순서는 세션 안에서 고유해야 합니다.'
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
    inheritTenancyFrom,
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
