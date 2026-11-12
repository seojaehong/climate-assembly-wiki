-- s35 — 11/14 진행판 「한 이름에 기기 2대 이상」 · 「대리 입력」 표시. ballot_progress_board 하나만 바꾼다.
--
-- WHY: 투표 시작은 이름을 잠그지 않는다(s33). 도움을 받아 다른 기기로 같은 이름을 이어 하거나, 누가 남의 이름으로
--   먼저 들어가도 지금 진행판은 알 수 없다. 수기 투표지는 진행요원이 대리 입력 모드(/b?…&proxy=1)로 넣는다 —
--   그 기기의 client_id 는 'proxy-' 로 시작한다(화면이 사람마다 새로 만든다).
-- WHAT: voters[] 에 두 칸을 더한다(나머지 출력·정의는 s34 그대로).
--   devices = 그 (조, 이름)으로 시작·진행·제출한 고유 기기(client_id) 수. 2 이상이면 운영이 확인한다.
--   proxy   = 그 (조, 이름)의 제출 응답이 대리 입력 기기('proxy-%')에서 왔다.
--   찬성·반대 값은 여전히 어디에도 없다.
-- 되돌리기: supabase/migrations/20261112_s34_ballot_progress.sql 의 ballot_progress_board 정의를 다시 적용.

