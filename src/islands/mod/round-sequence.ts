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

/** 한 조의 지난 투표 한 줄. /mod 홈의 '지난 투표' 목록과 /hq 조 상세 이력이 함께 쓴다. */
export interface TeamRoundHistoryItem {
  id: string;
  /** 이 조에서 몇 번째 투표인가(1부터). */
  sequence: number;
  title: string;
  status: Round['status'];
  /**
   * 마감 시각(ISO). 마감된 라운드에만 붙고, 그 외에는 null이다.
   * 값이 없는 마감 라운드도 null 그대로 둔다 — created_at으로 대체하면 가짜 마감 시각이 된다.
   * 표시용 포맷(로컬 시:분)은 이 저장소 관례대로 컴포넌트에서 한다(테스트가 타임존에 흔들리지 않게).
   */
  closedAt: string | null;
  /** 총 표수. 조회하지 못한 라운드는 null이다 — '0표'와 반드시 구분한다. */
  total: number | null;
  /** 결과 다시보기에 그대로 넘길 원본 라운드. */
  round: Round;
}

/**
 * 한 조의 라운드 이력을 화면에 뿌릴 순서(최신 회차가 먼저)로 만든다.
 * 회차 번호는 roundSequence와 같은 전순서에서 나오므로 두 화면의 '2차'가 항상 같은 라운드를 가리킨다.
 *
 * status로 거르지 않는다 — 진행 중 라운드도 목록에 '진행 중'으로 남아야 하고,
 * 무엇을 어떻게 라벨할지는 호출부가 정한다.
 */
export function teamRoundHistory(
  teamId: string,
  rounds: Round[],
  counts: Record<string, number> = {},
): TeamRoundHistoryItem[] {
  const sequence = roundSequence(teamId, rounds);
  return rounds
    .filter((round) => round.team_id === teamId)
    .map((round) => ({
      id: round.id,
      sequence: sequence.get(round.id) ?? 0,
      title: round.title,
      status: round.status,
      closedAt: round.status === 'closed' ? round.updated_at ?? null : null,
      total: counts[round.id] ?? null,
      round,
    }))
    .sort((a, b) => b.sequence - a.sequence);
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
