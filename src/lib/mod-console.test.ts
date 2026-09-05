import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidJoinCode,
  tallyVotes,
  fetchActiveRound,
  fetchRound,
  fetchHqTeams,
  fetchHqRounds,
  fetchHqVoteCounts,
  fetchHqVotesForRounds,
  fetchSessionTeams,
  fetchTeamRounds,
  fetchTeamVoteCounts,
  fetchTeamVotes,
  fetchPublicTally,
  castBallot,
  createPoll,
  getDeviceToken,
  setPollStatus,
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

describe('public vote device identity migration', () => {
  it('legacy nested-route id를 canonical cv_device 키로 원자적으로 이관한다', () => {
    const values = new Map<string, string>([['climate_vote_client_id', 'legacy-device-id']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    try {
      expect(getDeviceToken()).toBe('legacy-device-id');
      expect(values.get('cv_device')).toBe('legacy-device-id');
      expect(values.has('climate_vote_client_id')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(tallyVotes(round, votes)).toEqual({ total: 2, byOption: { A: 2, B: 0 }, averageByOption: {} });
  });
  it('CHECKBOX는 배열 각 항목 1카운트', () => {
    const r: Round = { ...round, type: 'CHECKBOX' };
    const votes: Vote[] = [{ id: 1, round_id: 'r', choice: ['A', 'B'], archived_at: null }];
    expect(tallyVotes(r, votes)).toEqual({ total: 1, byOption: { A: 1, B: 1 }, averageByOption: {} });
  });
});

const access = { accessToken: 'a'.repeat(64) };
const hqToken = 'b'.repeat(64);
const sessionSlug = '0912-deliberation';

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return { rpc, schema };
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
});

describe('scoped round reads', () => {
  const active = { id: 'r1', title: 't', type: 'RADIO', options: ['A'], status: 'active', team_id: 't1' };

  it('team token으로 라운드와 active 라운드를 읽는다', async () => {
    const { rpc } = mockRpc({ data: [active], error: null });
    await expect(fetchTeamRounds(access)).resolves.toEqual([active]);
    await expect(fetchActiveRound(access)).resolves.toEqual(active);
    expect(rpc).toHaveBeenCalledWith('mod_rounds_v2', { p_token: access.accessToken });
  });

  it('공개 링크는 round id capability RPC만 호출한다', async () => {
    const { rpc } = mockRpc({ data: [active], error: null });
    await expect(fetchRound('r1')).resolves.toEqual({ ...active, team_id: null });
    expect(rpc).toHaveBeenCalledWith('public_round_get_v2', { p_round_id: 'r1' });
  });

  it('HQ 라운드는 token과 session slug를 모두 보낸다', async () => {
    const { rpc } = mockRpc({ data: [active], error: null });
    await expect(fetchHqRounds(hqToken, sessionSlug)).resolves.toEqual([active]);
    expect(rpc).toHaveBeenCalledWith('hq_rounds_v2', {
      p_token: hqToken,
      p_session_slug: sessionSlug,
    });
  });
});

describe('scoped team lists', () => {
  const rows = ['2분과 5조', '1분과 1조'].map((name, index) => ({
    id: `t${index}`,
    name,
    subgroup: name.slice(0, 3),
    capacity: 12,
    status: 'active',
    table_no: null,
  }));

  it('HQ team read를 token/session에 묶고 표준 순서로 정렬한다', async () => {
    const { rpc } = mockRpc({ data: rows, error: null });
    const result = await fetchHqTeams(hqToken, sessionSlug);
    expect(result.map((team) => team.name)).toEqual(['1분과 1조', '2분과 5조']);
    expect(rpc).toHaveBeenCalledWith('hq_teams_v2', {
      p_token: hqToken,
      p_session_slug: sessionSlug,
    });
  });

  it('조 분과 목록은 team token 세션에 묶는다', async () => {
    const { rpc } = mockRpc({ data: rows, error: null });
    await expect(fetchSessionTeams(access)).resolves.toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith('mod_session_teams_v2', { p_token: access.accessToken });
  });
});

describe('scoped vote reads and public cast', () => {
  const votes = [{ id: 1, round_id: 'r1', choice: 'A', archived_at: null }];

  it('team token count와 vote RPC를 사용한다', async () => {
    const first = mockRpc({ data: [{ round_id: 'r1', vote_count: 1 }], error: null });
    await expect(fetchTeamVoteCounts(access, ['r1'])).resolves.toEqual({ r1: 1 });
    expect(first.rpc).toHaveBeenCalledWith('mod_vote_counts_v2', {
      p_token: access.accessToken,
      p_round_ids: ['r1'],
    });
    const second = mockRpc({ data: votes, error: null });
    await expect(fetchTeamVotes(access, 'r1')).resolves.toEqual(votes);
    expect(second.rpc).toHaveBeenCalledWith('mod_votes_v2', {
      p_token: access.accessToken,
      p_round_id: 'r1',
    });
  });

  it('HQ count와 vote RPC에 token/session을 함께 보낸다', async () => {
    const first = mockRpc({ data: [{ round_id: 'r1', vote_count: 1 }], error: null });
    await expect(fetchHqVoteCounts(hqToken, sessionSlug, ['r1'])).resolves.toEqual({ r1: 1 });
    expect(first.rpc).toHaveBeenCalledWith('hq_vote_counts_v2', {
      p_token: hqToken,
      p_session_slug: sessionSlug,
      p_round_ids: ['r1'],
    });
    const second = mockRpc({ data: votes, error: null });
    await expect(fetchHqVotesForRounds(hqToken, sessionSlug, ['r1', 'r2'])).resolves.toEqual({
      r1: votes,
      r2: [],
    });
    expect(second.rpc).toHaveBeenCalledWith('hq_votes_v2', {
      p_token: hqToken,
      p_session_slug: sessionSlug,
      p_round_ids: ['r1', 'r2'],
    });
  });

  it('공개 결과와 cast는 round-id capability RPC만 사용한다', async () => {
    const first = mockRpc({ data: [{ choice: 'A', vote_count: 2, total_votes: 3, average_score: null }], error: null });
    await expect(fetchPublicTally('r1')).resolves.toEqual({
      total: 3,
      byOption: { A: 2 },
      averageByOption: {},
    });
    expect(first.rpc).toHaveBeenCalledWith('public_round_votes_v2', { p_round_id: 'r1' });

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'device-1'),
      setItem: vi.fn(),
    });
    const second = mockRpc({ data: 'duplicate', error: null });
    await expect(castBallot('r1', 'A')).resolves.toBe('duplicate');
    expect(second.rpc).toHaveBeenCalledWith('public_round_cast_v2', {
      p_round_id: 'r1',
      p_choice: 'A',
      p_client_id: 'device-1',
    });
    vi.unstubAllGlobals();
  });

  it('SCALE_MULTI 공개 집계의 서버 평균을 보존한다', async () => {
    mockRpc({
      data: [{ choice: 'Agenda A', vote_count: 3, total_votes: 3, average_score: '4.33' }],
      error: null,
    });
    await expect(fetchPublicTally('canvas-round')).resolves.toEqual({
      total: 3,
      byOption: { 'Agenda A': 3 },
      averageByOption: { 'Agenda A': 4.33 },
    });
  });

  it('잘못된 public cast 응답과 RPC 오류를 숨기지 않는다', async () => {
    mockRpc({ data: 'unexpected', error: null });
    await expect(castBallot('r1', 'A')).rejects.toThrow('public vote response is invalid');
    const error = new Error('scope denied');
    mockRpc({ data: null, error });
    await expect(fetchHqRounds(hqToken, sessionSlug)).rejects.toBe(error);
  });
});