-- 운영(접속 토큰) — 권고안별 누른 인원 + 사람별 진행. 찬성·반대 값은 어디에도 없다.
create or replace function climate_vote.ballot_progress_board(p_token text, p_ballot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot;
  v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  select * into v_ballot from climate_vote.ballot where id=p_ballot_id
    and session_id=v_team.session_id and org_id=v_team.org_id;
  if not found then raise exception 'ballot not in authorization scope'; end if;
  if nullif(btrim(v_team.subgroup),'') is not null
     and nullif(btrim(v_ballot.subgroup),'') is not null
     and btrim(v_team.subgroup) <> btrim(v_ballot.subgroup) then
    raise exception 'ballot not in authorization scope';
  end if;

  with
  ros as (
    select r.team_label as team, r.name_norm as norm, min(r.name) as name
      from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
     group by r.team_label, r.name_norm),
  st as (
    select s.voter_team as team, s.voter_name_norm as norm, min(s.started_at) as started_at,
           (array_agg(s.voter_name order by s.updated_at desc, s.id desc))[1] as name,
           array_agg(s.client_id) as clients
      from climate_vote.ballot_start s where s.ballot_id=v_ballot.id
     group by s.voter_team, s.voter_name_norm),
  pg as (
    select p.voter_team as team, p.voter_name_norm as norm, p.voter_name as name, p.client_id,
           p.answered, p.last_ordinal, p.updated_at
      from climate_vote.ballot_progress p where p.ballot_id=v_ballot.id),
  rs as (
    select br.voter_team as team, br.voter_name_norm as norm, min(br.submitted_at) as submitted_at,
           (array_agg(br.voter_name order by br.submitted_at, br.id))[1] as name,
           bool_or(br.client_id like 'proxy-%') as proxy
      from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.voter_name_norm is not null and br.voter_team is not null
     group by br.voter_team, br.voter_name_norm),
  -- s35: (조, 이름)마다 고유 기기 수 — 시작 · 진행(마지막 기기) · 제출.
  dev as (
    select team, norm, count(distinct cid)::int as n from (
      select s.voter_team as team, s.voter_name_norm as norm, s.client_id as cid
        from climate_vote.ballot_start s where s.ballot_id=v_ballot.id
      union all select p.voter_team, p.voter_name_norm, p.client_id
        from climate_vote.ballot_progress p where p.ballot_id=v_ballot.id
      union all select br.voter_team, br.voter_name_norm, br.client_id
        from climate_vote.ballot_response br
       where br.ballot_id=v_ballot.id and br.voter_name_norm is not null and br.voter_team is not null) d
     group by team, norm),
  submitted_clients as (
    select distinct br.client_id from climate_vote.ballot_response br where br.ballot_id=v_ballot.id),
  -- 유령: 명단 밖 · 이 이름으로는 미제출 · 그런데 그 기기는 (다른 이름으로) 제출함 → 보드에서 뺀다.
  ghost as (
    select x.team, x.norm
      from (select team, norm from st union select team, norm from pg) x
     where not exists(select 1 from ros where ros.team=x.team and ros.norm=x.norm)
       and not exists(select 1 from rs where rs.team=x.team and rs.norm=x.norm)
       and (exists(select 1 from pg where pg.team=x.team and pg.norm=x.norm
                    and pg.client_id in (select client_id from submitted_clients))
            or exists(select 1 from st cross join lateral unnest(st.clients) as c(cid)
                       where st.team=x.team and st.norm=x.norm
                         and c.cid in (select client_id from submitted_clients)))),
  -- (사람, 문항) 쌍 — 진행 기록 ∪ 제출 응답(키 존재만). 무기명 응답은 응답 id 로 한 사람.
  pairs as (
    select p.team, p.norm, o.ord
      from pg p cross join lateral unnest(p.answered) as o(ord)
     where not exists(select 1 from ghost g where g.team=p.team and g.norm=p.norm)
    union
    select coalesce(br.voter_team,''), coalesce(br.voter_name_norm,'#'||br.id::text), bi.ordinal
      from climate_vote.ballot_response br
      join climate_vote.ballot_item bi on bi.ballot_id=br.ballot_id and br.answers ? bi.id::text
     where br.ballot_id=v_ballot.id),
  per_person as (select team, norm, count(*)::int as n from pairs group by team, norm),
  per_item as (select ord, count(*)::int as n from pairs group by ord),
  people as (
    (select team, norm from ros
     union select team, norm from st
     union select team, norm from pg
     union select team, norm from rs)
    except select team, norm from ghost),
  v as (
    select pe.team, pe.norm,
           coalesce(ros.name, rs.name, pg.name, st.name) as name,
           (ros.norm is not null) as in_roster,
           st.started_at,
           coalesce(pp.n,0) as answered_count,
           pg.last_ordinal, pg.updated_at,
           (rs.norm is not null) as submitted, rs.submitted_at,
           coalesce(dev.n,0) as devices, coalesce(rs.proxy,false) as proxy
      from people pe
      left join ros on ros.team=pe.team and ros.norm=pe.norm
      left join st  on st.team=pe.team and st.norm=pe.norm
      left join pg  on pg.team=pe.team and pg.norm=pe.norm
      left join rs  on rs.team=pe.team and rs.norm=pe.norm
      left join per_person pp on pp.team=pe.team and pp.norm=pe.norm
      left join dev on dev.team=pe.team and dev.norm=pe.norm)
  select jsonb_build_object(
    'id',v_ballot.id,'title',v_ballot.title,'status',v_ballot.status,
    'item_count',(select count(*) from climate_vote.ballot_item bi where bi.ballot_id=v_ballot.id),
    'at',now(),
    'roster_count',(select count(*) from ros),
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
        'ordinal',bi.ordinal,
        'statement_head',left(bi.statement,40),
        'answered',coalesce(pi.n,0))
        order by bi.ordinal),'[]'::jsonb)
      from climate_vote.ballot_item bi left join per_item pi on pi.ord=bi.ordinal
     where bi.ballot_id=v_ballot.id),
    'voters',(select coalesce(jsonb_agg(jsonb_build_object(
        'team',v.team,'name',v.name,'in_roster',v.in_roster,
        'started_at',v.started_at,'answered_count',v.answered_count,
        'last_ordinal',v.last_ordinal,'updated_at',v.updated_at,
        'submitted',v.submitted,'submitted_at',v.submitted_at,
        'devices',v.devices,'proxy',v.proxy)
        order by v.team, v.name),'[]'::jsonb)
      from v),
    'submitted',(select count(*) from climate_vote.ballot_response br where br.ballot_id=v_ballot.id),
    'started',greatest(
      (select count(*) from ((select team, norm from st union select team, norm from pg union select team, norm from rs)
                              except select team, norm from ghost) x),
      (select count(*) from climate_vote.ballot_response br where br.ballot_id=v_ballot.id)))
  into v_result;
  return v_result;
end $function$;
grant execute on function climate_vote.ballot_progress_board(text,uuid) to anon, authenticated;
revoke execute on function climate_vote.ballot_progress_board(text,uuid) from public;
