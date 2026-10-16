-- s28 (2026-10-17): 실명 투표 — 출석 명단(조·이름)으로 투표자를 남긴다.
-- WHY: 10/16 회의 결정(08_실명투표_개선계획.md 안 A). 회의체 의결은 찬반 기록이 이름과 함께 남아야 한다.
-- WHAT (추가만 한다 — 기존 표·함수·시그니처는 그대로):
--   1) climate_vote.voter_name_norm(text)       이름 대조 키(공백 제거 + 소문자). TS 의 normalizeVoterName 과 같아야 한다.
--   2) climate_vote.ballot_roster               세션별 명단(분과·조·번호·이름). 저장소에는 명단을 두지 않는다(공개 repo).
--   3) ballot_response 에 voter_team / voter_name / voter_name_norm / voter_in_roster (전부 nullable)
--   4) ballot_roster_get(p_token)               투표 토큰으로 그 투표 범위의 명단(조·이름)만 읽는다(/b 화면).
--   5) ballot_submit_named(...)                 ballot_submit 과 같은 검사 + 조·이름. 같은 이름 두 번은 거부.
--   6) ballot_named_responses_v2(p_token, id)   운영 콘솔: 투표 하나의 실명 응답·명단·문항(대조·결과 보기·CSV).
--   7) ballot_voter_correct_v2(...)             운영 콘솔: 조·이름만 정정(찬반은 못 건드림) + workshop_audit 기록.
--   8) 세션별 스위치 2개 — session.config.named_vote = {collect, show_names}, 둘 다 기본 켜짐(10/17 08:05 결정: 실명).
--      collect=false 면 ballot_roster_get 이 빈 명단을 돌려 /b 는 지금과 똑같은 무기명이고, ballot_submit_named 는 거부한다.
--      show_names=false 면 ballot_named_responses_v2 가 이름 없이(수만) 돌려준다 → 큰 화면 「투표결과 보기」에 이름이 안 나온다.
--      운영 콘솔이 ballot_named_settings_set_v2 로 켜고 끈다(재배포 없이). 명단이 없는 세션은 켜져 있어도 무기명이다.
-- 범위 규칙: 명단 행은 r.session_id = b.session_id 이고, 투표의 subgroup 이 비었으면 세션 전체, 있으면 그 분과만.
-- 명단이 없는 세션은 지금과 똑같이 무기명이다(화면이 옛 ballot_submit 을 부른다).
-- 되돌리기: supabase/rollbacks/20261017_s28_named_ballot_BEFORE.sql

create or replace function climate_vote.voter_name_norm(p_name text)
returns text
language sql
immutable
set search_path = climate_vote, pg_temp
as $$
  select lower(regexp_replace(coalesce(p_name, ''), '[[:space:] 　]+', '', 'g'))
$$;
revoke execute on function climate_vote.voter_name_norm(text) from public, anon, authenticated;

create table if not exists climate_vote.ballot_roster (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  subgroup text not null check (length(btrim(subgroup)) between 1 and 40),
  team_label text not null check (length(btrim(team_label)) between 1 and 60),
  no int,
  name text not null check (length(btrim(name)) between 1 and 80),
  name_norm text generated always as (climate_vote.voter_name_norm(name)) stored,
  created_at timestamptz not null default now(),
  unique (session_id, team_label, name_norm)
);
create index if not exists ballot_roster_scope_idx
  on climate_vote.ballot_roster (session_id, subgroup);
alter table climate_vote.ballot_roster enable row level security;
revoke all on climate_vote.ballot_roster from public, anon, authenticated;

alter table climate_vote.ballot_response
  add column if not exists voter_team text,
  add column if not exists voter_name text,
  add column if not exists voter_name_norm text,
  add column if not exists voter_in_roster boolean;
create index if not exists ballot_response_voter_name_idx
  on climate_vote.ballot_response (ballot_id, voter_name_norm)
  where voter_name_norm is not null;

