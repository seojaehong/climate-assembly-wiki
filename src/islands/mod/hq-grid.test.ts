import { describe, it, expect } from 'vitest';
import { teamCell, relevantRoundIds, summarizeTeamCells, teamMatchesFilters } from './hq-grid-logic';
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
