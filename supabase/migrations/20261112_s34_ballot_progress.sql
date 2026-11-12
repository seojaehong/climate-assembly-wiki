-- s34 (제안 · 미적용) — 11/14 의결 투표지 「권고안별 진행 기록」. ★ 에이전트는 파일만 썼다. 적용은 사람이 승인 후.
--
-- WHY: 11/14 투표지는 카드 한 장씩 찬성·반대를 누르고 마지막에 한 번 제출한다. 지금은 제출 때만 서버에 남아
--   「70건 중 몇 건을 누가 눌렀는지」를 운영이 알 수 없다. 타이머가 끝나면 미제출=기권이므로, 진행 중에
--   분과·조별로 누구를 독려할지 보려면 「그 건을 눌렀다」는 사실이 제출 전에도 서버에 있어야 한다(11/12 줌 결정).
-- WHAT:
--   1) climate_vote.ballot_progress — (투표지, 조, 이름) 한 줄. 눌러 본 문항 번호(ordinal) 집합만 둔다.
--      ★ 찬성·반대 값은 받지도 저장하지도 않는다(16:30 일괄 공개 전). 인자에 값 자리가 아예 없다.
--   2) ballot_progress_named — 참가자(투표 링크 토큰). ballot_start_named(s33)와 같은 검증·정규화·투표지 조건.
--      이미 제출한 (조, 이름)이나 이 기기는 무시하고 ok 를 돌려준다(화면은 어차피 오류를 삼킨다).
--   3) ballot_progress_board — 운영(접속 토큰). ballot_named_responses_v2 와 같은 인가 블록.
--      권고안별 「누른 고유 인원」 + 명단 전원(과 명단 밖 시작·제출자)의 진행. 응답 answers 는 키 존재(?)로만 본다.
--   ballot_live_counts(공개 표출 화면)는 건드리지 않는다.
-- 정의(board):
--   사람 = (voter_team, voter_name_norm).
--   submitted = ballot_response 행 수(ballot_live_counts 와 같은 정의).
--   started   = (ballot_start ∪ ballot_progress ∪ 실명 응답)의 고유 사람 수 − 유령, 단 제출 수보다 작지 않게
--               (ballot_live_counts 의 greatest(started, submitted) 와 같은 꼴. 그쪽은 progress·유령 처리가 없어 값이 다를 수 있다).
--   items[].answered = 진행 기록에 그 ordinal 이 있음 OR 제출 응답 answers 에 그 문항 키가 있음 — 고유 사람 수(유령 제외).
--   voters[].answered_count = 같은 합집합에서 그 사람의 고유 문항 수.
--   유령: 한 기기가 이름 A 로 누르다가 이름 B 로 제출하면 A 의 진행 행이 「미제출」로 남는다. 그 기기(client_id)가
--     제출했고 A 가 명단 밖·미제출이면 voters · items · started 에서 뺀다(명단 안이면 그대로 둔다 — 운영이 확인할 사람이다).
-- 선행: s28(ballot_roster · voter_name_norm · ballot_response 실명 칸) · s33(ballot_start) 적용 뒤.
--   plpgsql 은 만들 때 표를 확인하지 않으므로 순서가 어긋나면 호출 때 터진다.
-- 적용 전: 운영에 climate_vote.ballot_progress 표와 두 함수가 없는지(새로 만드는 것뿐 — 기존 함수·표·권한 무변경).
-- 되돌리기: supabase/rollbacks/20261112_s34_ballot_progress_BEFORE.sql

create table if not exists climate_vote.ballot_progress (
  ballot_id uuid not null references climate_vote.ballot(id),
  client_id text not null,
  voter_team text not null,
  voter_name text not null,
  voter_name_norm text not null,
  answered int[] not null default '{}',
  last_ordinal int,
  updated_at timestamptz not null default now(),
  primary key (ballot_id, voter_team, voter_name_norm)
);
alter table climate_vote.ballot_progress enable row level security;
revoke all on climate_vote.ballot_progress from public, anon, authenticated;

-- 참가자(투표 링크 토큰) — 카드 한 장을 눌렀다는 기록. 값은 없다. 실패해도 투표는 막지 않는다(화면이 오류를 삼킨다).
create or replace function climate_vote.ballot_progress_named(
  p_token text, p_client_id text, p_voter_team text, p_voter_name text, p_ordinal int)
