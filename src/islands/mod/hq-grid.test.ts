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
} from './hq-grid-logic';
import type { HqTeam, Round } from '../../lib/mod-console';

const team: HqTeam = { id: 't1', name: '1조', subgroup: '교육', capacity: 14, status: 'active' };

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
      { id: 't2', name: '2조', subgroup: null, capacity: 10, status: 'active' },
      { id: 't3', name: '3조', subgroup: null, capacity: 10, status: 'active' },
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
      { id: 't2', name: '2조', subgroup: '전환', capacity: 10, status: 'active' },
      { id: 't3', name: '3조', subgroup: '전환', capacity: 10, status: 'active' },
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
