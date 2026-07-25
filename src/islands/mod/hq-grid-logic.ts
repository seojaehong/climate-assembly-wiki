import { tallyVotes, type HqTeam, type Round, type Vote } from '../../lib/mod-console';
import { roundSequence, teamRoundHistory, type TeamRoundHistoryItem } from './round-sequence';

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

/** /hq 회차별 보기의 선택값. 'current'는 기존 동작(활성 라운드 → 없으면 최신 마감)이다. */
export type RoundView = 'current' | number;

/**
 * 회차별 보기에서 카드 한 장이 보여줄 값.
 *
 * - label이 '미실시'면 그 조에 해당 회차 라운드가 **아예 없다**(participation은 항상 null).
 * - label이 실제 상태인데 participation이 null이면 라운드는 있고 **표를 아직 못 받았다**.
 *
 * '미실시'와 '0표'는 화면에서 반드시 다르게 보여야 한다 — 같은 표기를 쓰면 본부가
 * "그 조는 투표했는데 아무도 안 찍었다"로 오판한다. 상태 배지는 rounds에서 바로 나오므로
 * 표 조회가 실패해도 정확하다(부분 열화).
 */
export type RoundViewCell = { label: TeamCellResult['label'] | '미실시'; participation: string | null };

const SEQUENCE_CELL_LABEL: Record<Round['status'], TeamCellResult['label']> = {
  pending: '대기',
  active: '투표중',
  closed: '마감',
};

/** 그 조의 N차 라운드. 회차 번호는 roundSequence(조별 created_at 오름차순)에서 나온다. */
function teamRoundAtSequence(teamId: string, rounds: Round[], sequence: number): Round | null {
  const numbers = roundSequence(teamId, rounds);
  return rounds.find((round) => round.team_id === teamId && numbers.get(round.id) === sequence) ?? null;
}

/**
 * 회차별 보기에서 한 조의 카드 값을 구한다.
 * 'current'는 기존 teamCell 그대로이고, 숫자를 주면 그 조의 N차 라운드를 기준으로 계산한다.
 */
export function teamCellForRoundView(
  team: HqTeam,
  rounds: Round[],
  voteCounts: Record<string, number>,
  view: RoundView,
): RoundViewCell {
  if (view === 'current') return teamCell(team, rounds, voteCounts);
  const round = teamRoundAtSequence(team.id, rounds, view);
  if (!round) return { label: '미실시', participation: null };
  const count = voteCounts[round.id];
  return {
    label: SEQUENCE_CELL_LABEL[round.status],
    participation: count == null ? null : `${count}/${team.capacity}`,
  };
}

/**
 * N차 표를 조회해야 할 라운드 id — 각 조의 N차 라운드 하나씩(그 회차가 없는 조는 제외).
 * relevantRoundIds의 회차판이며, teamCellForRoundView가 찾는 라운드와 **같은 것**을 골라야 한다.
 */
export function roundIdsForSequence(teams: HqTeam[], rounds: Round[], sequence: number): string[] {
  const ids: string[] = [];
  for (const team of teams) {
    const round = teamRoundAtSequence(team.id, rounds, sequence);
    if (round) ids.push(round.id);
  }
  return ids;
}

/** 조 상세의 라운드 이력 한 줄. teamRoundHistory에 그 회차의 선두 선택지를 얹은 것이다. */
export type TeamRoundHistoryEntry = TeamRoundHistoryItem & { leader: LeadingResult };

/**
 * 한 조의 라운드 이력을 최신 회차부터 만들고, 각 줄에 총 표수와 선두 선택지를 붙인다.
 *
 * 표 맵을 **두 개** 받는다. /hq는 전체 조의 '현재 라운드'만 주기적으로 새로 받아오고(liveVotesByRound),
 * 지난 회차 표는 상세 패널을 열 때 한 번만 조회하기(historyVotesByRound) 때문이다.
 * 같은 라운드가 양쪽에 있으면 **전역(live) 쪽이 이긴다** — 진행 중 라운드가 패널을 연 시점 값으로
 * 얼어붙지 않게 하려는 것이다. 이 방향이 뒤집히면 카드의 참여 숫자와 이력의 총 표수가 어긋난다.
 *
 * total은 키가 없으면 null(아직 조회하지 못함), 빈 배열이면 0(정말 0표)이다 — 화면에서 반드시
 * 구분해야 한다. 조회 실패와 조회 전을 가르는 것은 이 함수가 아니라 호출부의 로드 상태다.
 */
export function teamRoundHistoryWithResults(
  teamId: string,
  rounds: Round[],
  historyVotesByRound: Record<string, Vote[]>,
  liveVotesByRound: Record<string, Vote[]> = {},
): TeamRoundHistoryEntry[] {
  return teamRoundHistory(teamId, rounds).map((item) => {
    const votes = liveVotesByRound[item.id] ?? historyVotesByRound[item.id];
    if (votes == null) return { ...item, total: null, leader: null };
    return { ...item, total: tallyVotes(item.round, votes).total, leader: leadingResult(item.round, votes) };
  });
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
