import { describe, it, expect } from 'vitest';
import {
  hqConnectionState,
  latestTeamRound,
  leadingResult,
  toggleComparisonSelection,
  teamCell,
  relevantRoundIds,
  summarizeTeamCells,
  teamMatchesFilters,
  teamRoundHistoryWithResults,
  teamCellForRoundView,
  roundIdsForSequence,
  resultExportJobs,
} from './hq-grid-logic';
import type { HqTeam, Round, Vote } from '../../lib/mod-console';

const team: HqTeam = { id: 't1', name: '1조', subgroup: '교육', capacity: 14, status: 'active' , table_no: null };

function round(overrides: Partial<Round> & { id: string }): Round {
  return {
    title: 't',
    type: 'RADIO',
    options: ['A', 'B'],
    status: 'pending',
    team_id: 't1',
    ...overrides,
  } as Round;
}

describe('teamCell', () => {
  it('활성 라운드 있으면 투표중 + n/capacity', () => {
    const rounds = [round({ id: 'r1', status: 'active', created_at: '2026-07-24T01:00:00Z' })];
    const result = teamCell(team, rounds, { r1: 5 });
    expect(result).toEqual({ label: '투표중', participation: '5/14' });
  });

  it('활성 라운드 없고 마감 라운드 있으면 마감 + 최근 결과 참여수', () => {
    const rounds = [
      round({ id: 'r1', status: 'closed', created_at: '2026-07-24T01:00:00Z' }),
      round({ id: 'r2', status: 'closed', created_at: '2026-07-24T02:00:00Z' }),
    ];
    const result = teamCell(team, rounds, { r1: 3, r2: 9 });
    expect(result).toEqual({ label: '마감', participation: '9/14' });
  });

  it('라운드 전혀 없으면 대기', () => {
    const result = teamCell(team, [], {});
    expect(result).toEqual({ label: '대기', participation: '0/14' });
  });

  it('voteCounts에 값이 없으면 0으로 처리', () => {
    const rounds = [round({ id: 'r1', status: 'active', created_at: '2026-07-24T01:00:00Z' })];
    const result = teamCell(team, rounds, {});
    expect(result).toEqual({ label: '투표중', participation: '0/14' });
  });

  it('다른 팀의 라운드는 무시한다', () => {
    const rounds = [round({ id: 'r1', status: 'active', team_id: 'other-team', created_at: '2026-07-24T01:00:00Z' })];
    const result = teamCell(team, rounds, { r1: 5 });
    expect(result).toEqual({ label: '대기', participation: '0/14' });
  });

  it('팀에 active 라운드 2개(비정렬 입력) → 최신 created_at 선택', () => {
    // 스키마상 팀당 active 라운드가 2개 이상일 수 있음. 입력 순서(older-first)에
    // 의존하지 않고 created_at 기준 최신 라운드를 선택해야 한다.
    const rounds = [
      round({ id: 'r-older', status: 'active', created_at: '2026-07-24T01:00:00Z' }),
      round({ id: 'r-newer', status: 'active', created_at: '2026-07-24T02:00:00Z' }),
    ];
    const result = teamCell(team, rounds, { 'r-older': 3, 'r-newer': 9 });
    expect(result).toEqual({ label: '투표중', participation: '9/14' });
  });
});

describe('relevantRoundIds', () => {
  it('활성/마감 라운드가 있는 팀만 id를 반환한다', () => {
    const teams: HqTeam[] = [
      team,
      { id: 't2', name: '2조', subgroup: null, capacity: 10, status: 'active' , table_no: null },
      { id: 't3', name: '3조', subgroup: null, capacity: 10, status: 'active' , table_no: null },
    ];
    const rounds = [
      round({ id: 'r1', status: 'active', team_id: 't1', created_at: '2026-07-24T01:00:00Z' }),
      round({ id: 'r2', status: 'closed', team_id: 't2', created_at: '2026-07-24T01:00:00Z' }),
      round({ id: 'r3', status: 'closed', team_id: 't2', created_at: '2026-07-24T02:00:00Z' }),
      // t3: 라운드 없음
    ];
    expect(relevantRoundIds(teams, rounds)).toEqual(['r1', 'r3']);
  });
});

