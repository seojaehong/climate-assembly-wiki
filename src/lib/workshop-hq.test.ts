import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  fetchWorkshopDevices,
  fetchWorkshopHqStatus,
  openNextWorkshopTopic,
  revokeWorkshopDevice,
  setWorkshopDeadline,
  setWorkshopTopicStatus,
} from './workshop-hq';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

function mockRpc(results: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(() => Promise.resolve(results.shift() ?? { data: null, error: null }));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

describe('workshop HQ adapters', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('reads status and devices without exposing a raw device token', async () => {
    const status = { session_id: 's1', session_slug: '0912-deliberation', topic_total: 6 };
    const devices = [{ token_hash: 'hash', team_id: 't1', device_id: 'd1' }];
    const rpc = mockRpc([{ data: status, error: null }, { data: devices, error: null }]);
    await expect(fetchWorkshopHqStatus('hq-token', '0912-deliberation')).resolves.toEqual(status);
    await expect(fetchWorkshopDevices('hq-token', '0912-deliberation')).resolves.toEqual(devices);
    expect(rpc).toHaveBeenNthCalledWith(1, 'workshop_hq_status', {
      p_token: 'hq-token', p_session_slug: '0912-deliberation',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'workshop_hq_devices', {
      p_token: 'hq-token', p_session_slug: '0912-deliberation',
    });
  });

  it('opens the expected next topic with an idempotency key', async () => {
    const rpc = mockRpc([{ data: { status: 'opened', ordinal: 2 }, error: null }]);
    await openNextWorkshopTopic('hq-token', '0912-deliberation', 2, 'request-1');
    expect(rpc).toHaveBeenCalledWith('workshop_hq_open_next_topic', {
      p_token: 'hq-token',
      p_session_slug: '0912-deliberation',
      p_expected_ordinal: 2,
      p_idempotency_key: 'request-1',
    });
  });

  it('sets status and revokes an exact hashed device authorization', async () => {
    const rpc = mockRpc([
      { data: { status: 'updated', topic_id: 'topic-1' }, error: null },
      { data: null, error: null },
    ]);
    await setWorkshopTopicStatus(
      'hq-token',
      '0912-deliberation',
      'topic-1',
      'open',
      'closed',
      'request-2',
    );
    await revokeWorkshopDevice(
      'hq-token',
      '0912-deliberation',
      'hash-1',
      '현장 기기 교체',
      'request-3',
    );
    expect(rpc).toHaveBeenNthCalledWith(1, 'workshop_hq_set_topic_status', {
      p_token: 'hq-token', p_session_slug: '0912-deliberation', p_topic_id: 'topic-1',
      p_expected_status: 'open', p_status: 'closed', p_idempotency_key: 'request-2',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'workshop_hq_revoke_device', {
      p_token: 'hq-token', p_session_slug: '0912-deliberation', p_token_hash: 'hash-1',
      p_reason: '현장 기기 교체', p_idempotency_key: 'request-3',
    });
  });

  it('stops a stale topic status change instead of overwriting it', async () => {
    const rpc = mockRpc([{
      data: {
        status: 'conflict',
        topic_id: 'topic-1',
        current_status: 'closed',
        expected_status: 'open',
      },
      error: null,
    }]);
    await expect(setWorkshopTopicStatus(
      'hq-token',
      '0912-deliberation',
      'topic-1',
      'open',
      'closed',
      'request-4',
    )).rejects.toMatchObject({ name: 'WorkshopHqConflictError' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('sets a deadline with session scope, CAS and idempotency', async () => {
    const rpc = mockRpc([{
      data: { status: 'updated', topic_id: 'topic-1', deadline_at: '2026-09-12T06:00:00Z' },
      error: null,
    }]);
    await setWorkshopDeadline(
      'hq-token',
      '0912-deliberation',
      'topic-1',
      null,
      '2026-09-12T06:00:00Z',
      'request-5',
    );
    expect(rpc).toHaveBeenCalledWith('workshop_hq_set_deadline', {
      p_token: 'hq-token',
      p_session_slug: '0912-deliberation',
      p_topic_id: 'topic-1',
      p_expected_deadline_at: null,
      p_deadline_at: '2026-09-12T06:00:00Z',
      p_idempotency_key: 'request-5',
    });
  });

  it('stops a stale deadline update', async () => {
    mockRpc([{
      data: {
        status: 'conflict',
        topic_id: 'topic-1',
        deadline_at: '2026-09-12T06:00:00Z',
        expected_deadline_at: null,
      },
      error: null,
    }]);
    await expect(setWorkshopDeadline(
      'hq-token',
      '0912-deliberation',
      'topic-1',
      null,
      '2026-09-12T07:00:00Z',
      'request-6',
    )).rejects.toMatchObject({ name: 'WorkshopHqDeadlineConflictError' });
  });
});
