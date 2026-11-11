-- s33 (11/11 피알원·상규 대표님 요청) — 「투표 시작」 기록.
-- 이름 확인 화면에서 「네, 맞습니다 · 투표 시작」을 누르면 한 줄 남긴다. 찬성·반대는 보내지 않는다(제출 전 답은 기기에만).
-- 같은 기기는 한 줄(다시 열면 이름만 갱신). 운영 화면은 누가 시작했는지, 표출 화면은 수만 본다.

create table if not exists climate_vote.ballot_start (
  id bigint generated always as identity primary key,
  ballot_id uuid not null references climate_vote.ballot(id),
  org_id uuid not null,
  client_id text not null,
  voter_team text not null,
  voter_name text not null,
  voter_name_norm text not null,
  voter_in_roster boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ballot_id, client_id)
);
create index if not exists ballot_start_ballot_idx on climate_vote.ballot_start (ballot_id);
alter table climate_vote.ballot_start enable row level security;
revoke all on climate_vote.ballot_start from public, anon, authenticated;

-- 참가자(투표 링크 토큰) — 시작 기록. 실패해도 투표는 막지 않는다(화면이 오류를 삼킨다).
create or replace function climate_vote.ballot_start_named(p_token text, p_client_id text, p_voter_team text, p_voter_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'climate_vote', 'extensions', 'pg_temp'
as $function$
declare v_ballot climate_vote.ballot;
  v_team text := btrim(coalesce(p_voter_team,''));
  v_name text := btrim(regexp_replace(coalesce(p_voter_name,''), '[[:space:] 　]+', ' ', 'g'));
  v_norm text := climate_vote.voter_name_norm(p_voter_name);
  v_in_roster boolean;
begin
  if p_token is null or length(p_token)<>32 then raise exception 'ballot token required'; end if;
  if p_client_id is null or length(trim(p_client_id)) not between 8 and 80 then raise exception 'ballot client id required'; end if;
  if v_norm='' or length(v_name)>80 or v_team='' or length(v_team)>60 then raise exception 'voter name required'; end if;
  select b.* into v_ballot
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
      and s.access_expires_at is not null and s.access_expires_at>now()
   where b.token=p_token and b.status='open' and b.archived_at is null;
  if not found then raise exception 'ballot not open or event unavailable'; end if;
  v_in_roster := exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_team and r.name_norm=v_norm);
  insert into climate_vote.ballot_start(ballot_id,org_id,client_id,voter_team,voter_name,voter_name_norm,voter_in_roster)
  values(v_ballot.id,v_ballot.org_id,trim(p_client_id),v_team,v_name,v_norm,v_in_roster)
  on conflict (ballot_id,client_id) do update
    set voter_team=excluded.voter_team, voter_name=excluded.voter_name,
        voter_name_norm=excluded.voter_name_norm, voter_in_roster=excluded.voter_in_roster,
        updated_at=now();
  return jsonb_build_object('ok',true);
end $function$;
grant execute on function climate_vote.ballot_start_named(text,text,text,text) to anon, authenticated;
revoke execute on function climate_vote.ballot_start_named(text,text,text,text) from public;

-- 표출 화면(투표 링크 토큰) — 수만. 이름은 내보내지 않는다.
-- started = 시작한 사람(이름 기준), submitted = 제출, in_progress = 시작했으나 아직 제출 안 함, roster = 명단 인원.
create or replace function climate_vote.ballot_live_counts(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'climate_vote', 'extensions', 'pg_temp'
as $function$
declare v_ballot climate_vote.ballot; v_started int; v_submitted int; v_progress int; v_roster int;
begin
  if p_token is null or length(p_token)<>32 then raise exception 'ballot token required'; end if;
  select b.* into v_ballot from climate_vote.ballot b where b.token=p_token and b.archived_at is null;
  if not found then raise exception 'ballot not found'; end if;
  select count(*) into v_submitted from climate_vote.ballot_response br where br.ballot_id=v_ballot.id;
  select count(distinct (s.voter_team, s.voter_name_norm)) into v_started
    from climate_vote.ballot_start s where s.ballot_id=v_ballot.id;
  select count(distinct (s.voter_team, s.voter_name_norm)) into v_progress
    from climate_vote.ballot_start s
   where s.ballot_id=v_ballot.id
     and not exists(select 1 from climate_vote.ballot_response br
        where br.ballot_id=v_ballot.id and (br.client_id=s.client_id or br.voter_name_norm=s.voter_name_norm));
  select count(*) into v_roster from climate_vote.ballot_roster r
   where r.session_id=v_ballot.session_id
     and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup));
  return jsonb_build_object('status',v_ballot.status,'title',v_ballot.title,
    'items',(select count(*) from climate_vote.ballot_item bi where bi.ballot_id=v_ballot.id),
    'started',greatest(v_started,v_submitted),'submitted',v_submitted,'in_progress',v_progress,'roster',v_roster,
    'at',now());
end $function$;
grant execute on function climate_vote.ballot_live_counts(text) to anon, authenticated;
revoke execute on function climate_vote.ballot_live_counts(text) from public;

-- 운영(대조 화면) — 누가 시작했는지. 기존 ballot_named_responses_v2 에 starts 를 더한다(나머지 그대로).
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
      from climate_vote.ballot_response br where br.ballot_id=v_ballot.id),
    'starts',(select coalesce(jsonb_agg(jsonb_build_object(
        'voter_team',s.voter_team,'voter_name',s.voter_name,
        'voter_in_roster',s.voter_in_roster,'started_at',s.started_at)
        order by s.started_at, s.id),'[]'::jsonb)
      from climate_vote.ballot_start s where s.ballot_id=v_ballot.id));
end $function$;
