import { getSupabase } from './supabase';
import type { AttendanceAction, AttendanceBaseStatus, AttendanceSummary } from '../islands/mod/attendance-logic';

export type AttendanceRosterRow = {
  assignment_id: string;
  member_id: string;
  official_id: string;
  member_name: string;
  team_id: string;
  team_name: string;
  active: boolean;
  base_status: AttendanceBaseStatus;
  checked_in_at: string | null;
  is_late: boolean;
  checked_out_at: string | null;
  is_early_leave: boolean;
  updated_at: string;
};

export type HqAttendanceSummary = AttendanceSummary & { team_id: string };

export type AttendanceAuditRow = {
  id: number;
  team_id: string | null;
  team_name: string | null;
  assignment_id: string | null;
  action: string;
  before_value: unknown;
  after_value: unknown;
  actor_label: string;
  created_at: string;
};

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

export async function unlockTeamAttendance(joinCode: string, pin: string): Promise<string | null> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_team_unlock', {
    p_join_code: joinCode,
    p_pin: pin,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

/**
 * 조 접속코드만으로 출석부 토큰을 받는다(출석 PIN 없음).
 *
 * 모더레이터는 /mod 입장에서 이미 같은 코드를 입력했으므로, 출석부를 열 때 추가 입력이 없다.
 * 코드가 없거나 비활성 조면 null이다. 발급되는 토큰의 권한 범위는 PIN 경로와 동일한
 * scope='team'이며, 자기 조 밖의 배정에는 접근할 수 없다.
 *
 * PIN 경로(unlockTeamAttendance)는 되돌릴 수 있도록 남겨 둔다.
 */
export async function unlockTeamAttendanceByCode(joinCode: string): Promise<string | null> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_team_unlock_by_code', {
    p_join_code: joinCode,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function unlockHqAttendance(password: string, actorLabel: string): Promise<string | null> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_hq_unlock', {
    p_password: password,
    p_actor_label: actorLabel,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function fetchAttendanceRoster(token: string): Promise<AttendanceRosterRow[]> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_roster', { p_token: token });
  if (error) throw error;
  return (data ?? []) as AttendanceRosterRow[];
}

export async function fetchHqAttendanceSummaries(): Promise<HqAttendanceSummary[]> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_hq_summary');
  if (error) throw error;
  return (data ?? []) as HqAttendanceSummary[];
}

export async function setAttendance(
  token: string,
  assignmentId: string,
  action: AttendanceAction,
  occurredAt = new Date().toISOString(),
): Promise<void> {
  const { error } = await client().schema('climate_vote').rpc('attendance_set', {
    p_token: token,
    p_assignment_id: assignmentId,
    p_action: action,
    p_occurred_at: occurredAt,
  });
  if (error) throw error;
}

export async function bulkPresent(token: string, assignmentIds: string[]): Promise<number> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_bulk_present', {
    p_token: token,
    p_assignment_ids: assignmentIds,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function finalizeAbsent(token: string): Promise<number> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_finalize_absent', {
    p_token: token,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function saveRosterMember(
  token: string,
  input: {
    assignmentId?: string | null;
    officialId: string;
    name: string;
    teamId?: string | null;
    active: boolean;
  },
): Promise<string> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_member_save', {
    p_token: token,
    p_assignment_id: input.assignmentId ?? null,
    p_official_id: input.officialId,
    p_name: input.name,
    p_team_id: input.teamId ?? null,
    p_active: input.active,
  });
  if (error) throw error;
  return String(data);
}

export async function fetchAttendanceAudit(token: string, limit = 200): Promise<AttendanceAuditRow[]> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_hq_audit', {
    p_token: token,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AttendanceAuditRow[];
}

export async function setTeamAttendancePin(token: string, teamId: string, pin: string): Promise<void> {
  const { error } = await client().schema('climate_vote').rpc('attendance_hq_set_team_pin', {
    p_token: token,
    p_team_id: teamId,
    p_pin: pin,
  });
  if (error) throw error;
}

export async function fetchRoundEligibleCount(roundId: string): Promise<number> {
  const { data, error } = await client().schema('climate_vote').rpc('attendance_round_eligible_count', {
    p_round_id: roundId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
