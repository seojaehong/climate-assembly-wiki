import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  assignSubmissionCategory,
  assignSubmissionKind,
  clearAllSubmissions,
  fetchHqSubmissionCategories,
  fetchHqSubmissionHistory,
  fetchHqSubmissions,
  fetchHqTopicDeadlines,
  fetchSubmissionKinds,
  reopenSubmission,
} from './hq-submissions';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

function mockRpc() {
  const rpc = vi.fn(
    (_name: string, _input?: Record<string, unknown>): Promise<{ data: unknown; error: null }> =>
      Promise.resolve({ data: [], error: null }),
  );
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

describe('session-scoped HQ submission RPC adapters', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('uses session-scoped readers and v3 assignment snapshots', async () => {
    const rpc = mockRpc();
    await fetchHqSubmissions('token', '0912-deliberation');
    await fetchHqSubmissionHistory('token', '0912-deliberation');
    await fetchHqSubmissionCategories('token', '0912-deliberation');
    await fetchSubmissionKinds('token', '0912-deliberation');
    await fetchHqTopicDeadlines('token', '0912-deliberation');

    for (const [index, name] of [
      'hq_submissions_v3',
      'hq_submission_history_v2',
      'hq_submission_categories_v3',
      'hq_submission_kinds_v3',
      'hq_topic_deadlines_v2',
    ].entries()) {
      expect(rpc).toHaveBeenNthCalledWith(index + 1, name, {
        p_token: 'token',
        p_session_slug: '0912-deliberation',
      });
    }
  });

  it('uses v3 compare-and-set assignment mutations with stable request identities', async () => {
    const rpc = mockRpc();
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: {
          status: 'applied',
          submission_id: 'submission',
          item_ordinal: 1,
          source_item_id: 'item-1',
          submission_updated_at: '2026-09-12T07:00:00Z',
          event_id: 7,
          category: 'common',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: 'applied',
          submission_id: 'submission',
          item_ordinal: 1,
          source_item_id: 'item-1',
          submission_updated_at: '2026-09-12T07:00:00Z',
          event_id: 9,
          kind: 'Claim',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'applied', cleared_items: 2, cleared_submissions: 1 },
        error: null,
      });
    await reopenSubmission('token', '0912-deliberation', 'submission', '입력 오류');
    await assignSubmissionCategory('token', '0912-deliberation', {
      submissionId: 'submission',
      itemOrdinal: 1,
      category: 'common',
      expectedSubmissionUpdatedAt: '2026-09-12T07:00:00Z',
      expectedEventId: 6,
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
    });
    await assignSubmissionKind('token', '0912-deliberation', {
      submissionId: 'submission',
      itemOrdinal: 1,
      kind: 'Claim',
      expectedSubmissionUpdatedAt: '2026-09-12T07:00:00Z',
      expectedEventId: null,
      idempotencyKey: '10000000-0000-4000-8000-000000000002',
    });
    await clearAllSubmissions('token', '0912-deliberation', {
      confirmPhrase: '전체 비우기',
      expectedSubmissions: [{ id: 'submission', version: 4 }],
      idempotencyKey: '10000000-0000-4000-8000-000000000004',
    });

    expect(rpc).toHaveBeenNthCalledWith(1, 'submission_reopen_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_submission_id: 'submission',
      p_reason: '입력 오류',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'hq_submission_category_assign_v3', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_submission_id: 'submission',
      p_item_ordinal: 1,
      p_category: 'common',
      p_expected_submission_updated_at: '2026-09-12T07:00:00Z',
      p_expected_event_id: 6,
      p_idempotency_key: '10000000-0000-4000-8000-000000000001',
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'hq_submission_kind_assign_v3', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_submission_id: 'submission',
      p_item_ordinal: 1,
      p_kind: 'Claim',
      p_expected_submission_updated_at: '2026-09-12T07:00:00Z',
      p_expected_event_id: null,
      p_idempotency_key: '10000000-0000-4000-8000-000000000002',
    });
    expect(rpc).toHaveBeenNthCalledWith(4, 'hq_clear_submissions_v3', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_confirm: '전체 비우기',
      p_expected_submissions: [{ id: 'submission', version: 4 }],
      p_idempotency_key: '10000000-0000-4000-8000-000000000004',
    });
  });

  it('returns a conflict result instead of treating stale state as success', async () => {
    const rpc = mockRpc();
    rpc.mockResolvedValueOnce({
      data: {
        status: 'conflict',
        submission_id: 'submission',
        current_submission_updated_at: '2026-09-12T07:01:00Z',
        current_event_id: 12,
      },
      error: null,
    });

    const result = await assignSubmissionCategory('token', '0912-deliberation', {
      submissionId: 'submission',
      itemOrdinal: 1,
      category: 'difference',
      expectedSubmissionUpdatedAt: '2026-09-12T07:00:00Z',
      expectedEventId: 11,
      idempotencyKey: '10000000-0000-4000-8000-000000000003',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'conflict', current_event_id: 12 }));
  });

  it('keeps a stale clear-all response explicit and non-successful', async () => {
    const rpc = mockRpc();
    rpc.mockResolvedValueOnce({
      data: {
        status: 'conflict',
        current_submissions: [{ id: 'submission', version: 5 }],
        expected_submissions: [{ id: 'submission', version: 4 }],
      },
      error: null,
    });

    const result = await clearAllSubmissions('token', '0912-deliberation', {
      confirmPhrase: '전체 비우기',
      expectedSubmissions: [{ id: 'submission', version: 4 }],
      idempotencyKey: '10000000-0000-4000-8000-000000000005',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'conflict' }));
  });
});
