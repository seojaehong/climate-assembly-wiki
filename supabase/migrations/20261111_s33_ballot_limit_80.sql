-- s33 — 투표지 문항 상한 30 → 80 (11/11 주최 결정: 11/14 최종 의결을 투표지 1장 · QR 하나에 70건)
--
-- WHAT: s31(20261110_s31_ballot_limit_30.sql) 본문을 글자 그대로 베끼고 문항 수 검사 한 줄(>30 → >80)과 예외 문구만 바꿨다.
--       화면 상수 src/islands/mod/ballot-panel-logic.ts MAX_BALLOT_ITEMS 도 80.
-- 되돌리기: 20261110_s31_ballot_limit_30.sql 을 다시 적용.

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
     or jsonb_array_length(p_items)>80 then raise exception 'items must be array of 1..80'; end if;
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
