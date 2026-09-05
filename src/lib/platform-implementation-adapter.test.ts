import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  ensureResultImplementationUpsertIntent,
  resultImplementationUpsert,
} from './platform';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

describe('resultImplementationUpsert', () => {
  const rpc = vi.fn();
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const resultId = '21111111-1111-4111-8111-111111111111';
  const issueId = '31111111-1111-4111-8111-111111111111';
  const resultToken = '0123456789abcdef0123456789abcdef';
  const idempotencyKey = '41111111-1111-4111-8111-111111111111';
  const snapshotHash = 'a'.repeat(64);
  const implementation = {
    status: 'in_progress' as const,
    responsible_body: '교통정책 담당기관',
    updated_at: '2026-09-03T01:30:00.000Z',
    summary: '세부 이행을 진행하고 있습니다.',
    evidence_url: null,
  };

  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(getSupabase).mockReturnValue({
      schema: vi.fn(() => ({ rpc })),
    } as unknown as NonNullable<ReturnType<typeof getSupabase>>);
  });

  it('passes CAS and a stable idempotency key to the v3 RPC for a first write', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'applied',
        result_id: resultId,
        issue_id: issueId,
        event_id: 7,
        updated_at: '2026-09-03T01:30:01.000Z',
        snapshot_hash: snapshotHash,
      },
      error: null,
    });

    const result = await resultImplementationUpsert(
      sessionId,
      resultToken,
      issueId,
      implementation,
      null,
      idempotencyKey,
    );

    expect(rpc).toHaveBeenCalledWith('platform_result_implementation_upsert_v3', {
      p_session_id: sessionId,
      p_result_token: resultToken,
      p_issue_id: issueId,
      p_implementation: implementation,
      p_expected_snapshot_hash: null,
      p_idempotency_key: idempotencyKey,
    });
    expect(result).toEqual({
      data: {
        status: 'applied',
        result_id: resultId,
        issue_id: issueId,
        event_id: 7,
        updated_at: '2026-09-03T01:30:01.000Z',
        snapshot_hash: snapshotHash,
      },
      notice: null,
    });
  });

  it('returns a typed conflict without silently overwriting the newer snapshot', async () => {
    const currentSnapshotHash = 'b'.repeat(64);
    rpc.mockResolvedValue({
      data: {
        status: 'conflict',
        result_id: resultId,
        issue_id: issueId,
        current_snapshot_hash: currentSnapshotHash,
      },
      error: null,
    });

    const result = await resultImplementationUpsert(
      sessionId,
      resultToken,
      issueId,
      implementation,
      snapshotHash,
      idempotencyKey,
    );

    expect(rpc).toHaveBeenCalledWith('platform_result_implementation_upsert_v3', expect.objectContaining({
      p_expected_snapshot_hash: snapshotHash,
      p_idempotency_key: idempotencyKey,
    }));
    expect(result).toEqual({
      data: {
        status: 'conflict',
        result_id: resultId,
        issue_id: issueId,
        current_snapshot_hash: currentSnapshotHash,
      },
      notice: null,
    });
  });

  it('degrades to an explicit approval notice while the RPC migration is absent', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

    const result = await resultImplementationUpsert(
      sessionId,
      resultToken,
      issueId,
      { ...implementation, status: 'planned', summary: '이행 계획을 수립했습니다.' },
      null,
      idempotencyKey,
    );

    expect(result).toEqual({
      data: null,
      notice: '이행조치 v3 저장 RPC가 아직 승인·적용되지 않았습니다. P1a migration 승인 후 사용할 수 있습니다.',
    });
  });

  it('fails closed on response shapes outside the v3 discriminated union', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'applied',
        result_id: resultId,
        issue_id: issueId,
        updated_at: '2026-09-03T01:30:01.000Z',
      },
      error: null,
    });

    const result = await resultImplementationUpsert(
      sessionId,
      resultToken,
      issueId,
      implementation,
      null,
      idempotencyKey,
    );

    expect(result).toEqual({
      data: null,
      notice: '이행조치 저장 응답 형식을 확인하지 못했습니다.',
    });
  });

  it('reuses the idempotency UUID for unchanged intent and rotates it after any intent change', () => {
    const ids = [idempotencyKey, '51111111-1111-4111-8111-111111111111'];
    const createId = vi.fn(() => ids.shift() ?? '61111111-1111-4111-8111-111111111111');
    const input = {
      sessionId,
      resultToken,
      issueId,
      implementation,
      expectedSnapshotHash: null,
    };

    const first = ensureResultImplementationUpsertIntent(null, input, createId);
    const retry = ensureResultImplementationUpsertIntent(first, input, createId);
    const changed = ensureResultImplementationUpsertIntent(first, {
      ...input,
      implementation: { ...implementation, summary: '변경된 사용자 의도' },
    }, createId);

    expect(retry).toBe(first);
    expect(retry.idempotencyKey).toBe(idempotencyKey);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it('rotates the idempotency UUID when the expected snapshot changes after reload', () => {
    const first = ensureResultImplementationUpsertIntent(null, {
      sessionId, resultToken, issueId, implementation, expectedSnapshotHash: snapshotHash,
    }, () => idempotencyKey);
    const refreshed = ensureResultImplementationUpsertIntent(first, {
      sessionId, resultToken, issueId, implementation, expectedSnapshotHash: 'b'.repeat(64),
    }, () => '51111111-1111-4111-8111-111111111111');

    expect(refreshed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('contains no legacy v2 implementation upsert call', () => {
    const source = readFileSync(new URL('./platform.ts', import.meta.url), 'utf8');

    expect(source).toContain('platform_result_implementation_upsert_v3');
    expect(source).not.toContain('platform_result_implementation_upsert_v2');
  });
});
