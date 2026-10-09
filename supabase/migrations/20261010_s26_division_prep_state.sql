-- s26 — 10/17 분과 의결 준비 상태를 서버에 둔다
--
-- WHY: 분과 오퍼레이터와 운영팀이 같은 준비 상태(PrepState)를 봐야 한다. 지금은 브라우저에만 있다.
-- WHAT: 분과별 현재 판 1줄(division_prep_state) + 저장할 때마다 쌓이는 이력(division_prep_revision).
--       읽기·쓰기는 아래 두 함수로만 한다. 클라이언트 계약 = src/lib/division-prep.ts (이름·인자·반환 1:1).
-- 범위: 조 토큰의 team.subgroup 으로 정한다.
--       '1분과'·'2분과'·'3분과' 조 = 자기 분과 한 줄만 읽고 쓴다.
--       분과 칸이 빈 조 = 운영팀. 세 분과를 모두 읽고 쓴다.
--       그 밖의 분과 값이면 거부한다. 세션은 언제나 토큰의 세션이다(클라이언트가 고르지 않는다).
-- 동시성: 저장은 판번호(p_expected_version)가 현재 판과 같을 때만 된다.
--       어긋나면 예외 대신 {"ok":false,"conflict":true,"current":...} 를 돌려주고 아무것도 쓰지 않는다.
-- 이력: division_prep_revision 은 추가만 된다(수정·삭제·비우기는 트리거가 막는다).
-- 적용 전: 운영에서 team_token_row(text)·attendance_token_row(text)·workshop_audit(...10개 인자) 정의를
--       pg_get_functiondef 로 떠서 이 파일이 가정한 시그니처와 같은지 확인한다.

create table if not exists climate_vote.division_prep_state (
  session_id uuid not null references climate_vote.session(id),
  subgroup text not null check (subgroup in ('1분과','2분과','3분과')),
  version int not null check (version >= 1),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by text,
  updated_team_id uuid references climate_vote.team(id),
  primary key (session_id, subgroup)
);

create table if not exists climate_vote.division_prep_revision (
  id bigserial primary key,
  session_id uuid not null references climate_vote.session(id),
  subgroup text not null check (subgroup in ('1분과','2분과','3분과')),
  version int not null check (version >= 1),
  state jsonb not null,
  created_at timestamptz not null default now(),
  created_by text,
  team_id uuid references climate_vote.team(id)
);
create index if not exists division_prep_revision_scope_idx
  on climate_vote.division_prep_revision(session_id, subgroup, version desc);

create or replace function climate_vote.division_prep_append_only_guard()
returns trigger
language plpgsql
set search_path = climate_vote, pg_temp as $fn$
begin
  raise exception 'division prep history is append-only';
end
$fn$;

revoke all on function climate_vote.division_prep_append_only_guard()
  from public, anon, authenticated;

drop trigger if exists division_prep_revision_append_only
  on climate_vote.division_prep_revision;
create trigger division_prep_revision_append_only
  before update or delete on climate_vote.division_prep_revision
  for each row execute function climate_vote.division_prep_append_only_guard();
drop trigger if exists division_prep_revision_no_truncate
  on climate_vote.division_prep_revision;
create trigger division_prep_revision_no_truncate
  before truncate on climate_vote.division_prep_revision
  for each statement execute function climate_vote.division_prep_append_only_guard();

alter table climate_vote.division_prep_state enable row level security;
alter table climate_vote.division_prep_revision enable row level security;
revoke all on table climate_vote.division_prep_state from public, anon, authenticated;
revoke all on table climate_vote.division_prep_revision from public, anon, authenticated;
revoke all on sequence climate_vote.division_prep_revision_id_seq from public, anon, authenticated;

-- 한 분과의 현재 줄(JSON). 저장 전이면 version 0·state null. 내부용(직접 호출 불가).
create or replace function climate_vote.division_prep_row_json(
  p_session_id uuid, p_subgroup text)
returns jsonb
language sql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
  select coalesce(
    (select jsonb_build_object(
        'subgroup', s.subgroup, 'version', s.version, 'state', s.state,
        'updated_at', s.updated_at, 'updated_by', s.updated_by)
       from climate_vote.division_prep_state s
      where s.session_id = p_session_id and s.subgroup = p_subgroup),
    jsonb_build_object(
      'subgroup', p_subgroup, 'version', 0, 'state', null,
      'updated_at', null, 'updated_by', null));
