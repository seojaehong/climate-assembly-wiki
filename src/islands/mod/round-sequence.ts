import type { Round } from '../../lib/mod-console';

/**
 * 라운드의 전순서 비교자. created_at 오름차순이 1차 기준이고, 같거나 없으면 id로 갈린다.
 * - created_at이 없는 라운드는 ''로 읽혀 가장 오래된 쪽에 놓인다(hq-grid-logic.ts와 같은 관례).
 * - id 비교는 `localeCompare`가 아니라 코드유닛 비교다. UUID의 하이픈은 ICU 로캘 대조에서
 *   가변 가중치를 받아 환경에 따라 순서가 달라질 수 있는데, 회차 번호는 어디서 계산해도
 *   같아야 하기 때문이다.
 */
function compareRounds(a: Round, b: Round): number {
  const byCreatedAt = (a.created_at ?? '').localeCompare(b.created_at ?? '');
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 한 조의 라운드에 1차·2차… 회차 번호를 붙인다. 반환값은 `라운드 id → 회차 번호` Map이다.
 *
 * 회차는 DB에 저장하지 않고 여기서 도출한다 — 라운드 생성 순서가 곧 회차이고,
 * 컬럼을 두면 재정렬·삭제 시 저장값과 실제 순서가 어긋난다.
 *
 * status는 보지 않는다(pending·active·closed 모두 번호를 받는다). '미실시' 구분은
 * 회차가 아니라 조회 결과의 문제라 이 함수가 판단할 일이 아니다.
 * 입력 배열 순서에 의존하지 않으며, 인자로 받은 배열을 변형하지 않는다.
 */
export function roundSequence(teamId: string, rounds: Round[]): Map<string, number> {
  const ordered = rounds.filter((round) => round.team_id === teamId).sort(compareRounds);
  const sequence = new Map<string, number>();
  ordered.forEach((round, index) => sequence.set(round.id, index + 1));
  return sequence;
}

/**
 * 전체 조 중 가장 큰 회차 번호. 회차 필터 옵션('1차'~'N차')을 만들 때 쓴다.
 * team_id가 없는 라운드(조 스코프가 아닌 전체 투표)는 세지 않고, 대상이 없으면 0이다.
 */
export function maxRoundSequence(rounds: Round[]): number {
  const countByTeam = new Map<string, number>();
  for (const round of rounds) {
    if (round.team_id == null) continue;
    countByTeam.set(round.team_id, (countByTeam.get(round.team_id) ?? 0) + 1);
  }
  let max = 0;
  for (const count of countByTeam.values()) {
    if (count > max) max = count;
  }
  return max;
}