describe('latestTeamRound and leadingResult', () => {
  it('활성 라운드를 우선하고, 없으면 최신 마감 라운드를 선택한다', () => {
    const rounds = [
      round({ id: 'closed-new', status: 'closed', created_at: '2026-07-24T03:00:00Z' }),
      round({ id: 'active-old', status: 'active', created_at: '2026-07-24T01:00:00Z' }),
    ];
    expect(latestTeamRound('t1', rounds)?.id).toBe('active-old');
    expect(latestTeamRound('missing', rounds)).toBeNull();
  });

  it('선두 선택지와 공동 선두를 도출하고 무득표는 null로 처리한다', () => {
    const target = round({ id: 'r1', status: 'closed' });
    const votes = [
      { id: 1, round_id: 'r1', choice: 'A', archived_at: null },
      { id: 2, round_id: 'r1', choice: 'B', archived_at: null },
      { id: 3, round_id: 'r1', choice: 'A', archived_at: null },
    ];
    expect(leadingResult(target, votes)).toEqual({ option: 'A', count: 2, tied: false });
    expect(leadingResult(target, votes.slice(0, 2))).toEqual({ option: 'A', count: 1, tied: true });
    expect(leadingResult(target, [])).toBeNull();
  });
});

describe('toggleComparisonSelection', () => {
  it('최대 3개까지 추가하고 선택된 조는 다시 누르면 해제한다', () => {
    expect(toggleComparisonSelection([], 't1')).toEqual({ ids: ['t1'], limitReached: false });
    expect(toggleComparisonSelection(['t1', 't2'], 't3')).toEqual({
      ids: ['t1', 't2', 't3'],
      limitReached: false,
    });
    expect(toggleComparisonSelection(['t1', 't2'], 't1')).toEqual({ ids: ['t2'], limitReached: false });
  });

  it('최대치에서는 기존 선택을 보존하고 제한 도달을 알린다', () => {
    expect(toggleComparisonSelection(['t1', 't2', 't3'], 't4')).toEqual({
      ids: ['t1', 't2', 't3'],
      limitReached: true,
    });
  });
});

describe('summarizeTeamCells', () => {
  it('대기·투표중·마감 상태를 전체 조 기준으로 집계한다', () => {
    const teams: HqTeam[] = [
      team,
      { id: 't2', name: '2조', subgroup: '전환', capacity: 10, status: 'active' , table_no: null },
      { id: 't3', name: '3조', subgroup: '전환', capacity: 10, status: 'active' , table_no: null },
    ];
    const rounds = [
      round({ id: 'r1', status: 'active', team_id: 't1', created_at: '2026-07-24T03:00:00Z' }),
      round({ id: 'r2', status: 'closed', team_id: 't2', created_at: '2026-07-24T02:00:00Z' }),
    ];

    expect(summarizeTeamCells(teams, rounds, { r1: 4, r2: 7 })).toEqual({
      total: 3,
      waiting: 1,
      polling: 1,
      closed: 1,
    });
  });
});

describe('teamMatchesFilters', () => {
  it('상태와 분과 필터를 함께 적용한다', () => {
    const cell = { label: '투표중', participation: '5/14' } as const;
    expect(teamMatchesFilters(team, cell, '전체', '전체')).toBe(true);
    expect(teamMatchesFilters(team, cell, '투표중', '교육')).toBe(true);
    expect(teamMatchesFilters(team, cell, '마감', '교육')).toBe(false);
    expect(teamMatchesFilters(team, cell, '투표중', '전환')).toBe(false);
  });
});

describe('hqConnectionState', () => {
  const base = { nowMs: 70_000, staleAfterMs: 65_000 };

  it('첫 로딩과 첫 연결 실패를 구분한다', () => {
    expect(hqConnectionState({ ...base, updatedAtMs: null, refreshing: true, hasError: false })).toBe('loading');
    expect(hqConnectionState({ ...base, updatedAtMs: null, refreshing: false, hasError: true })).toBe('failed');
  });

  it('성공 데이터가 있으면 실시간·갱신중·지연·성능저하를 구분한다', () => {
    expect(hqConnectionState({ ...base, updatedAtMs: 60_000, refreshing: false, hasError: false })).toBe('live');
    expect(hqConnectionState({ ...base, updatedAtMs: 60_000, refreshing: true, hasError: false })).toBe('refreshing');
    expect(hqConnectionState({ ...base, updatedAtMs: 0, refreshing: false, hasError: false })).toBe('stale');
    expect(hqConnectionState({ ...base, updatedAtMs: 60_000, refreshing: false, hasError: true })).toBe('degraded');
  });
});