-- ── 8) 세션 스위치 읽기(내부용) ─────────────────────────────────────────
create or replace function climate_vote.session_named_vote(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = climate_vote, pg_temp
as $$
  select jsonb_build_object(
    'collect', coalesce((s.config->'named_vote'->>'collect')::boolean, true),
    'show_names', coalesce((s.config->'named_vote'->>'show_names')::boolean, true))
    from climate_vote.session s where s.id = p_session_id
$$;
revoke execute on function climate_vote.session_named_vote(uuid) from public, anon, authenticated;

-- ── 4) /b 화면: 투표 범위의 명단 ─────────────────────────────────────────
create or replace function climate_vote.ballot_roster_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_ballot climate_vote.ballot; v_rows jsonb;
begin
  if p_token is null or length(p_token)<>32 then return null; end if;
  select * into v_ballot from climate_vote.ballot
   where token = p_token and status in ('open','closed','published') and archived_at is null;
  if not found then return null; end if;
  -- 실명 수집이 꺼져 있으면 빈 명단 = /b 는 지금과 같은 무기명.
  if not coalesce((climate_vote.session_named_vote(v_ballot.session_id)->>'collect')::boolean, true) then
    return jsonb_build_object('ballot_id', v_ballot.id, 'subgroup', v_ballot.subgroup, 'roster', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'team', r.team_label, 'no', r.no, 'name', r.name)
           order by r.team_label, r.no nulls last, r.name), '[]'::jsonb)
    into v_rows
    from climate_vote.ballot_roster r
   where r.session_id = v_ballot.session_id
     and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup = btrim(v_ballot.subgroup));
  return jsonb_build_object('ballot_id', v_ballot.id, 'subgroup', v_ballot.subgroup, 'roster', v_rows);
end $function$;
grant execute on function climate_vote.ballot_roster_get(text) to anon, authenticated;
revoke execute on function climate_vote.ballot_roster_get(text) from public;

-- ── 5) 실명 제출 — ballot_submit(운영 정의 10/17 pg_get_functiondef) 검사를 그대로 두고 조·이름을 더한다 ──
create or replace function climate_vote.ballot_submit_named(
  p_token text, p_client_id text, p_answers jsonb, p_voter_team text, p_voter_name text)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_ballot climate_vote.ballot; v_item record; v_value_text text; v_val int;
  v_team text := btrim(coalesce(p_voter_team,''));
  v_name text := btrim(regexp_replace(coalesce(p_voter_name,''), '[[:space:] 　]+', ' ', 'g'));
  v_norm text := climate_vote.voter_name_norm(p_voter_name);
  v_in_roster boolean;
