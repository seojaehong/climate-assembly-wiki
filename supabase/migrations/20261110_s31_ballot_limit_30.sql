-- s31 — 투표지 문항 상한 20 → 30 (11/14 의제별 투표지)
--
-- WHY: 11/14 최종 의결은 의제별 투표지 3장(19·28·23건)이다. 상한 20 이면 28건 투표지를 만들 수 없다.
--      사용자 지시 「최대치를 넘는 수로」 — 최대 28건보다 큰 30.
-- WHAT: s25(20261005_s25_ballot_create_division_scope.sql) 본문을 글자 그대로 베끼고
--       문항 수 검사 한 줄(>20 → >30)과 그 예외 문구(1..20 → 1..30)만 바꿨다.
--       화면 상수 src/islands/mod/ballot-panel-logic.ts MAX_BALLOT_ITEMS 도 30 (계약 시험이 두 값을 맞춘다).
-- HOW: create or replace — 시그니처·반환형 불변. create or replace 는 기존 권한을 그대로 두지만,
--      AGENTS.md 「4·5 는 항상 짝」 관례대로 platform_p1a(revoke from public) · platform_p2a(grant to anon,
--      authenticated) 의 원래 문장을 끝에 다시 적는다. 운영 상태가 그 두 문장의 결과와 같으면 무변경이다.
-- ★ 적용 전: 운영 pg_get_functiondef('climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid)'::regprocedure)
--    가 s25 본문과 같은지 먼저 대조한다. s25 이후 운영에서 바뀌었으면 이 파일이 그 변경을 되돌린다.
-- 되돌리기: supabase/rollbacks/20261110_s31_ballot_limit_30_BEFORE.sql (= s25 본문)

CREATE OR REPLACE FUNCTION climate_vote.ballot_create_v3(p_token text, p_title text, p_instructions text, p_items jsonb, p_subgroup text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'climate_vote', 'extensions', 'pg_temp'
AS $function$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot; v_n int; v_hash text; v_prior jsonb; v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if nullif(btrim(v_team.subgroup),'') is not null
     and nullif(btrim(p_subgroup),'') is not null
     and btrim(v_team.subgroup) <> btrim(p_subgroup) then
    raise exception 'subgroup not in authorization scope';
  end if;
  if length(trim(coalesce(p_title,'')))=0 then raise exception 'ballot title required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>30 then raise exception 'items must be array of 1..30'; end if;
  v_hash:=encode(digest(concat_ws('|',trim(p_title),
    nullif(trim(coalesce(p_instructions,'')),''),p_items::text,p_subgroup),'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'ballot_create_v3',v_hash,v_team.org_id,v_team.session_id,v_team.id);
  if v_prior is not null then return v_prior; end if;
  if p_subgroup is not null then
    perform 1 from climate_vote.team where session_id=v_team.session_id
      and org_id=v_team.org_id and subgroup=p_subgroup and status='active';
    if not found then raise exception 'unknown subgroup'; end if;
  end if;
  insert into climate_vote.ballot(session_id,title,instructions,created_by,subgroup,org_id)
  values(v_team.session_id,trim(p_title),nullif(trim(coalesce(p_instructions,'')),''),
    'mod:'||v_team.name,p_subgroup,v_team.org_id) returning * into v_ballot;
  insert into climate_vote.ballot_item(ballot_id,ordinal,statement,description,scale,required)
  select v_ballot.id,coalesce((e->>'ordinal')::int,rn),trim(e->>'statement'),
    nullif(trim(coalesce(e->>'description','')),''),coalesce((e->>'scale')::int,5),
    coalesce((e->>'required')::boolean,true)
  from jsonb_array_elements(p_items) with ordinality as x(e,rn)
  where length(trim(coalesce(e->>'statement','')))>0;
  get diagnostics v_n=row_count;
  if v_n=0 then raise exception 'no valid items'; end if;
  v_result:=jsonb_build_object('id',v_ballot.id,'token',v_ballot.token,
    'status',v_ballot.status,'subgroup',v_ballot.subgroup,'items',v_n);
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,p_idempotency_key,'ballot_created','team',v_auth.actor_label,null,
    jsonb_build_object('ballot_id',v_ballot.id,'items',v_n,'subgroup',p_subgroup));
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $function$
;

revoke execute on function climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid) from public;
grant execute on function climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid) to anon, authenticated;
