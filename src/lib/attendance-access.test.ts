import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  bulkPresent,
  changeHqPassword,
  fetchAttendanceAudit,
  fetchAttendanceRoster,
  fetchHqAttendanceSummaries,
  finalizeAbsent,
  revokeHqSession,
  saveRosterMember,
  setAttendance,
  setTeamAttendancePin,
  setTeamTableNo,
} from './attendance';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

function mockRpc() {
  const rpc = vi.fn(() => Promise.resolve({ data: [], error: null }));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

describe('session-scoped attendance RPC adapters', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('binds every attendance read to the explicit session slug', async () => {
    const rpc = mockRpc();
    await fetchAttendanceRoster('token', '0912-deliberation');
    await fetchHqAttendanceSummaries('token', '0912-deliberation');
    await fetchAttendanceAudit('token', '0912-deliberation', 25);

    expect(rpc).toHaveBeenNthCalledWith(1, 'attendance_roster_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'attendance_hq_summary_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'attendance_hq_audit_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_limit: 25,
    });
  });

  it('binds every attendance mutation to the explicit session slug', async () => {
    const rpc = mockRpc();
    await setAttendance('token', '0912-deliberation', 'assignment', 'late', '2026-09-12T01:00:00Z');
    await bulkPresent('token', '0912-deliberation', ['assignment']);
    await finalizeAbsent('token', '0912-deliberation');
    await saveRosterMember('token', '0912-deliberation', {
      assignmentId: 'assignment',
      officialId: 'C-001',
      name: '합성 참여자',
      teamId: 'team',
      active: true,
    });
    await setTeamAttendancePin('token', '0912-deliberation', 'team', '123456');
    await setTeamTableNo('token', '0912-deliberation', 'team', 'A-01');

    expect(rpc).toHaveBeenNthCalledWith(1, 'attendance_set_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_assignment_id: 'assignment',
      p_action: 'late',
      p_occurred_at: '2026-09-12T01:00:00Z',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'attendance_bulk_present_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_assignment_ids: ['assignment'],
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'attendance_finalize_absent_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
    });
    expect(rpc).toHaveBeenNthCalledWith(4, 'attendance_member_save_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_assignment_id: 'assignment',
      p_official_id: 'C-001',
      p_name: '합성 참여자',
      p_team_id: 'team',
      p_active: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(5, 'attendance_hq_set_team_pin_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_team_id: 'team',
      p_pin: '123456',
    });
    expect(rpc).toHaveBeenNthCalledWith(6, 'attendance_hq_set_table_no_v2', {
      p_token: 'token',
      p_session_slug: '0912-deliberation',
      p_team_id: 'team',
      p_table_no: 'A-01',
    });
  });

  it('surfaces persisted HQ password failures returned by the server', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: { changed: false, error: 'current_password_incorrect' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { changed: false, error: 'rate_limited' },
        error: null,
      })
      .mockResolvedValueOnce({ data: { changed: true }, error: null });
    vi.mocked(getSupabase).mockReturnValue({
      schema: vi.fn(() => ({ rpc })),
    } as never);

    await expect(changeHqPassword('hq-token', 'wrong', 'new-password'))
      .rejects.toThrow('현재 비밀번호가 맞지 않습니다');
    await expect(changeHqPassword('hq-token', 'wrong-again', 'new-password'))
      .rejects.toThrow('15분 뒤에 다시 해 주세요');
    await expect(changeHqPassword('hq-token', 'current', 'new-password'))
      .resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(1, 'hq_change_password', {
      p_token: 'hq-token',
      p_current_password: 'wrong',
      p_new_password: 'new-password',
    });
  });

  it('revokes the current HQ bearer through the scoped logout RPC', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    vi.mocked(getSupabase).mockReturnValue({
      schema: vi.fn(() => ({ rpc })),
    } as never);

    await expect(revokeHqSession('hq-token')).resolves.toBeUndefined();
    await expect(revokeHqSession('already-revoked')).rejects.toThrow('서버 로그아웃');
    expect(rpc).toHaveBeenNthCalledWith(1, 'workshop_hq_logout_v2', {
      p_token: 'hq-token',
    });
  });
});