begin
  if p_token is null or length(p_token)<>32 then
    raise exception 'ballot token required';
  end if;
  if p_client_id is null or length(trim(p_client_id)) not between 8 and 80 then
    raise exception 'ballot client id required';
  end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' then
    raise exception 'answers must be object';
  end if;

  select b.* into v_ballot
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
      and s.access_expires_at is not null and s.access_expires_at>now()
    join climate_vote.assembly a on a.id=s.assembly_id
      and a.org_id=s.org_id and a.status='active' and a.archived_at is null
    join climate_vote.org o on o.id=s.org_id
      and o.status='active' and o.archived_at is null
   where b.token=p_token and b.status='open' and b.archived_at is null
   for update of b;
  if not found then raise exception 'ballot not open or event unavailable'; end if;

  if exists(
    select 1 from jsonb_object_keys(p_answers) supplied(key)
    where not exists(select 1 from climate_vote.ballot_item bi
      where bi.ballot_id=v_ballot.id and bi.id::text=supplied.key)
  ) then
    raise exception 'answers contain unknown ballot item';
  end if;
  for v_item in
    select id,scale,required from climate_vote.ballot_item
     where ballot_id=v_ballot.id order by ordinal
  loop
    if not (p_answers ? v_item.id::text) then
      if v_item.required then raise exception 'missing answer for item %',v_item.id; end if;
      continue;
    end if;
    if jsonb_typeof(p_answers->(v_item.id::text))<>'number' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_value_text:=p_answers->>(v_item.id::text);
    if v_value_text!~'^[0-9]+$' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_val:=v_value_text::int;
    if v_val<1 or v_val>v_item.scale then
      raise exception 'answer out of scale for item %',v_item.id;
    end if;
  end loop;

  -- 실명 검사. 투표 행 잠금(for update of b) 아래라 같은 투표의 제출은 한 줄로 선다 — 이름 중복 검사에 경합이 없다.
  if not coalesce((climate_vote.session_named_vote(v_ballot.session_id)->>'collect')::boolean, true) then
    raise exception 'named voting off';
  end if;
  if not exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))) then
    raise exception 'ballot roster not configured';
  end if;
  if not exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_team) then
    raise exception 'voter team not in roster';
  end if;
  if v_norm='' or length(v_name)>80 then
    raise exception 'voter name required';
  end if;
  -- 같은 기기의 재전송은 이름 중복보다 먼저 「이미 제출」로 알린다.
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.client_id=trim(p_client_id)) then
    raise exception 'already submitted';
  end if;
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.voter_name_norm=v_norm) then
    raise exception 'name already submitted';
  end if;
  v_in_roster := exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_team and r.name_norm=v_norm);

  insert into climate_vote.ballot_response(ballot_id,client_id,answers,org_id,
    voter_team,voter_name,voter_name_norm,voter_in_roster)
  values(v_ballot.id,trim(p_client_id),p_answers,v_ballot.org_id,
    v_team,v_name,v_norm,v_in_roster);
  return jsonb_build_object('ok',true,'voter_team',v_team,'voter_name',v_name,'in_roster',v_in_roster);
exception when unique_violation then
  raise exception 'already submitted';
end $function$;
grant execute on function climate_vote.ballot_submit_named(text,text,jsonb,text,text) to anon, authenticated;
revoke execute on function climate_vote.ballot_submit_named(text,text,jsonb,text,text) from public;

-- ── 6) 운영 콘솔: 투표 하나의 실명 응답 (인증·범위 = ballot_set_status_v2 와 같다) ──
create or replace function climate_vote.ballot_named_responses_v2(p_token text, p_ballot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot;
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
  return jsonb_build_object(
    'id',v_ballot.id,'title',v_ballot.title,'status',v_ballot.status,
    'subgroup',v_ballot.subgroup,
    'settings',climate_vote.session_named_vote(v_ballot.session_id),
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',bi.id,'ordinal',bi.ordinal,'statement',bi.statement,'scale',bi.scale)
        order by bi.ordinal),'[]'::jsonb)
      from climate_vote.ballot_item bi where bi.ballot_id=v_ballot.id),
    'roster',(select coalesce(jsonb_agg(jsonb_build_object(
        'team',r.team_label,'no',r.no,'name',r.name)
        order by r.team_label, r.no nulls last, r.name),'[]'::jsonb)
      from climate_vote.ballot_roster r
      where r.session_id=v_ballot.session_id
        and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))),
    'responses',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',br.id,'voter_team',br.voter_team,'voter_name',br.voter_name,
        'voter_in_roster',br.voter_in_roster,'answers',br.answers,
        'submitted_at',br.submitted_at)
        order by br.submitted_at, br.id),'[]'::jsonb)
      from climate_vote.ballot_response br where br.ballot_id=v_ballot.id));
end $function$;
grant execute on function climate_vote.ballot_named_responses_v2(text,uuid) to anon, authenticated;
revoke execute on function climate_vote.ballot_named_responses_v2(text,uuid) from public;