describe('moderator round mutations', () => {
  const activeRound: Round = {
    id: 'round-1',
    title: '현장 투표',
    type: 'RADIO',
    options: ['A', 'B'],
    status: 'active',
    team_id: 'team-1',
    updated_at: '2026-09-12T04:30:00.000Z',
  };

  it('creates an already-active v3 round with the caller intent key', async () => {
    const { rpc } = mockRpc({ data: activeRound, error: null });

    await expect(createPoll(access, {
      title: activeRound.title,
      type: activeRound.type,
      options: activeRound.options ?? [],
    }, '11111111-1111-4111-8111-111111111111')).resolves.toEqual(activeRound);

    expect(rpc).toHaveBeenCalledWith('mod_create_round_v3', {
      p_token: access.accessToken,
      p_title: activeRound.title,
      p_type: activeRound.type,
      p_options: ['A', 'B'],
      p_idempotency_key: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('sends expected status, target status, and stable intent key to the CAS v3 RPC', async () => {
    const closedRound: Round = { ...activeRound, status: 'closed' };
    const { rpc } = mockRpc({ data: closedRound, error: null });

    await expect(setPollStatus(
      access,
      activeRound.id,
      'active',
      'closed',
      '22222222-2222-4222-8222-222222222222',
    )).resolves.toEqual(closedRound);

    expect(rpc).toHaveBeenCalledWith('mod_set_round_status_v3', {
      p_token: access.accessToken,
      p_round_id: activeRound.id,
      p_expected_status: 'active',
      p_status: 'closed',
      p_idempotency_key: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('propagates a stale transition error so the UI can perform a scoped reload', async () => {
    const conflict = new Error('round status conflict: expected active, current closed');
    mockRpc({ data: null, error: conflict });

    await expect(setPollStatus(
      access,
      activeRound.id,
      'active',
      'closed',
      '33333333-3333-4333-8333-333333333333',
    )).rejects.toBe(conflict);
  });

  it('rejects a response for a different transition instead of moving the UI to a false state', async () => {
    mockRpc({ data: activeRound, error: null });

    await expect(setPollStatus(
      access,
      activeRound.id,
      'active',
      'closed',
      '44444444-4444-4444-8444-444444444444',
    )).rejects.toThrow('does not match the requested transition');
  });
});