describe('teamRoundHistoryWithResults', () => {
  function vote(id: number, roundId: string, choice: unknown, archivedAt: string | null = null): Vote {
    return { id, round_id: roundId, choice, archived_at: archivedAt };
  }

  const first = round({
    id: 'r1',
    title: '1차 질문',
    status: 'closed',
    created_at: '2026-08-29T09:00:00Z',
    updated_at: '2026-08-29T09:20:00Z',
  });
  const second = round({ id: 'r2', title: '2차 질문', status: 'active', created_at: '2026-08-29T10:00:00Z' });

  it('최신 회차가 먼저 나오고 회차·제목·상태·마감 시각이 붙는다', () => {
    const entries = teamRoundHistoryWithResults('t1', [second, first], {});
    expect(entries.map((entry) => [entry.sequence, entry.title, entry.status, entry.closedAt])).toEqual([
      [2, '2차 질문', 'active', null],
      [1, '1차 질문', 'closed', '2026-08-29T09:20:00Z'],
    ]);
  });

  it('표를 아직 받아오지 못한 라운드는 총 표수가 null이다 — 0표와 구분된다', () => {
    const [entry] = teamRoundHistoryWithResults('t1', [first], {});
    expect(entry.total).toBeNull();
    expect(entry.leader).toBeNull();
  });

  it('키가 있고 표가 0건이면 총 표수는 0이다', () => {
    const [entry] = teamRoundHistoryWithResults('t1', [first], { r1: [] });
    expect(entry.total).toBe(0);
    expect(entry.leader).toBeNull();
  });

  it('전역(실시간) 표가 이력 조회분을 이긴다 — 진행 중 라운드가 스테일해지지 않게', () => {
    const entries = teamRoundHistoryWithResults(
      't1',
      [second],
      { r2: [vote(1, 'r2', 'A')] },
      { r2: [vote(1, 'r2', 'A'), vote(2, 'r2', 'A'), vote(3, 'r2', 'B')] },
    );
    expect(entries[0].total).toBe(3);
    expect(entries[0].leader).toEqual({ option: 'A', count: 2, tied: false });
  });

  it('보관된(archived) 표는 총 표수에서 제외한다', () => {
    const [entry] = teamRoundHistoryWithResults('t1', [first], {
      r1: [vote(1, 'r1', 'A'), vote(2, 'r1', 'B', '2026-08-29T09:10:00Z')],
    });
    expect(entry.total).toBe(1);
    expect(entry.leader).toEqual({ option: 'A', count: 1, tied: false });
  });

  it('공동 선두를 tied로 표시한다', () => {
    const [entry] = teamRoundHistoryWithResults('t1', [first], {
      r1: [vote(1, 'r1', 'A'), vote(2, 'r1', 'B')],
    });
    expect(entry.leader?.tied).toBe(true);
  });

  it('다른 팀의 라운드는 이력에 넣지 않는다', () => {
    const other = round({ id: 'rx', team_id: 't2', created_at: '2026-08-29T11:00:00Z' });
    const entries = teamRoundHistoryWithResults('t1', [other, first, second], { rx: [vote(9, 'rx', 'A')] });
    expect(entries.map((entry) => entry.id)).toEqual(['r2', 'r1']);
  });

  it('입력 배열 순서에 의존하지 않는다 (원본·역순·셔플)', () => {
    const third = round({ id: 'r3', title: '3차 질문', status: 'closed', created_at: '2026-08-29T11:00:00Z' });
    const votes = { r1: [vote(1, 'r1', 'A')], r2: [vote(2, 'r2', 'B')], r3: [] };
    const expected = teamRoundHistoryWithResults('t1', [first, second, third], votes);
    expect(teamRoundHistoryWithResults('t1', [third, second, first], votes)).toEqual(expected);
    expect(teamRoundHistoryWithResults('t1', [second, third, first], votes)).toEqual(expected);
    expect(expected.map((entry) => entry.sequence)).toEqual([3, 2, 1]);
  });

  it('현재 라운드의 총 표수는 카드 참여 표기의 분자와 같다', () => {
    const rounds = [first, second];
    const votes = { r2: [vote(1, 'r2', 'A'), vote(2, 'r2', 'B'), vote(3, 'r2', 'A')] };
    const current = latestTeamRound('t1', rounds);
    const entries = teamRoundHistoryWithResults('t1', rounds, votes);
    const currentEntry = entries.find((entry) => entry.id === current?.id);
    const numerator = Number(teamCell(team, rounds, { r2: 3 }).participation.split('/')[0]);
    expect(currentEntry?.total).toBe(numerator);
  });

  it('라운드가 없는 조는 빈 배열이다', () => {
    expect(teamRoundHistoryWithResults('t1', [], {})).toEqual([]);
  });
});

