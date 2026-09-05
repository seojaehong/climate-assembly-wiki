import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  clearWorkshopSession,
  deviceLabel,
  exchangeWorkshopCode,
  getOrCreateWorkshopDeviceId,
  readWorkshopSession,
  revokeWorkshopSession,
  resumeWorkshopSession,
  storeWorkshopSession,
  type WorkshopSession,
} from './workshop-access';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const session: WorkshopSession = {
  v: 1,
  accessToken: 'a'.repeat(64),
  expiresAt: '2026-09-13T13:00:00.000Z',
  deviceId: '00000000-0000-4000-8000-000000000001',
  deviceLabel: 'Windows · Chrome',
  sessionId: '00000000-0000-4000-8000-000000000010',
  sessionSlug: '0912-deliberation',
  team: {
    id: '00000000-0000-4000-8000-000000000020',
    name: '1분과 1조',
    subgroup: '1분과',
    capacity: 14,
    table_no: '1',
  },
};

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

describe('workshop device identity', () => {
  it('creates one UUID and reuses it', () => {
    const storage = new MemoryStorage();
    const first = getOrCreateWorkshopDeviceId(storage, () => '00000000-0000-4000-8000-000000000099');
    const second = getOrCreateWorkshopDeviceId(storage, () => 'different');
    expect(first).toBe('00000000-0000-4000-8000-000000000099');
    expect(second).toBe(first);
  });

  it('does not reuse malformed stored identifiers', () => {
    const storage = new MemoryStorage();
    storage.setItem('climate_vote_mod_device_id', 'not-a-uuid');
    expect(getOrCreateWorkshopDeviceId(storage, () => session.deviceId)).toBe(session.deviceId);
  });

  it('creates a short non-identifying browser label', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36')).toBe('Windows · Chrome');
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18 Mobile Safari')).toBe('iPad · Safari');
  });
});

describe('workshop session storage', () => {
  it('round-trips a valid session without storing the join code', () => {
    const storage = new MemoryStorage();
    expect(storeWorkshopSession(storage, session)).toBe(true);
    expect(readWorkshopSession(storage, Date.parse('2026-09-13T12:00:00Z'))).toEqual(session);
    expect([...storage.values.values()].join(' ')).not.toContain('091201');
  });

  it('rejects expired or malformed sessions and clears them', () => {
    const storage = new MemoryStorage();
    storeWorkshopSession(storage, session);
    expect(readWorkshopSession(storage, Date.parse('2026-09-13T13:00:00Z'))).toBeNull();
    expect(storage.length).toBe(0);
    storage.setItem('climate_vote_mod_session_v1', '{broken');
    expect(readWorkshopSession(storage, 0)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('clears only workshop authorization state', () => {
    const storage = new MemoryStorage();
    storeWorkshopSession(storage, session);
    storage.setItem('unrelated', 'keep');
    expect(clearWorkshopSession(storage)).toBe(true);
    expect(storage.getItem('climate_vote_mod_session_v1')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });
});

describe('workshop access RPC', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('exchanges a join code for an opaque session and never puts the code in the result', async () => {
    const rpc = mockRpc({ data: session, error: null });
    await expect(exchangeWorkshopCode('091201', session.deviceId, session.deviceLabel)).resolves.toEqual(session);
    expect(rpc).toHaveBeenCalledWith('mod_exchange_join_code', {
      p_join_code: '091201',
      p_device_id: session.deviceId,
      p_device_label: session.deviceLabel,
    });
    expect(JSON.stringify(session)).not.toContain('091201');
  });

  it('resumes only through the token validation RPC', async () => {
    const rpc = mockRpc({ data: session, error: null });
    await expect(resumeWorkshopSession(session.accessToken)).resolves.toEqual(session);
    expect(rpc).toHaveBeenCalledWith('mod_session_get', { p_token: session.accessToken });
  });

  it('revokes the exact team bearer through the server logout RPC', async () => {
    const rpc = mockRpc({ data: true, error: null });
    await expect(revokeWorkshopSession(session.accessToken)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('workshop_team_logout_v2', {
      p_token: session.accessToken,
    });
  });

  it('does not claim team logout when the server cannot revoke the bearer', async () => {
    mockRpc({ data: false, error: null });
    await expect(revokeWorkshopSession(session.accessToken)).rejects.toThrow('서버에서 조 연결을 종료하지 못했습니다');
  });

  it('logs no secrets and propagates a server failure', async () => {
    const error = { code: 'P0001', message: 'team_device_limit' };
    mockRpc({ data: null, error });
    await expect(exchangeWorkshopCode('091201', session.deviceId, 'Windows · Chrome')).rejects.toBe(error);
  });
});
