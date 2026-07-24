-- feat(mod-console): timer_log에 anon RLS/GRANT가 없어 직접 insert가 항상 실패함.
-- WHY: timer_log는 RLS enable + anon 정책 없음(20260724_mod_console_core.sql). 다른
--      mod_* RPC와 동일한 join_code 스코프 검증 패턴으로 SECURITY DEFINER RPC를 추가.
-- WHAT: mod_log_timer(p_code, p_kind, p_duration_s, p_started_at, p_ended_at) → bigint.
-- SAFETY: 순수 additive. 기존 정책/테이블 변경 없음.
-- NOTE: 이 RPC는 컨트롤러가 live DB에 이미 적용함(2026-07-24) — 이 파일은 저장소를
--       source of truth로 유지하기 위한 사후 기록.

create or replace function climate_vote.mod_log_timer(
  p_code text, p_kind text, p_duration_s int, p_started_at timestamptz, p_ended_at timestamptz default null)
returns bigint language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_id bigint;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  if p_kind not in ('speech','session') then raise exception 'invalid kind: %', p_kind; end if;
  if p_duration_s < 1 or p_duration_s > 14400 then raise exception 'duration out of range'; end if;
  insert into climate_vote.timer_log (team_id, kind, duration_s, started_at, ended_at)
  values (v_team.id, p_kind, p_duration_s, p_started_at, p_ended_at)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function climate_vote.mod_log_timer to anon;
