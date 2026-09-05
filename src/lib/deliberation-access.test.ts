import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  SubmissionVersionConflictError,
  ballotCreate,
  ballotList,
  ballotResults,
  ballotSetStatus,
  submissionFinalize,
  submissionGet,
  submissionReopenByTeam,
  submissionSave,
  topicList,
  type WorkshopAuthorization,
} from './deliberation';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

const authorization: WorkshopAuthorization = { accessToken: 'a'.repeat(64) };

function mockRpc(results: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(() => Promise.resolve(results.shift() ?? { data: null, error: null }));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

describe('token-scoped deliberation RPCs', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('does not accept a reusable join-code string at the adapter boundary', () => {
    expectTypeOf<Parameters<typeof topicList>[0]>().toEqualTypeOf<WorkshopAuthorization>();
    expectTypeOf<string>().not.toExtend<Parameters<typeof topicList>[0]>();
  });

  it('uses the opaque token for topics, submissions, and ballots', async () => {
    const rpc = mockRpc([
      { data: [], error: null },
      { data: { status: null, version: 0, items: [] }, error: null },
      { data: [], error: null },
    ]);
    await topicList(authorization);
    await submissionGet(authorization, 'topic-1');
    await ballotList(authorization);
    expect(rpc).toHaveBeenNthCalledWith(1, 'topic_list_v2', { p_token: authorization.accessToken });
    expect(rpc).toHaveBeenNthCalledWith(2, 'submission_get_v2', {
      p_token: authorization.accessToken,
      p_topic_id: 'topic-1',
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'ballot_list_v2', { p_token: authorization.accessToken });
  });

  it('sends expected version and an idempotency key on save', async () => {
    const rpc = mockRpc([{ data: { id: 's1', status: 'draft', saved: 1, version: 4 }, error: null }]);
    await submissionSave(authorization, 'topic-1', [
      { ordinal: 1, kind: 'core', content: '원문', rationale: null },
    ], { expectedVersion: 3, idempotencyKey: '00000000-0000-4000-8000-000000000001' });
    expect(rpc).toHaveBeenCalledWith('submission_save_v3', {
      p_token: authorization.accessToken,
      p_topic_id: 'topic-1',
      p_items: [{ ordinal: 1, kind: 'core', content: '원문', rationale: null }],
      p_expected_version: 3,
      p_idempotency_key: '00000000-0000-4000-8000-000000000001',
      p_force: false,
    });
  });

  it('turns a server conflict into a typed non-network error', async () => {
    mockRpc([{ data: { status: 'conflict', version: 8, updated_at: '2026-09-12T08:00:00Z', items: [] }, error: null }]);
    const result = submissionSave(authorization, 'topic-1', [], {
      expectedVersion: 7,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    });
    await expect(result).rejects.toBeInstanceOf(SubmissionVersionConflictError);
    await expect(result).rejects.toMatchObject({ currentVersion: 8, currentItems: [] });
  });

  it('requires the expected version when finalizing with a token', async () => {
    const rpc = mockRpc([{ data: { id: 's1', status: 'final', version: 5 }, error: null }]);
    await submissionFinalize(authorization, 'topic-1', 4);
    expect(rpc).toHaveBeenCalledWith('submission_finalize_v2', {
      p_token: authorization.accessToken,
      p_topic_id: 'topic-1',
      p_expected_version: 4,
    });
  });

  it('turns a finalize race into the same typed conflict used by save', async () => {
    mockRpc([{
      data: {
        status: 'conflict',
        version: 9,
        updated_at: '2026-09-12T08:01:00Z',
        items: [{ ordinal: 1, kind: 'core', content: '서버본', rationale: null }],
      },
      error: null,
    }]);
    await expect(submissionFinalize(authorization, 'topic-1', 8)).rejects.toMatchObject({
      name: 'SubmissionVersionConflictError',
      currentVersion: 9,
      currentItems: [{ ordinal: 1, kind: 'core', content: '서버본', rationale: null }],
    });
  });

  it('uses token adapters and idempotent v3 creation for moderator ballot operations', async () => {
    const items = [{ ordinal: 1, statement: '의제 A', scale: 5 as const, required: true }];
    const rpc = mockRpc([
      { data: {}, error: null },
      { data: { id: 'b1', token: 'public', status: 'draft', items: 1 }, error: null },
      { data: { id: 'b1', status: 'open' }, error: null },
      { data: { id: 'b1', title: '질문', status: 'open', responses: 0, items: [] }, error: null },
    ]);

    await submissionReopenByTeam(authorization, 'topic-1');
    const ballotRequestId = 'cc2c66ab-f47c-432f-80ee-c17f3734c46b';
    await ballotCreate(authorization, {
      title: '질문',
      instructions: '안내',
      items,
      subgroup: ' 1분과 ',
    }, ballotRequestId);
    await ballotSetStatus(authorization, 'b1', 'open');
    await ballotResults('public', authorization);

    expect(rpc).toHaveBeenNthCalledWith(1, 'submission_reopen_by_team_v2', {
      p_token: authorization.accessToken,
      p_topic_id: 'topic-1',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'ballot_create_v3', {
      p_token: authorization.accessToken,
      p_title: '질문',
      p_instructions: '안내',
      p_items: items,
      p_subgroup: '1분과',
      p_idempotency_key: ballotRequestId,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'ballot_set_status_v2', {
      p_token: authorization.accessToken,
      p_ballot_id: 'b1',
      p_status: 'open',
    });
    expect(rpc).toHaveBeenNthCalledWith(4, 'ballot_results_v2', {
      p_ballot_token: 'public',
      p_token: authorization.accessToken,
    });
  });
});
