import { getSupabase } from './supabase';

/**
 * 10/17 분과 의결 준비 상태 — 서버 저장(마이그레이션 20261010_s26_division_prep_state.sql).
 *
 * 분과 오퍼레이터(분과 팀 토큰)는 자기 분과 한 줄만 읽고 쓴다.
 * 운영팀(분과 칸이 빈 팀 토큰)은 세 분과를 모두 읽고 쓴다 — 중앙 통제.
 * 저장은 판번호(version)가 맞을 때만 된다. 어긋나면 서버가 예외 대신 현재 줄을 돌려준다.
 *
 * 파라미터명·반환 구조는 SQL 과 1:1 이다. 바꿀 때는 마이그레이션과 함께 바꾼다.
 */

export type DivisionPrepRow = {
  subgroup: string;      // '1분과' | '2분과' | '3분과'
  version: number;       // 0 = 아직 저장된 적 없음
  state: unknown;        // PrepState(JSON). 화면 쪽에서 검증해 쓴다
  updated_at: string | null;
  updated_by: string | null;
};

export type DivisionPrepGetResult = {
  scope: 'division' | 'ops';
  team_subgroup: string | null; // 분과 팀이면 그 분과, 운영팀이면 null
  server_now: string;
  rows: DivisionPrepRow[];      // 분과 팀 1줄, 운영팀 3줄(저장 전 분과는 version 0·state null)
};

export type DivisionPrepSaveResult =
  | { ok: true; version: number; updated_at: string }
  | { ok: false; conflict: true; current: DivisionPrepRow };

export const DIVISION_PREP_MAX_BYTES = 524288;

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

export async function divisionPrepGet(token: string): Promise<DivisionPrepGetResult> {
  const { data, error } = await client().schema('climate_vote').rpc('division_prep_get_v1', {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return data as DivisionPrepGetResult;
}

export async function divisionPrepSave(
  token: string,
  subgroup: string,
  expectedVersion: number,
  state: unknown,
  label: string,
): Promise<DivisionPrepSaveResult> {
  const { data, error } = await client().schema('climate_vote').rpc('division_prep_save_v1', {
    p_token: token,
    p_subgroup: subgroup,
    p_expected_version: expectedVersion,
    p_state: state,
    p_label: label,
  });
  if (error) throw new Error(error.message);
  return data as DivisionPrepSaveResult;
}
