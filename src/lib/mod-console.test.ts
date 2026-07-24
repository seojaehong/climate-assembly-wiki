import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidJoinCode,
  tallyVotes,
  fetchActiveRound,
  fetchRound,
  fetchHqTeams,
  fetchTeamRounds,
  fetchVoteCounts,
  fetchVotesForRounds,
  joinTeam,
  type Round,
  type Vote,
} from './mod-console';
import { getSupabase } from './supabase';

vi.mock('./supabase', () => ({
  getSupabase: vi.fn(),
}));

describe('isValidJoinCode', () => {
  it('6자리 숫자만 허용', () => {
    expect(isValidJoinCode('123456')).toBe(true);
    expect(isValidJoinCode('12345')).toBe(false);
    expect(isValidJoinCode('12345a')).toBe(false);
    expect(isValidJoinCode(' 123456')).toBe(false);
  });
});
describe('tallyVotes', () => {
  const round: Round = { id: 'r', title: 't', type: 'RADIO', options: ['A', 'B'], status: 'active', team_id: null };
  it('RADIO 집계 + archived 제외', () => {
    const votes: Vote[] = [
      { id: 1, round_id: 'r', choice: 'A', archived_at: null },
      { id: 2, round_id: 'r', choice: 'A', archived_at: null },
      { id: 3, round_id: 'r', choice: 'B', archived_at: '2026-07-24' },
    ];
    expect(tallyVotes(round, votes)).toEqual({ total: 2, byOption: { A: 2, B: 0 } });
  });
  it('CHECKBOX는 배열 각 항목 1카운트', () => {
    const r: Round = { ...round, type: 'CHECKBOX' };
    const votes: Vote[] = [{ id: 1, round_id: 'r', choice: ['A', 'B'], archived_at: null }];
    expect(tallyVotes(r, votes)).toEqual({ total: 1, byOption: { A: 1, B: 1 } });
  });
});

describe('joinTeam', () => {
  function mockRpc(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(() => Promise.resolve(result));
    const schema = vi.fn(() => ({ rpc }));
    (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ schema });
    return { rpc, schema };
  }

  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
  });

  it('일치하는 팀이 없으면(빈 배열) null 반환 — 잘못된 코드', async () => {
    mockRpc({ data: [], error: null });

    const result = await joinTeam('000000');

    expect(result).toBeNull();
  });

  it('RPC 자체가 실패하면(네트워크/서버 오류) error를 throw', async () => {
    const err = new Error('network down');
    mockRpc({ data: null, error: err });

    await expect(joinTeam('123456')).rejects.toBe(err);
  });

  it('일치하는 팀이 있으면 해당 팀 반환', async () => {
    const team = { id: 't1', name: '1조', subgroup: null, join_code: '123456', capacity: 14 };
    mockRpc({ data: [team], error: null });

    const result = await joinTeam('123456');

    expect(result).toEqual(team);
  });
});

describe('fetchActiveRound', () => {
  const teamId = 'team-123';
  const eqCalls: unknown[][] = [];

  function mockChain(result: { data: unknown; error: unknown }) {
    const eq = vi.fn((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    const chain: any = {
      eq,
      order: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(result)),
    };
    const from = vi.fn(() => ({ select: vi.fn(() => chain) }));
    const schema = vi.fn(() => ({ from }));
    (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ schema });
  }

  beforeEach(() => {
    eqCalls.length = 0;
    vi.mocked(getSupabase).mockReset();
  });

  it('rows 반환 시 첫 번째 row 반환 + 필터 체인 검증', async () => {
    const row = { id: 'r1', title: 't', type: 'RADIO', options: ['A', 'B'], status: 'active', team_id: teamId };
    mockChain({ data: [row], error: null });

    const result = await fetchActiveRound(teamId);

    expect(result).toEqual(row);
    expect(eqCalls).toContainEqual(['team_id', teamId]);
    expect(eqCalls).toContainEqual(['status', 'active']);
  });

  it('빈 data → null 반환', async () => {
    mockChain({ data: [], error: null });

    const result = await fetchActiveRound(teamId);

    expect(result).toBeNull();
  });

  it('error 존재 시 해당 error를 throw', async () => {
    const err = new Error('boom');
    mockChain({ data: null, error: err });

    await expect(fetchActiveRound(teamId)).rejects.toBe(err);
  });
});

describe('fetchRound', () => {
  const roundId = 'round-abc';

  function mockSingle(result: { data: unknown; error: unknown }) {
    const eq = vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve(result)) }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const schema = vi.fn(() => ({ from }));
    (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ schema });
    return { eq, select, from };
  }

  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
  });

  it('row 존재 시 해당 round 반환', async () => {
    const row = { id: roundId, title: 't', type: 'RADIO', options: ['A', 'B'], status: 'active', team_id: 't1' };
    const { eq } = mockSingle({ data: row, error: null });

    const result = await fetchRound(roundId);

    expect(result).toEqual(row);
    expect(eq).toHaveBeenCalledWith('id', roundId);
  });

  it('없으면 null 반환', async () => {
    mockSingle({ data: null, error: null });

    const result = await fetchRound(roundId);

    expect(result).toBeNull();
  });

  it('error 존재 시 해당 error를 throw', async () => {
    const err = new Error('boom');
    mockSingle({ data: null, error: err });

    await expect(fetchRound(roundId)).rejects.toBe(err);
  });
});

