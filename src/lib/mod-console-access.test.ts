import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import { createPoll, logTimer, proxyVote, setPollStatus } from './mod-console';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

const access = { accessToken: 'a'.repeat(64) };

function mockRpc(data: unknown = null) {
  const rpc = vi.fn(() => Promise.resolve({ data, error: null }));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

describe('moderator token RPC adapters', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('creates and changes rounds with the opaque token', async () => {
    const rpc = mockRpc({ id: 'r1', status: 'active' });
    const idempotencyKey = '58e22719-df92-45b9-873a-930ab05a3600';
    const statusIdempotencyKey = 'b05e865d-43b8-4a9b-99ba-f17561c6868d';
    await createPoll(access, { title: '질문', type: 'RADIO', options: ['A', 'B'] }, idempotencyKey);
    await setPollStatus(access, 'r1', 'closed', 'active', statusIdempotencyKey);
    expect(rpc).toHaveBeenNthCalledWith(1, 'mod_create_round_v3', {
      p_token: access.accessToken,
      p_title: '질문',
      p_type: 'RADIO',
      p_options: ['A', 'B'],
      p_idempotency_key: idempotencyKey,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'mod_set_round_status_v3', {
      p_token: access.accessToken,
      p_round_id: 'r1',
      p_expected_status: 'closed',
      p_status: 'active',
      p_idempotency_key: statusIdempotencyKey,
    });
  });

  it('uses the token for proxy votes and timer audit', async () => {
    const rpc = mockRpc(2);
    const idempotencyKey = '98dc9d6b-0ec4-4c93-b179-149c54ef283b';
    await proxyVote(access, 'r1', 'A', 2, idempotencyKey);
    await logTimer(access, {
      kind: 'session',
      duration_s: 60,
      started_at: '2026-09-12T04:00:00Z',
      ended_at: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, 'mod_proxy_vote_v3', {
      p_token: access.accessToken,
      p_round_id: 'r1',
      p_choice: 'A',
      p_n: 2,
      p_idempotency_key: idempotencyKey,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'mod_log_timer_v2', {
      p_token: access.accessToken,
      p_kind: 'session',
      p_duration_s: 60,
      p_started_at: '2026-09-12T04:00:00Z',
      p_ended_at: null,
    });
  });

  it('forwards a CHECKBOX proxy selection as one JSON array choice', async () => {
    const rpc = mockRpc(3);
    const idempotencyKey = 'c682d4ed-734f-44ab-985f-132fe94f8874';
    const choices = ['A', 'C'];

    await proxyVote(access, 'r-checkbox', choices, 3, idempotencyKey);

    expect(rpc).toHaveBeenCalledWith('mod_proxy_vote_v3', {
      p_token: access.accessToken,
      p_round_id: 'r-checkbox',
      p_choice: choices,
      p_n: 3,
      p_idempotency_key: idempotencyKey,
    });
  });
});
