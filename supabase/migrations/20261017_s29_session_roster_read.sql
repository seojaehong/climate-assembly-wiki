-- s29 (2026-10-17): 운영 콘솔이 자기 범위의 명단(조·이름)을 읽는다 — 위임 안건 아래 「검토위원(시민대표) 1조~5조」 칸에서 고른다.
-- 추가만 한다(s28 의 ballot_roster 표를 읽기만). 인증·범위 = s28 ballot_named_responses_v2 와 같다:
-- 조 토큰(attendance_token_row + team_token_row), 분과가 있는 조는 그 분과 명단만, 분과가 빈 조(운영팀)는 세션 전체.
-- 전화번호 등 연락처는 명단 표에 없다(이름·조·번호만).
-- 되돌리기: supabase/rollbacks/20261017_s29_session_roster_read_BEFORE.sql

create or replace function climate_vote.ballot_session_roster_v2(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'team',r.team_label,'no',r.no,'name',r.name)
      order by r.team_label, r.no nulls last, r.name),'[]'::jsonb)
    from climate_vote.ballot_roster r
    where r.session_id=v_team.session_id
      and (nullif(btrim(v_team.subgroup),'') is null or r.subgroup=btrim(v_team.subgroup)));
end $function$;
grant execute on function climate_vote.ballot_session_roster_v2(text) to anon, authenticated;
revoke execute on function climate_vote.ballot_session_roster_v2(text) from public;
