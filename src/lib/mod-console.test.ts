import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidJoinCode, tallyVotes, fetchActiveRound, fetchRound } from './mod-console';
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
  const round = { id: 'r', title: 't', type: 'RADIO', options: ['A','B'], status: 'active', team_id: null } as const;
  it('RADIO 집계 + archived 제외', () => {
    const votes = [
      { id: 1, round_id: 'r', choice: 'A', archived_at: null },
      { id: 2, round_id: 'r', choice: 'A', archived_at: null },
      { id: 3, round_id: 'r', choice: 'B', archived_at: '2026-07-24' },
    ];
    expect(tallyVotes(round, votes)).toEqual({ total: 2, byOption: { A: 2, B: 0 } });
  });
  it('CHECKBOX는 배열 각 항목 1카운트', () => {
    const r = { ...round, type: 'CHECKBOX' as const };
    const votes = [{ id: 1, round_id: 'r', choice: ['A','B'], archived_at: null }];
    expect(tallyVotes(r, votes)).toEqual({ total: 1, byOption: { A: 1, B: 1 } });
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