describe('teamCellForRoundView / roundIdsForSequence', () => {
  // 1조는 1차(a1 마감)·2차(a2 진행 중)를 했고, 2조는 1차(b1 마감)만 했다.
  // 즉 '2차' 보기에서 2조는 '0표'가 아니라 '미실시'다 — 본부가 이 둘을 섞으면 진행 상황을 오판한다.
  const teamA: HqTeam = { id: 't1', name: '1조', subgroup: '교육', capacity: 12, status: 'active' , table_no: null };
  const teamB: HqTeam = { id: 't2', name: '2조', subgroup: '교육', capacity: 10, status: 'active' , table_no: null };
  const viewRounds = [
    round({ id: 'a1', team_id: 't1', status: 'closed', created_at: '2026-08-29T01:00:00Z' }),
    round({ id: 'a2', team_id: 't1', status: 'active', created_at: '2026-08-29T02:00:00Z' }),
    round({ id: 'b1', team_id: 't2', status: 'closed', created_at: '2026-08-29T01:30:00Z' }),
  ];

  it("'현재'는 기존 teamCell과 같은 값이다", () => {
    const counts = { a2: 5, b1: 4 };
    expect(teamCellForRoundView(teamA, viewRounds, counts, 'current')).toEqual(teamCell(teamA, viewRounds, counts));
    expect(teamCellForRoundView(teamA, viewRounds, counts, 'current')).toEqual({
      label: '투표중',
      participation: '5/12',
    });
  });

  it('N차를 고르면 그 조의 N차 라운드 상태와 표수가 나온다', () => {
    expect(teamCellForRoundView(teamA, viewRounds, { a1: 7, a2: 3 }, 1)).toEqual({
      label: '마감',
      participation: '7/12',
    });
    expect(teamCellForRoundView(teamA, viewRounds, { a1: 7, a2: 3 }, 2)).toEqual({
      label: '투표중',
      participation: '3/12',
    });
  });

  it("'미실시'와 '0표'는 같은 화면에서 서로 다른 값으로 나온다", () => {
    // 같은 회차·같은 counts로 두 조를 함께 본다 — 이 구분이 깨지면 둘 다 '0/N'이 된다.
    const counts = { a2: 0 };
    expect(teamCellForRoundView(teamA, viewRounds, counts, 2)).toEqual({ label: '투표중', participation: '0/12' });
    expect(teamCellForRoundView(teamB, viewRounds, counts, 2)).toEqual({ label: '미실시', participation: null });
  });

  it('라운드는 있는데 표를 아직 못 받았으면 상태는 그대로 두고 참여만 null이다', () => {
    // 부분 열화 — 배지는 rounds에서 나오므로 조회 실패·조회 전에도 정확하다.
    expect(teamCellForRoundView(teamA, viewRounds, {}, 2)).toEqual({ label: '투표중', participation: null });
  });

  it('그 조가 진행하지 않은 회차는 전부 미실시다', () => {
    expect(teamCellForRoundView(teamB, viewRounds, { b1: 4 }, 2)).toEqual({ label: '미실시', participation: null });
    expect(teamCellForRoundView(teamA, viewRounds, { a1: 7, a2: 3 }, 5)).toEqual({
      label: '미실시',
      participation: null,
    });
  });

  it('회차는 조별로 센다 — 다른 조의 라운드는 번호에 끼어들지 않는다', () => {
    // b1(01:30)은 a1(01:00)보다 늦지만 2조 기준으로는 1차다.
    expect(teamCellForRoundView(teamB, viewRounds, { b1: 4 }, 1)).toEqual({ label: '마감', participation: '4/10' });
  });

  it('pending 라운드도 회차 번호를 받고 대기로 표시된다', () => {
    const withPending = [
      ...viewRounds,
      round({ id: 'b2', team_id: 't2', status: 'pending', created_at: '2026-08-29T03:00:00Z' }),
    ];
    expect(teamCellForRoundView(teamB, withPending, {}, 2)).toEqual({ label: '대기', participation: null });
  });

  it('입력 배열 순서에 의존하지 않는다 (원본·역순·셔플)', () => {
    const counts = { a1: 7, a2: 3, b1: 4 };
    const expected = teamCellForRoundView(teamA, viewRounds, counts, 2);
    expect(teamCellForRoundView(teamA, [...viewRounds].reverse(), counts, 2)).toEqual(expected);
    expect(teamCellForRoundView(teamA, [viewRounds[1], viewRounds[2], viewRounds[0]], counts, 2)).toEqual(expected);
    expect(expected).toEqual({ label: '투표중', participation: '3/12' });
  });

  it('roundIdsForSequence는 그 회차를 진행한 조의 라운드 id만 준다', () => {
    expect(roundIdsForSequence([teamA, teamB], viewRounds, 1).sort()).toEqual(['a1', 'b1']);
    expect(roundIdsForSequence([teamA, teamB], viewRounds, 2)).toEqual(['a2']);
  });

  it('없는 회차·라운드 없는 조에서는 빈 배열이다', () => {
    expect(roundIdsForSequence([teamA, teamB], viewRounds, 3)).toEqual([]);
    expect(roundIdsForSequence([teamA, teamB], [], 1)).toEqual([]);
    expect(roundIdsForSequence([], viewRounds, 1)).toEqual([]);
  });

  it('roundIdsForSequence가 조회한 id로 모든 진행 조의 참여 수치가 채워진다', () => {
    // 두 함수가 서로 다른 라운드를 고르면 카드가 영원히 '집계 중'에 머문다.
    // 컴포넌트 테스트가 없어 이 어긋남을 잡을 수 있는 곳은 여기뿐이다.
    const teams = [teamA, teamB];
    for (const sequence of [1, 2, 3]) {
      const ids = roundIdsForSequence(teams, viewRounds, sequence);
      const counts = Object.fromEntries(ids.map((id, index) => [id, index + 1]));
      const cells = teams.map((team) => teamCellForRoundView(team, viewRounds, counts, sequence));
      for (const cell of cells) {
        if (cell.label === '미실시') expect(cell.participation).toBeNull();
        else expect(cell.participation).not.toBeNull();
      }
      expect(cells.filter((cell) => cell.label !== '미실시')).toHaveLength(ids.length);
    }
  });
});