$fn$;

revoke all on function climate_vote.division_prep_row_json(uuid, text)
  from public, anon, authenticated;

create or replace function climate_vote.division_prep_get_v1(p_token text)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_team climate_vote.team;
  v_team_sub text;
  v_rows jsonb;
begin
  v_team := climate_vote.team_token_row(p_token);
  v_team_sub := btrim(coalesce(v_team.subgroup, ''));
  if v_team_sub = '' then
    select jsonb_agg(climate_vote.division_prep_row_json(v_team.session_id, g.sub) order by g.ord)
      into v_rows
      from unnest(array['1분과','2분과','3분과']) with ordinality as g(sub, ord);
    return jsonb_build_object(
      'scope', 'ops', 'team_subgroup', null, 'server_now', now(), 'rows', v_rows);
  end if;
  if v_team_sub not in ('1분과','2분과','3분과') then
    raise exception 'division prep scope unknown for team subgroup';
  end if;
  return jsonb_build_object(
    'scope', 'division', 'team_subgroup', v_team_sub, 'server_now', now(),
    'rows', jsonb_build_array(climate_vote.division_prep_row_json(v_team.session_id, v_team_sub)));
end
$fn$;

create or replace function climate_vote.division_prep_save_v1(
  p_token text, p_subgroup text, p_expected_version int, p_state jsonb, p_label text)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_team climate_vote.team;
  v_team_sub text;
  v_sub text := btrim(coalesce(p_subgroup, ''));
  v_label text := nullif(left(btrim(coalesce(p_label, '')), 80), '');
  v_row climate_vote.division_prep_state;
  v_current int;
  v_version int;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  v_team := climate_vote.team_token_row(p_token);
  v_team_sub := btrim(coalesce(v_team.subgroup, ''));
  if v_team_sub <> '' and v_team_sub not in ('1분과','2분과','3분과') then
    raise exception 'division prep scope unknown for team subgroup';
  end if;
  if v_sub not in ('1분과','2분과','3분과') then
    raise exception 'invalid division';
  end if;
  if v_team_sub <> '' and v_team_sub <> v_sub then
    raise exception 'division mismatch';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'expected version required';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'division prep state must be a json object';
  end if;
  if octet_length(p_state::text) > 524288 then
    raise exception 'division prep state too large';
  end if;

  -- 첫 저장(줄이 아직 없을 때)까지 직렬화한다. 이후에는 행 잠금도 함께 건다.
  perform pg_advisory_xact_lock(
    hashtextextended('division-prep:' || v_team.session_id::text || ':' || v_sub, 0));
  select * into v_row from climate_vote.division_prep_state
   where session_id = v_team.session_id and subgroup = v_sub
   for update;
  v_current := case when found then v_row.version else 0 end;

  if v_current <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'conflict', true,
      'current', climate_vote.division_prep_row_json(v_team.session_id, v_sub));
  end if;

  v_version := v_current + 1;
  insert into climate_vote.division_prep_state as s
    (session_id, subgroup, version, state, updated_at, updated_by, updated_team_id)
  values (v_team.session_id, v_sub, v_version, p_state, now(), v_label, v_team.id)
  on conflict (session_id, subgroup) do update
    set version = excluded.version, state = excluded.state,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by,
        updated_team_id = excluded.updated_team_id
  returning * into v_row;

  insert into climate_vote.division_prep_revision
    (session_id, subgroup, version, state, created_at, created_by, team_id)
  values (v_team.session_id, v_sub, v_version, p_state, v_row.updated_at, v_label, v_team.id);

  perform climate_vote.workshop_audit(v_team.org_id, v_team.session_id, v_team.id,
    v_auth.id, null, 'division_prep_save', 'team', v_auth.actor_label,
    jsonb_build_object('subgroup', v_sub, 'version', v_current),
    jsonb_build_object('subgroup', v_sub, 'version', v_version));

  return jsonb_build_object('ok', true, 'version', v_version, 'updated_at', v_row.updated_at);
end
$fn$;

revoke execute on function climate_vote.division_prep_get_v1(text) from public;
revoke execute on function climate_vote.division_prep_save_v1(text, text, int, jsonb, text) from public;
grant execute on function climate_vote.division_prep_get_v1(text) to anon, authenticated;
grant execute on function climate_vote.division_prep_save_v1(text, text, int, jsonb, text) to anon, authenticated;