describe('fetchHqTeams', () => {
  function mockRpc(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(() => Promise.resolve(result));
    const schema = vi.fn(() => ({ rpc }));
    (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ schema });
    return { rpc, schema };
  }

  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
  });

  it('hq_teams RPC 호출 + status active만 반환(join_code 없음)', async () => {
    const rows = [
      { id: 't1', name: '1조', subgroup: '교육', capacity: 14, status: 'active' },
      { id: 't2', name: '2조', subgroup: null, capacity: 10, status: 'disabled' },
    ];
    const { rpc, schema } = mockRpc({ data: rows, error: null });

    const result = await fetchHqTeams();

    expect(result).toEqual([rows[0]]);
    expect(schema).toHaveBeenCalledWith('climate_vote');
    expect(rpc).toHaveBeenCalledWith('hq_teams');
  });

  it('data 없으면 빈 배열', async () => {
    mockRpc({ data: null, error: null });

    const result = await fetchHqTeams();

    expect(result).toEqual([]);
  });

  it('error 존재 시 throw', async () => {
    const err = new Error('boom');
    mockRpc({ data: null, error: err });

    await expect(fetchHqTeams()).rejects.toBe(err);
  });
});

describe('fetchTeamRounds', () => {
  function mockChain(result: { data: unknown; error: unknown }) {
    const order = vi.fn(() => Promise.resolve(result));
    const not = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ not }));
    const from = vi.fn(() => ({ select }));
    const schema = vi.fn(() => ({ from }));
    (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ schema });
    return { not, order, select, from };
  }

  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
  });

  it('team_id not null 필터 + created_at desc 정렬로 조회', async () => {
    const rows = [{ id: 'r1', title: 't', type: 'RADIO', options: ['A'], status: 'active', team_id: 't1' }];
    const { not } = mockChain({ data: rows, error: null });

    const result = await fetchTeamRounds();

    expect(result).toEqual(rows);
    expect(not).toHaveBeenCalledWith('team_id', 'is', null);
  });

  it('data 없으면 빈 배열', async () => {
    mockChain({ data: null, error: null });

    const result = await fetchTeamRounds();

    expect(result).toEqual([]);
  });

  it('error 존재 시 throw', async () => {
    const err = new Error('boom');
    mockChain({ data: null, error: err });

    await expect(fetchTeamRounds()).rejects.toBe(err);
  });
});

describe('fetchVoteCounts', () => {
  function mockCountChain(resultByRoundId: Record<string, { count: number | null; error: unknown }>) {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, roundId: string) => ({
          is: vi.fn(() => Promise.resolve(resultByRoundId[roundId])),
        })),
      })),
    }));
    const schema = vi.fn(() => ({ from }));
    (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ schema });
  }

  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
  });

  it('라운드별 count를 맵으로 반환', async () => {
    mockCountChain({
      r1: { count: 5, error: null },
      r2: { count: 0, error: null },
    });

    const result = await fetchVoteCounts(['r1', 'r2']);

    expect(result).toEqual({ r1: 5, r2: 0 });
  });

  it('count가 null이면 0으로 처리', async () => {
    mockCountChain({ r1: { count: null, error: null } });

    const result = await fetchVoteCounts(['r1']);

    expect(result).toEqual({ r1: 0 });
  });

  it('error 존재 시 throw', async () => {
    const err = new Error('boom');
    mockCountChain({ r1: { count: null, error: err } });

    await expect(fetchVoteCounts(['r1'])).rejects.toBe(err);
  });
});

describe('fetchVotesForRounds', () => {
  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
  });

  it('미보관 표를 한 번에 조회해 라운드별로 묶고 빈 라운드도 보존한다', async () => {
    const result = {
      data: [
        { id: 1, round_id: 'r1', choice: 'A', archived_at: null },
        { id: 2, round_id: 'r1', choice: 'B', archived_at: null },
      ],
      error: null,
    };
    const is = vi.fn(() => Promise.resolve(result));
    const inFilter = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ in: inFilter }));
    const from = vi.fn(() => ({ select }));
    const schema = vi.fn(() => ({ from }));
    vi.mocked(getSupabase).mockReturnValue({ schema } as never);

    await expect(fetchVotesForRounds(['r1', 'r2'])).resolves.toEqual({
      r1: result.data,
      r2: [],
    });
    expect(inFilter).toHaveBeenCalledWith('round_id', ['r1', 'r2']);
    expect(is).toHaveBeenCalledWith('archived_at', null);
  });

  it('라운드가 없으면 Supabase를 호출하지 않는다', async () => {
    await expect(fetchVotesForRounds([])).resolves.toEqual({});
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('조회 오류를 throw한다', async () => {
    const err = new Error('boom');
    const is = vi.fn(() => Promise.resolve({ data: null, error: err }));
    const inFilter = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ in: inFilter }));
    const from = vi.fn(() => ({ select }));
    const schema = vi.fn(() => ({ from }));
    vi.mocked(getSupabase).mockReturnValue({ schema } as never);

    await expect(fetchVotesForRounds(['r1'])).rejects.toBe(err);
  });
});
