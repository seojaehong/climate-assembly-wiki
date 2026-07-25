/**
 * 조 표시 순서의 단일 정본. 8/29 회차의 표준 순서는
 * `1분과 1~5조 → 2분과 1~5조 → 3분과 1~5조`이며, 이 순서는 조 이름에서만 도출한다.
 *
 * 왜 이름 파싱인가: 시드(scripts/seed-0829-lib.mjs)의 ordinal은 DB `climate_vote.team`에
 * 저장되지 않고, 순번이 인코딩된 join_code는 공개 RPC `hq_teams()`가 의도적으로 반환하지
 * 않는다(개인·운영 비밀 경계). 따라서 /hq가 가진 유일한 정렬 키는 name이다.
 *
 * Postgres는 `order by` 없는 함수 결과의 행 순서를 보장하지 않으므로, 렌더 순서를
 * 결정적으로 만들려면 클라이언트에서 전순서(total order)를 세워야 한다.
 */

/** 정렬에 필요한 최소 형태 — HqTeam·Team 양쪽에 모두 적용된다. */
export type OrderableTeam = { id: string; name: string; subgroup: string | null };

const TEAM_NAME = /^(\d+)분과\s*(\d+)조$/;
const SUBGROUP_NAME = /^(\d+)분과$/;

/** 표준 이름이면 [분과번호, 조번호], 아니면 null. */
function parseTeamName(name: string): [number, number] | null {
  const matched = TEAM_NAME.exec(name.trim());
  if (!matched) return null;
  return [Number(matched[1]), Number(matched[2])];
}

/**
 * 표준 조 순서 비교자. 전순서를 보장한다 —
 * 표준 이름(분과·조 번호 오름차순) → 비표준 이름(한국어 사전순) → id(동점 최종 타이브레이크).
 */
export function compareTeams(a: OrderableTeam, b: OrderableTeam): number {
  const left = parseTeamName(a.name);
  const right = parseTeamName(b.name);

  if (left && right) {
    if (left[0] !== right[0]) return left[0] - right[0];
    if (left[1] !== right[1]) return left[1] - right[1];
  } else if (left) {
    return -1;
  } else if (right) {
    return 1;
  } else {
    const byName = a.name.localeCompare(b.name, 'ko-KR');
    if (byName !== 0) return byName;
  }

  return a.id.localeCompare(b.id);
}

/** 원본 배열을 보존한 채 표준 조 순서로 정렬한 사본을 반환한다. */
export function sortTeamsStandard<T extends OrderableTeam>(teams: T[]): T[] {
  return [...teams].sort(compareTeams);
}

/**
 * 분과 필터 옵션. `전체`를 맨 앞에 두고 분과를 번호 순으로 나열한다.
 * 조 목록의 도착 순서에 의존하지 않는다.
 */
export function subgroupFilterOptions(teams: OrderableTeam[]): string[] {
  const unique = Array.from(
    new Set(teams.map((team) => team.subgroup).filter((value): value is string => Boolean(value))),
  );

  unique.sort((a, b) => {
    const left = SUBGROUP_NAME.exec(a);
    const right = SUBGROUP_NAME.exec(b);
    if (left && right) return Number(left[1]) - Number(right[1]);
    if (left) return -1;
    if (right) return 1;
    return a.localeCompare(b, 'ko-KR');
  });

  return ['전체', ...unique];
}
