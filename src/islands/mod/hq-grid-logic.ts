import { tallyVotes, type HqTeam, type Round, type Vote } from '../../lib/mod-console';

export type TeamCellResult = { label: '대기' | '투표중' | '마감'; participation: string };
export type HqSummary = { total: number; waiting: number; polling: number; closed: number };
export type HqConnectionState = 'loading' | 'refreshing' | 'live' | 'stale' | 'failed' | 'degraded';
export type LeadingResult = { option: string; count: number; tied: boolean } | null;
export type ComparisonSelection = { ids: string[]; limitReached: boolean };

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

/** 상세·비교 화면에서 보여줄 팀의 현재 라운드. 활성 라운드를 우선하고, 없으면 최신 마감 라운드다. */
export function latestTeamRound(teamId: string, rounds: Round[]): Round | null {
  const teamRounds = rounds
    .filter((round) => round.team_id === teamId)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return teamRounds.find((round) => round.status === 'active') ?? latestClosedRound(teamRounds) ?? null;
}

/** 최근 투표의 선두 선택지. 공동 선두 여부를 함께 반환하고, 득표가 없으면 null이다. */
export function leadingResult(round: Round | null, votes: Vote[]): LeadingResult {
  if (!round) return null;
  const ranked = Object.entries(tallyVotes(round, votes).byOption).sort(
    ([optionA, countA], [optionB, countB]) => countB - countA || optionA.localeCompare(optionB, 'ko-KR'),
  );
  if (ranked.length === 0 || ranked[0][1] === 0) return null;
  return {
    option: ranked[0][0],
    count: ranked[0][1],
    tied: ranked.length > 1 && ranked[1][1] === ranked[0][1],
  };
}

/** 비교 선택을 토글한다. 이미 선택된 조는 해제하고, 최대치에서는 기존 선택을 보존한다. */
export function toggleComparisonSelection(currentIds: string[], teamId: string, maxTeams = 3): ComparisonSelection {
  if (currentIds.includes(teamId)) {
    return { ids: currentIds.filter((id) => id !== teamId), limitReached: false };
  }
  if (currentIds.length >= maxTeams) return { ids: currentIds, limitReached: true };
  return { ids: [...currentIds, teamId], limitReached: false };
}

export function summarizeTeamCells(
  teams: HqTeam[],
  rounds: Round[],
  voteCounts: Record<string, number>,
): HqSummary {
  const summary: HqSummary = { total: teams.length, waiting: 0, polling: 0, closed: 0 };
  for (const team of teams) {
    const label = teamCell(team, rounds, voteCounts).label;
    if (label === '대기') summary.waiting += 1;
    if (label === '투표중') summary.polling += 1;
    if (label === '마감') summary.closed += 1;
  }
  return summary;
}

export function teamMatchesFilters(
  team: HqTeam,
  cell: TeamCellResult,
  statusFilter: '전체' | TeamCellResult['label'],
  subgroupFilter: string,
): boolean {
  const statusMatches = statusFilter === '전체' || cell.label === statusFilter;
  const subgroupMatches = subgroupFilter === '전체' || team.subgroup === subgroupFilter;
  return statusMatches && subgroupMatches;
}

export function hqConnectionState(input: {
  updatedAtMs: number | null;
  nowMs: number;
  refreshing: boolean;
  hasError: boolean;
  staleAfterMs: number;
}): HqConnectionState {
  if (input.updatedAtMs == null) return input.hasError ? 'failed' : 'loading';
  if (input.hasError) return 'degraded';
  if (input.nowMs - input.updatedAtMs > input.staleAfterMs) return 'stale';
  if (input.refreshing) return 'refreshing';
  return 'live';
}
