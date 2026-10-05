-- s24 — 분과 조는 다른 분과 투표의 상태를 바꿀 수 없다 (10/17 분과 의결)
--
-- WHY: 10/4 운영 드라이런 N15-server — 2분과 조 토큰으로 1분과 투표를 open 으로 바꾸는 요청이
--      받아들여졌다. 화면은 자기 분과 투표만 보여 주지만(83ec64c) 서버는 세션만 확인한다.
-- WHAT: ballot_set_status_v2 에 한 줄 — 조에 분과가 있고 투표에 분과가 있는데 서로 다르면 거부.
--       조 분과가 없는 운영진 조, 분과가 없는 세션 전체 투표는 지금과 같다.
-- HOW: create or replace 라 기존 grant(p2a 토큰 전용 활성화)가 그대로 남는다.
--      ★ 적용 전 운영의 현재 정의를 pg_get_functiondef 로 떠서 아래 본문과 차이가 이 검사 한 줄뿐인지 확인한다.

create or replace function climate_vote.ballot_set_status_v2(
  p_token text, p_ballot_id uuid, p_status text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot; v_previous_status text;
  v_order jsonb:='{"draft":0,"open":1,"closed":2,"published":3,"archived":4}';
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  select * into v_ballot from climate_vote.ballot where id=p_ballot_id
    and session_id=v_team.session_id and org_id=v_team.org_id for update;
  if not found then raise exception 'ballot not in authorization scope'; end if;
  if nullif(btrim(v_team.subgroup),'') is not null
     and nullif(btrim(v_ballot.subgroup),'') is not null
     and btrim(v_team.subgroup) <> btrim(v_ballot.subgroup) then
    raise exception 'ballot not in authorization scope';
  end if;
  if p_status is null or p_status not in ('open','closed','published','archived') then
    raise exception 'invalid status';
  end if;
  if p_status=v_ballot.status then
    return jsonb_build_object('id',v_ballot.id,'status',v_ballot.status);
  end if;
  if (v_order->>p_status)::int <= (v_order->>v_ballot.status)::int then
    raise exception 'invalid ballot transition';
  end if;
  v_previous_status:=v_ballot.status;
  update climate_vote.ballot set status=p_status,
    published_at=case when p_status='published' then now() else published_at end,
    archived_at=case when p_status='archived' then now() else archived_at end
   where id=p_ballot_id returning * into v_ballot;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'ballot_status_changed','team',v_auth.actor_label,
    jsonb_build_object('ballot_id',p_ballot_id,'status',v_previous_status),
    jsonb_build_object('ballot_id',p_ballot_id,'status',p_status));
  return jsonb_build_object('id',v_ballot.id,'status',v_ballot.status);
end $fn$;
