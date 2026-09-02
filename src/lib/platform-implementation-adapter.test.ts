import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import { resultImplementationUpsert } from './platform';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

describe('resultImplementationUpsert', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(getSupabase).mockReturnValue({
      schema: vi.fn(() => ({ rpc })),
    } as unknown as NonNullable<ReturnType<typeof getSupabase>>);
  });

  it('passes only HQ capability, result, issue and validated public fields to the RPC', async () => {
    rpc.mockResolvedValue({
      data: { result_id: 'result-1', issue_id: 'issue-1', updated_at: '2026-09-03T01:30:00.000Z' },
      error: null,
    });

    const result = await resultImplementationUpsert('hq-token', 'result-1', 'issue-1', {
      status: 'in_progress',
      responsible_body: '교통정책 담당기관',
      updated_at: '2026-09-03T01:30:00.000Z',
      summary: '세부 이행을 진행하고 있습니다.',
      evidence_url: null,
    });

    expect(rpc).toHaveBeenCalledWith('result_implementation_upsert', {
      p_token: 'hq-token',
      p_result_id: 'result-1',
      p_issue_id: 'issue-1',
      p_implementation: {
        status: 'in_progress',
        responsible_body: '교통정책 담당기관',
        updated_at: '2026-09-03T01:30:00.000Z',
        summary: '세부 이행을 진행하고 있습니다.',
        evidence_url: null,
      },
    });
    expect(result.notice).toBeNull();
  });

  it('degrades to an explicit approval notice while the RPC migration is absent', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

    const result = await resultImplementationUpsert('hq-token', 'result-1', 'issue-1', {
      status: 'planned',
      responsible_body: '교통정책 담당기관',
      updated_at: '2026-09-03T01:30:00.000Z',
      summary: '이행 계획을 수립했습니다.',
      evidence_url: null,
    });

    expect(result).toEqual({
      data: null,
      notice: '이행조치 저장 RPC가 아직 승인·적용되지 않았습니다. A7 migration 승인 후 사용할 수 있습니다.',
    });
  });
});
