import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  issueItems,
  issueReclassify,
  issueList,
  issueMerge,
  issueReview,
  issueUpsert,
  platformBallotList,
  platformBallotResults,
  readinessCheck,
  resultImplementationUpsert,
  resultPublish,
  resultUnpublish,
} from './platform';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

describe('authenticated platform ballot adapters', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('uses the selected-organization-scoped readiness RPC', async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: { ok: true, checks: [] }, error: null }));
    vi.mocked(getSupabase).mockReturnValue({
      schema: vi.fn(() => ({ rpc })),
    } as never);

    await expect(readinessCheck('session-1')).resolves.toMatchObject({ notice: null });
    expect(rpc).toHaveBeenCalledWith('platform_readiness_check_v2', {
      p_session_id: 'session-1',
    });
  });

  it('uses staff RPCs with a server-validated session id and no join code', async () => {
    const results = [
      { data: [{ id: 'ballot-1', token: 'public-token' }], error: null },
      { data: { id: 'ballot-1', items: [] }, error: null },
    ];
    const rpc = vi.fn(() => Promise.resolve(results.shift() ?? { data: null, error: null }));
    const schema = vi.fn(() => ({ rpc }));
    vi.mocked(getSupabase).mockReturnValue({ schema } as never);

    await expect(platformBallotList('session-1')).resolves.toMatchObject({ notice: null });
    await expect(platformBallotResults('public-token', 'session-1')).resolves.toMatchObject({ notice: null });

    expect(rpc).toHaveBeenNthCalledWith(1, 'platform_ballot_list_v2', {
      p_session_id: 'session-1',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'platform_ballot_results_v2', {
      p_ballot_token: 'public-token',
      p_session_id: 'session-1',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('p_code');
  });

  it('uses only staff issue and publication RPCs anchored to the selected session', async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    const schema = vi.fn(() => ({ rpc }));
    vi.mocked(getSupabase).mockReturnValue({ schema } as never);

    await issueList('session-1', 'topic-1');
    await issueItems('session-1', 'topic-1');
    await issueUpsert(
      'session-1',
      'topic-1',
      { id: 'issue-create-1', label: '쟁점' },
      null,
      'upsert-request',
    );
    await issueReclassify('session-1', 'topic-1', [{
      issueId: 'issue-1',
      itemIds: ['item-1'],
      clusterId: null,
      expectedLinks: [{ itemId: 'item-2', clusterId: 'cluster-1', linkedBy: 'ai' }],
      role: 'target',
    }], 'request-1');
    await issueMerge('session-1', 'issue-1', 'issue-2', 'src-snapshot', 'dst-snapshot', 'merge-request');
    await issueReview('session-1', 'issue-2', 'review-snapshot', 'review-request');
    await resultPublish('session-1', 'topic', 'topic-1', '공개 결과');
    await resultUnpublish('session-1', 'result-1');
    await resultImplementationUpsert('session-1', 'result-token', 'issue-2', {
      status: 'planned',
      responsible_body: '기후정책과',
      updated_at: '2026-09-05T00:00:00.000Z',
      summary: '이행 계획',
      evidence_url: null,
    }, null, 'implementation-request');

    expect(rpc.mock.calls).toEqual([
      ['platform_issue_list_v2', { p_session_id: 'session-1', p_topic_id: 'topic-1' }],
      ['platform_issue_items_v2', { p_session_id: 'session-1', p_topic_id: 'topic-1' }],
      ['platform_issue_upsert_v3', {
        p_session_id: 'session-1',
        p_topic_id: 'topic-1',
        p_issue: { id: 'issue-create-1', label: '쟁점' },
        p_expected_snapshot_hash: null,
        p_idempotency_key: 'upsert-request',
      }],
      ['platform_issue_reclassify_v2', {
        p_session_id: 'session-1',
        p_topic_id: 'topic-1',
        p_plan: {
          calls: [{
            issue_id: 'issue-1',
            item_ids: ['item-1'],
            cluster_id: null,
            expected_links: [{ item_id: 'item-2', cluster_id: 'cluster-1', linked_by: 'ai' }],
            role: 'target',
          }],
        },
        p_idempotency_key: 'request-1',
      }],
      ['platform_issue_merge_v3', {
        p_session_id: 'session-1',
        p_src_issue_id: 'issue-1',
        p_dst_issue_id: 'issue-2',
        p_expected_src_snapshot_hash: 'src-snapshot',
        p_expected_dst_snapshot_hash: 'dst-snapshot',
        p_idempotency_key: 'merge-request',
      }],
      ['platform_issue_review_v3', {
        p_session_id: 'session-1',
        p_issue_id: 'issue-2',
        p_expected_snapshot_hash: 'review-snapshot',
        p_idempotency_key: 'review-request',
      }],
      ['platform_result_publish_v2', { p_session_id: 'session-1', p_scope: 'topic', p_scope_id: 'topic-1', p_title: '공개 결과' }],
      ['platform_result_unpublish_v2', { p_session_id: 'session-1', p_result_id: 'result-1' }],
      ['platform_result_implementation_upsert_v3', {
        p_session_id: 'session-1',
        p_result_token: 'result-token',
        p_issue_id: 'issue-2',
        p_implementation: {
          status: 'planned',
          responsible_body: '기후정책과',
          updated_at: '2026-09-05T00:00:00.000Z',
          summary: '이행 계획',
          evidence_url: null,
        },
        p_expected_snapshot_hash: null,
        p_idempotency_key: 'implementation-request',
      }],
    ]);
    const serializedCalls = JSON.stringify(rpc.mock.calls);
    expect(serializedCalls).not.toContain('p_code');
    expect(serializedCalls).not.toContain('"p_token"');
  });
});