returns jsonb
language plpgsql
security definer
set search_path to 'climate_vote', 'extensions', 'pg_temp'
as $function$
declare v_ballot climate_vote.ballot;
  v_team text := btrim(coalesce(p_voter_team,''));
  v_name text := btrim(regexp_replace(coalesce(p_voter_name,''), '[[:space:] 　]+', ' ', 'g'));
  v_norm text := climate_vote.voter_name_norm(p_voter_name);
  v_item_count int;
begin
  if p_token is null or length(p_token)<>32 then raise exception 'ballot token required'; end if;
  if p_client_id is null or length(trim(p_client_id)) not between 8 and 80 then raise exception 'ballot client id required'; end if;
  if v_norm='' or length(v_name)>80 or v_team='' or length(v_team)>60 then raise exception 'voter name required'; end if;
  if p_ordinal is null then raise exception 'ballot item ordinal required'; end if;
  select b.* into v_ballot
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
      and s.access_expires_at is not null and s.access_expires_at>now()
   where b.token=p_token and b.status='open' and b.archived_at is null;
  if not found then raise exception 'ballot not open or event unavailable'; end if;
  if not exists(select 1 from climate_vote.ballot_item bi
     where bi.ballot_id=v_ballot.id and bi.ordinal=p_ordinal) then
    raise exception 'ballot item ordinal out of range';
  end if;
  -- 실명 수집이 꺼진 세션이면 이름을 남기지 않는다(ballot_submit_named 의 'named voting off' 와 같은 조건, 여기선 무시).
  if not coalesce((climate_vote.session_named_vote(v_ballot.session_id)->>'collect')::boolean, true) then
    return jsonb_build_object('ok',true,'ignored','named_off');
  end if;
  -- 이미 낸 사람(같은 조·이름) 또는 이미 낸 기기 — 진행 기록은 더 쌓지 않는다.
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id
       and ((br.voter_team=v_team and br.voter_name_norm=v_norm) or br.client_id=trim(p_client_id))) then
    return jsonb_build_object('ok',true,'ignored','submitted');
  end if;
  select count(*) into v_item_count from climate_vote.ballot_item bi where bi.ballot_id=v_ballot.id;
  insert into climate_vote.ballot_progress(ballot_id,client_id,voter_team,voter_name,voter_name_norm,answered,last_ordinal)
  values(v_ballot.id,trim(p_client_id),v_team,v_name,v_norm,array[p_ordinal],p_ordinal)
  on conflict (ballot_id,voter_team,voter_name_norm) do update
    set answered=(select coalesce(array_agg(distinct x order by x),'{}'::int[])
                    from unnest(climate_vote.ballot_progress.answered || excluded.answered) x),
        last_ordinal=excluded.last_ordinal,
        client_id=excluded.client_id,
        voter_name=excluded.voter_name,
        updated_at=now()
    -- 남용 방지: 문항 번호는 위에서 이 투표지 것만 통과하므로 집합 크기는 문항 수를 넘지 못한다. 넘쳐 있으면 더 쓰지 않는다.
    where cardinality(climate_vote.ballot_progress.answered) <= v_item_count;
  return jsonb_build_object('ok',true);
end $function$;
grant execute on function climate_vote.ballot_progress_named(text,text,text,text,int) to anon, authenticated;
revoke execute on function climate_vote.ballot_progress_named(text,text,text,text,int) from public;

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
           (array_agg(br.voter_name order by br.submitted_at, br.id))[1] as name
      from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.voter_name_norm is not null and br.voter_team is not null
     group by br.voter_team, br.voter_name_norm),
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
           (rs.norm is not null) as submitted, rs.submitted_at
      from people pe
      left join ros on ros.team=pe.team and ros.norm=pe.norm
      left join st  on st.team=pe.team and st.norm=pe.norm
      left join pg  on pg.team=pe.team and pg.norm=pe.norm
      left join rs  on rs.team=pe.team and rs.norm=pe.norm
      left join per_person pp on pp.team=pe.team and pp.norm=pe.norm)
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
        'submitted',v.submitted,'submitted_at',v.submitted_at)
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