describe('resultExportJobs', () => {
  function vote(id: number, roundId: string, choice: unknown): Vote {
    return { id, round_id: roundId, choice, archived_at: null };
  }

  const teamA: HqTeam = { id: 't1', name: '1분과 1조', subgroup: '1분과', capacity: 12, status: 'active' , table_no: null };
  const teamB: HqTeam = { id: 't2', name: '2분과 3조', subgroup: '2분과', capacity: 12, status: 'active' , table_no: null };

  /** 실제 화면과 같은 시각 문구를 쓰되, 테스트가 타임존에 흔들리지 않게 고정 문자열을 돌려준다. */
  const clock = () => '14:32';

  it('조별 폴더 · 회차 오름차순으로 내보낼 목록을 만든다', () => {
    const rounds = [
      round({ id: 'r2', team_id: 't1', title: '두 번째', created_at: '2026-08-29T02:00:00Z' }),
      round({ id: 'r1', team_id: 't1', title: '첫 번째', created_at: '2026-08-29T01:00:00Z' }),
      round({ id: 'r3', team_id: 't2', title: '다른 조', created_at: '2026-08-29T01:30:00Z' }),
    ];
    const jobs = resultExportJobs([teamA, teamB], rounds, { r1: [], r2: [], r3: [] }, clock);

    expect(jobs.map((job) => job.path)).toEqual([
      '1분과_1조/1차_첫_번째.png',
      '1분과_1조/2차_두_번째.png',
      '2분과_3조/1차_다른_조.png',
    ]);
    expect(jobs.map((job) => job.image.sequence)).toEqual([1, 2, 1]);
    expect(jobs[2].image.teamName).toBe('2분과 3조');
  });

  it('선택지 순서를 round.options 그대로 두고 득표를 채운다', () => {
    const rounds = [round({ id: 'r1', options: ['찬성', '반대', '유보'], status: 'closed' })];
    const votes = { r1: [vote(1, 'r1', '반대'), vote(2, 'r1', '반대'), vote(3, 'r1', '찬성')] };
    const [job] = resultExportJobs([teamA], rounds, votes, clock);

    expect(job.image.total).toBe(3);
    expect(job.image.results).toEqual([
      { option: '찬성', count: 1 },
      { option: '반대', count: 2 },
      { option: '유보', count: 0 },
    ]);
  });

  it('options가 null인 SCALE 라운드는 집계 키로 선택지를 만든다', () => {
    // options만 믿으면 SCALE 라운드의 선택지 목록이 통째로 비어 '표 없음' 그림이 나온다.
    const rounds = [round({ id: 'r1', type: 'SCALE', options: null, status: 'closed' })];
    const votes = { r1: [vote(1, 'r1', 3), vote(2, 'r1', 5), vote(3, 'r1', 3)] };
    const [job] = resultExportJobs([teamA], rounds, votes, clock);

    expect(job.image.results).toEqual([
      { option: '3', count: 2 },
      { option: '5', count: 1 },
    ]);
  });

  it('마감 라운드만 마감 시각 문구를 받고 진행 중은 null이다', () => {
    const rounds = [
      round({
        id: 'r1',
        status: 'closed',
        updated_at: '2026-08-29T05:32:00Z',
        created_at: '2026-08-29T01:00:00Z',
      }),
      round({ id: 'r2', status: 'active', updated_at: '2026-08-29T06:00:00Z', created_at: '2026-08-29T02:00:00Z' }),
    ];
    const jobs = resultExportJobs([teamA], rounds, { r1: [], r2: [] }, clock);

    expect(jobs[0].image.closedAtLabel).toBe('14:32');
    // 진행 중 라운드에 마감 시각을 붙이면 아카이브가 거짓말을 한다.
    expect(jobs[1].image.closedAtLabel).toBeNull();
  });

  it('표를 못 받은 라운드는 건너뛰고, 정말 0표인 라운드는 담는다', () => {
    // 두 경우를 한 fixture에서 함께 단언한다 — 따로 쓰면 둘 다 통과하면서
    // 실제로는 '조회 안 됨'이 '0표'라 적힌 가짜 기록물로 나갈 수 있다.
    const rounds = [
      round({ id: 'r1', title: '0표 라운드', created_at: '2026-08-29T01:00:00Z' }),
      round({ id: 'r2', title: '미조회 라운드', created_at: '2026-08-29T02:00:00Z' }),
    ];
    const jobs = resultExportJobs([teamA], rounds, { r1: [] }, clock);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].image.title).toBe('0표 라운드');
    expect(jobs[0].image.total).toBe(0);
  });

  it('CHECKBOX의 선택지 득표 합이 총 표수를 넘어도 그대로 넘긴다', () => {
    // tallyVotes의 total은 '투표한 사람 수'다. 여기서 깎으면 그림의 숫자가 사실과 달라진다.
    const rounds = [round({ id: 'r1', type: 'CHECKBOX', options: ['A', 'B'], status: 'closed' })];
    const votes = { r1: [vote(1, 'r1', ['A', 'B']), vote(2, 'r1', ['A'])] };
    const [job] = resultExportJobs([teamA], rounds, votes, clock);

    expect(job.image.total).toBe(2);
    expect(job.image.results).toEqual([
      { option: 'A', count: 2 },
      { option: 'B', count: 1 },
    ]);
  });

  it('조가 없거나 라운드가 없으면 빈 목록이다', () => {
    expect(resultExportJobs([], [round({ id: 'r1' })], { r1: [] }, clock)).toEqual([]);
    expect(resultExportJobs([teamA], [], {}, clock)).toEqual([]);
  });

  it('입력 배열 순서가 달라도 같은 회차 번호가 나온다', () => {
    const rounds = [
      round({ id: 'rb', title: '두 번째', created_at: '2026-08-29T02:00:00Z' }),
      round({ id: 'ra', title: '첫 번째', created_at: '2026-08-29T01:00:00Z' }),
    ];
    const votes = { ra: [], rb: [] };
    const forward = resultExportJobs([teamA], rounds, votes, clock).map((job) => job.path);
    const reversed = resultExportJobs([teamA], [...rounds].reverse(), votes, clock).map((job) => job.path);

    expect(forward).toEqual(['1분과_1조/1차_첫_번째.png', '1분과_1조/2차_두_번째.png']);
    expect(reversed).toEqual(forward);
  });
});
