import type { HqTeam, Round } from '../../lib/mod-console';

export type TeamCellResult = { label: '대기' | '투표중' | '마감'; participation: string };

function latestClosedRound(rounds: Round[]): Round | undefined {
  return [...rounds]
    .filter((r) => r.status === 'closed')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
}

/**
 * 팀 카드의 상태 라벨 + 참여 표기를 도출한다.
 * - 팀의 활성(active) 라운드가 있으면 '투표중' + 해당 라운드 표수/capacity.
 * - 없고 마감(closed) 라운드가 있으면(가장 최근 것) '마감' + 그 라운드 표수/capacity.
 * - 둘 다 없으면 '대기' + 0/capacity.
 */
export function teamCell(team: HqTeam, rounds: Round[], voteCounts: Record<string, number>): TeamCellResult {
  // 스키마상 팀당 active 라운드가 2개 이상일 수 있어(동시 다건 오픈), 호출자의 정렬 순서에
  // 기대지 않도록 여기서 created_at desc로 한 번 정렬한 사본을 두 선택 경로(active .find /
  // closed 최신 선택)가 공유한다 — order-independent 보장.
  const teamRounds = rounds
    .filter((r) => r.team_id === team.id)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  const active = teamRounds.find((r) => r.status === 'active');
  if (active) {
    const n = voteCounts[active.id] ?? 0;
    return { label: '투표중', participation: `${n}/${team.capacity}` };
  }

  const closed = latestClosedRound(teamRounds);
  if (closed) {
    const n = voteCounts[closed.id] ?? 0;
    return { label: '마감', participation: `${n}/${team.capacity}` };
  }

  return { label: '대기', participation: `0/${team.capacity}` };
}

/** 표 카운트 조회가 필요한 라운드 id만 골라낸다 — 팀당 활성 라운드 또는 최신 마감 라운드 1개. */
export function relevantRoundIds(teams: HqTeam[], rounds: Round[]): string[] {
  const ids: string[] = [];
  for (const team of teams) {
    const teamRounds = rounds.filter((r) => r.team_id === team.id);
    const active = teamRounds.find((r) => r.status === 'active');
    if (active) {
      ids.push(active.id);
      continue;
    }
    const closed = latestClosedRound(teamRounds);
    if (closed) ids.push(closed.id);
  }
  return ids;
}
