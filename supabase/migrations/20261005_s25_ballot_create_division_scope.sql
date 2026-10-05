-- s25 — 분과 조는 다른 분과 한정 투표를 만들 수 없다 (10/17 분과 의결)
--
-- WHY: 10/5 운영 드라이런 — 2분과 조 토큰으로 ballot_create_v3(p_subgroup='1분과')가 받아들여졌다.
--      s24 가 상태 변경은 막았지만 생성은 열려 있었다.
-- WHAT: 운영 정의(pg_get_functiondef, 10/5)에 검사 한 덩어리 — 조에 분과가 있고 p_subgroup 이 다른
--       분과면 거부. 조 분과 없음(운영진), p_subgroup null(세션 전체 투표)은 지금과 같다.
-- HOW: create or replace — grant 불변.

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
     or jsonb_array_length(p_items)>20 then raise exception 'items must be array of 1..20'; end if;
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
