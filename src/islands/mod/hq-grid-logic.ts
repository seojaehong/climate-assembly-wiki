import { tallyVotes, type HqTeam, type Round, type Vote } from '../../lib/mod-console';
import { roundSequence, teamRoundHistory, type TeamRoundHistoryItem } from './round-sequence';
import type { ResultImageInput } from './result-image';
// svg-to-png.ts는 모듈 최상단에서 DOM을 만지지 않는다(그 파일의 주석 참조) — 순수 함수만 가져온다.
// 파일명 치환 규칙을 여기서 다시 쓰지 않는 이유: 두 벌로 나뉘면 한쪽만 고쳐져 한글이 사라진다.
import { resultZipEntryName } from './svg-to-png';

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

/** 전수 내려받기의 한 장. `path`는 ZIP 안의 경로이고, `image`는 renderResultSvg에 그대로 넘긴다. */
export interface ResultExportJob {
  path: string;
  image: ResultImageInput;
}

/**
 * 모든 조 · 모든 회차의 결과 이미지 목록을 만든다(전수 내려받기용).
 *
 * 그림을 여기서 그리지 않고 **입력값만** 만든다 — 문자열 SVG를 반환하면 테스트가 거대해지고,
 * 렌더러 교체가 이 함수를 흔든다. 실제 렌더·PNG 변환은 브라우저 쪽 호출부가 한다.
 *
 * - 회차 번호는 `teamRoundHistory`에서 나온다. 그래야 ZIP의 '2차'가 사람이 /hq·/mod 화면에서
 *   본 그 2차와 **같은 라운드**다(회차를 여기서 다시 세면 두 기준이 조용히 갈라진다).
 * - 목록은 조 순서 → 회차 오름차순이다(사람이 폴더를 열었을 때 1차부터 보이게).
 * - `votesByRound`에 **키가 없는 라운드는 건너뛴다.** 없는 것을 0표로 그리면 '표 없음'이라
 *   적힌 가짜 기록물이 남는다 — 없느니만 못하다. 빈 배열(정말 0표)은 그대로 담는다.
 * - status로 거르지 않는다. pending 라운드도 '표 없음' 한 장으로 남는다 — '전수'의 뜻대로다.
 * - `formatClosedAt`을 인자로 받는 이유: 시각 포맷은 실행 환경 타임존에 의존해서 순수 함수가
 *   될 수 없다(이 저장소 관례 — result-image.ts는 이미 포맷된 문자열을 받는다).
 */
export function resultExportJobs(
  teams: HqTeam[],
  rounds: Round[],
  votesByRound: Record<string, Vote[]>,
  formatClosedAt: (iso: string) => string | null,
): ResultExportJob[] {
  const jobs: ResultExportJob[] = [];
  for (const team of teams) {
    const history = [...teamRoundHistory(team.id, rounds)].sort((a, b) => a.sequence - b.sequence);
    for (const item of history) {
      const votes = votesByRound[item.id];
      if (votes == null) continue;
      const tally = tallyVotes(item.round, votes);
      // options가 null인 라운드(SCALE)는 집계 키가 유일한 선택지 목록이다.
      const options = item.round.options ?? Object.keys(tally.byOption);
      jobs.push({
        path: resultZipEntryName({ teamName: team.name, sequence: item.sequence, title: item.title }),
        image: {
          teamName: team.name,
          sequence: item.sequence,
          title: item.title,
          closedAtLabel: item.closedAt ? formatClosedAt(item.closedAt) : null,
          total: tally.total,
          results: options.map((option) => ({ option, count: tally.byOption[option] ?? 0 })),
        },
      });
    }
  }
  return jobs;
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