-- ── 7) 운영 콘솔: 조·이름만 정정 (찬반 answers 는 이 함수가 건드릴 수 없다) ──
create or replace function climate_vote.ballot_voter_correct_v2(
  p_token text, p_ballot_id uuid, p_response_id uuid, p_voter_team text, p_voter_name text)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot; v_resp climate_vote.ballot_response;
  v_new_team text := btrim(coalesce(p_voter_team,''));
  v_name text := btrim(regexp_replace(coalesce(p_voter_name,''), '[[:space:] 　]+', ' ', 'g'));
  v_norm text := climate_vote.voter_name_norm(p_voter_name);
  v_in_roster boolean;
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
  select * into v_resp from climate_vote.ballot_response
   where id=p_response_id and ballot_id=v_ballot.id for update;
  if not found then raise exception 'response not found'; end if;
  if not exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_new_team) then
    raise exception 'voter team not in roster';
  end if;
  if v_norm='' or length(v_name)>80 then raise exception 'voter name required'; end if;
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.voter_name_norm=v_norm and br.id<>v_resp.id) then
    raise exception 'name already submitted';
  end if;
  v_in_roster := exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_new_team and r.name_norm=v_norm);
  update climate_vote.ballot_response
     set voter_team=v_new_team, voter_name=v_name, voter_name_norm=v_norm, voter_in_roster=v_in_roster
   where id=v_resp.id;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'ballot_voter_correct','team',v_auth.actor_label,
    jsonb_build_object('ballot_id',v_ballot.id,'response_id',v_resp.id,
      'voter_team',v_resp.voter_team,'voter_name',v_resp.voter_name,'voter_in_roster',v_resp.voter_in_roster),
    jsonb_build_object('ballot_id',v_ballot.id,'response_id',v_resp.id,
      'voter_team',v_new_team,'voter_name',v_name,'voter_in_roster',v_in_roster));
  return jsonb_build_object('id',v_resp.id,'voter_team',v_new_team,'voter_name',v_name,'voter_in_roster',v_in_roster);
end $function$;
grant execute on function climate_vote.ballot_voter_correct_v2(text,uuid,uuid,text,text) to anon, authenticated;
revoke execute on function climate_vote.ballot_voter_correct_v2(text,uuid,uuid,text,text) from public;

-- ── 8) 세션 스위치 켜고 끄기 (인증 = 같은 세션의 조 토큰, 운영 콘솔) ─────────────
create or replace function climate_vote.ballot_named_settings_set_v2(p_token text, p_collect boolean, p_show_names boolean)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_before jsonb; v_after jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  perform 1 from climate_vote.session s where s.id=v_team.session_id for update;
  v_before:=climate_vote.session_named_vote(v_team.session_id);
  v_after:=jsonb_build_object(
    'collect', coalesce(p_collect, (v_before->>'collect')::boolean),
    'show_names', coalesce(p_show_names, (v_before->>'show_names')::boolean));
  if v_after = v_before then return v_after; end if;
  update climate_vote.session
     set config = coalesce(config,'{}'::jsonb) || jsonb_build_object('named_vote', v_after)
   where id=v_team.session_id;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'named_vote_settings','team',v_auth.actor_label,v_before,v_after);
  return v_after;
end $function$;
grant execute on function climate_vote.ballot_named_settings_set_v2(text,boolean,boolean) to anon, authenticated;
revoke execute on function climate_vote.ballot_named_settings_set_v2(text,boolean,boolean) from public;

-- 읽기 — 운영 콘솔이 스위치 상태를 보인다(p_collect·p_show_names 를 null 로 주면 바꾸지 않고 읽기만 해도 되지만, 감사 기록 없이 읽도록 따로 둔다).
create or replace function climate_vote.ballot_named_settings_v2(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_team climate_vote.team;
begin
  v_team:=climate_vote.team_token_row(p_token);
  return climate_vote.session_named_vote(v_team.session_id)
    || jsonb_build_object('roster_count',
         (select count(*) from climate_vote.ballot_roster r where r.session_id=v_team.session_id
            and (nullif(btrim(v_team.subgroup),'') is null or r.subgroup=btrim(v_team.subgroup))));
end $function$;
grant execute on function climate_vote.ballot_named_settings_v2(text) to anon, authenticated;
revoke execute on function climate_vote.ballot_named_settings_v2(text) from public;
