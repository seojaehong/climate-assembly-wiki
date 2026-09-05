-- platform P1a: 9/12-13 workshop capability exchange, OCC writes, and scoped HQ controls
-- ORDER: P1 -> reviewed 0912 seed/s20 -> this P1a -> P2 -> P1b/P1c -> P2a -> P3 -> P4
-- SAFETY: additive schema plus new versioned RPCs. Legacy join-code RPCs remain available
-- during the client transition. Apply only through the reviewed migration workflow.

begin;

-- ---------------------------------------------------------------------------
-- 1. Event-bound authorization and optimistic concurrency metadata
-- ---------------------------------------------------------------------------

alter table climate_vote.session
  add column if not exists access_expires_at timestamptz;

-- Rounds created by the legacy Canvas had no relational event scope. Keep the
-- columns nullable for old installations and bind every team round through its
-- team. Existing unbound public rounds remain readable as explicit legacy
-- capabilities; only the new staff RPC may create session-bound Canvas rows.
alter table climate_vote.rounds
  add column if not exists session_id uuid references climate_vote.session(id),
  add column if not exists org_id uuid references climate_vote.org(id);
create index if not exists rounds_session_scope_idx
  on climate_vote.rounds(org_id,session_id,created_at desc);

update climate_vote.rounds r
   set session_id=t.session_id,org_id=t.org_id
  from climate_vote.team t
 where r.team_id=t.id
   and (r.session_id is null or r.org_id is null);

create or replace function climate_vote.round_scope_binding_guard()
returns trigger language plpgsql
set search_path = climate_vote, pg_temp as $fn$
declare v_session_id uuid; v_org_id uuid;
begin
  if new.team_id is not null then
    select t.session_id,t.org_id into v_session_id,v_org_id
      from climate_vote.team t where t.id=new.team_id;
    if not found or v_session_id is null or v_org_id is null then
      raise exception 'round team scope is not provisioned';
    end if;
    if new.session_id is not null and new.session_id<>v_session_id then
      raise exception 'round team/session scope mismatch';
    end if;
    if new.org_id is not null and new.org_id<>v_org_id then
      raise exception 'round team/org scope mismatch';
    end if;
    new.session_id:=v_session_id;
    new.org_id:=v_org_id;
  elsif new.session_id is not null then
    select s.id,s.org_id into v_session_id,v_org_id
      from climate_vote.session s
      join climate_vote.assembly a on a.id=s.assembly_id and a.org_id=s.org_id
     where s.id=new.session_id;
    if not found or v_org_id is null then
      raise exception 'round session scope is not provisioned';
    end if;
    if new.org_id is not null and new.org_id<>v_org_id then
      raise exception 'round session/org scope mismatch';
    end if;
    new.org_id:=v_org_id;
  elsif new.org_id is not null then
    raise exception 'round organization requires a session binding';
  end if;
  return new;
end $fn$;

drop trigger if exists round_scope_binding_guard on climate_vote.rounds;
create trigger round_scope_binding_guard
  before insert or update of team_id,session_id,org_id on climate_vote.rounds
  for each row execute function climate_vote.round_scope_binding_guard();

-- A partial unique index is the final guard against two moderator devices
-- opening different active rounds for the same team. Refuse the migration
-- rather than silently choosing a winner when legacy data already violates it.
do $active_round_invariant$
begin
  if exists(
    select 1 from climate_vote.rounds r
     where r.team_id is not null and r.status='active'
     group by r.team_id having count(*)>1
  ) then
    raise exception 'P1a preflight failed: multiple active moderator rounds exist for one team';
  end if;
end $active_round_invariant$;
create unique index if not exists rounds_one_active_per_team_uidx
  on climate_vote.rounds(team_id)
  where team_id is not null and status='active';

alter table climate_vote.attendance_auth_session
  add column if not exists id uuid not null default extensions.gen_random_uuid(),
  add column if not exists session_id uuid references climate_vote.session(id),
  add column if not exists device_id uuid,
  add column if not exists device_label text,
  add column if not exists purpose text,
  add column if not exists revoked_at timestamptz,
  add column if not exists last_seen_at timestamptz;

update climate_vote.attendance_auth_session
   set purpose=case when scope='hq' then 'hq' else 'attendance' end
 where purpose is null;
alter table climate_vote.attendance_auth_session
  alter column purpose set default 'attendance',
  alter column purpose set not null;
do $ddl$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='climate_vote.attendance_auth_session'::regclass
      and conname='attendance_auth_session_purpose_check') then
    alter table climate_vote.attendance_auth_session add constraint
      attendance_auth_session_purpose_check
      check (purpose in ('attendance','workshop','hq'));
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='climate_vote.attendance_auth_session'::regclass
      and conname='attendance_auth_session_scope_purpose_check') then
    alter table climate_vote.attendance_auth_session add constraint
      attendance_auth_session_scope_purpose_check
      check ((scope='hq' and purpose='hq')
          or (scope='team' and purpose in ('attendance','workshop')));
  end if;
end $ddl$;

create unique index if not exists attendance_auth_session_id_uidx
  on climate_vote.attendance_auth_session(id);
create index if not exists attendance_auth_session_context_idx
  on climate_vote.attendance_auth_session(org_id, session_id, team_id, expires_at);
create unique index if not exists attendance_auth_session_live_device_uidx
  on climate_vote.attendance_auth_session(team_id, session_id, device_id)
  where scope = 'team' and purpose='workshop'
    and device_id is not null and revoked_at is null;

-- Named HQ bootstrap failures are throttled by a one-way request-source
-- bucket instead of by the public operator name. A constant bucket is used
-- when the trusted edge did not provide forwarding metadata, so bcrypt work
-- remains bounded without retaining a raw network address.
alter table climate_vote.attendance_auth_attempt
  add column if not exists source_hash text;
do $ddl$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='climate_vote.attendance_auth_attempt'::regclass
      and conname='attendance_auth_attempt_source_hash_check') then
    alter table climate_vote.attendance_auth_attempt add constraint
      attendance_auth_attempt_source_hash_check
      check (source_hash is null or length(source_hash)=64);
  end if;
end $ddl$;
create index if not exists attendance_auth_attempt_source_idx
  on climate_vote.attendance_auth_attempt(scope,source_hash,attempted_at desc)
  where source_hash is not null and not succeeded;

alter table climate_vote.submission
  add column if not exists version bigint not null default 0,
  add column if not exists last_saved_by text;

-- Historical category/kind events used only the ordinal. An ordinal can be
-- deleted and reused for a different sentence, so new events also bind to the
-- exact source item identity. There is deliberately no FK: replacing a source
-- item must never be blocked by an annotation event.
alter table climate_vote.submission_category_event
  add column if not exists source_item_id uuid;
alter table climate_vote.submission_kind_event
  add column if not exists source_item_id uuid;
create index if not exists submission_category_event_source_idx
  on climate_vote.submission_category_event(
    submission_id,item_ordinal,source_item_id,id desc);
create index if not exists submission_kind_event_source_idx
  on climate_vote.submission_kind_event(
    submission_id,item_ordinal,source_item_id,id desc);

do $ddl$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'climate_vote.submission'::regclass
      and conname = 'submission_version_nonnegative'
  ) then
    alter table climate_vote.submission
      add constraint submission_version_nonnegative check (version >= 0);
  end if;
end $ddl$;

-- The configured event wins over the fallback TTL. Preserve an operator override.
update climate_vote.session
   set access_expires_at = '2026-09-13 22:00:00 Asia/Seoul'::timestamptz
 where slug = '0912-deliberation'
   and access_expires_at is null;

comment on column climate_vote.session.access_expires_at is
  'Required hard expiry for workshop capability tokens. NULL fails closed.';
comment on column climate_vote.submission.version is
  'Monotonic generation used by token RPC optimistic concurrency checks.';

-- ---------------------------------------------------------------------------
-- 2. Private request ledger and append-only workshop audit
-- ---------------------------------------------------------------------------

create table if not exists climate_vote.workshop_request_ledger (
  idempotency_key uuid primary key,
  operation text not null check (length(operation) between 1 and 80),
  request_hash text not null check (length(request_hash) = 64),
  org_id uuid not null references climate_vote.org(id),
  session_id uuid not null references climate_vote.session(id),
  team_id uuid references climate_vote.team(id),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists workshop_request_ledger_context_idx
  on climate_vote.workshop_request_ledger(org_id, session_id, team_id, created_at desc);

create table if not exists climate_vote.workshop_audit_event (
  id bigint generated always as identity primary key,
  org_id uuid not null references climate_vote.org(id),
  session_id uuid not null references climate_vote.session(id),
  team_id uuid references climate_vote.team(id),
  auth_session_id uuid references climate_vote.attendance_auth_session(id),
  request_id uuid,
  action text not null check (length(action) between 1 and 100),
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_label text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists workshop_audit_event_context_idx
  on climate_vote.workshop_audit_event(org_id, session_id, created_at desc);

create table if not exists climate_vote.platform_canvas_round_event (
  id bigint generated always as identity primary key,
  org_id uuid not null references climate_vote.org(id),
  session_id uuid not null references climate_vote.session(id),
  round_id text not null references climate_vote.rounds(id),
  action text not null check (action in ('created','status_changed')),
  before_status text,
  after_status text not null,
  actor_user_id uuid not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(request_id,action)
);
create index if not exists platform_canvas_round_event_context_idx
  on climate_vote.platform_canvas_round_event(org_id,session_id,round_id,created_at desc);

-- Join failures can occur before an org/session is known, so keep them out of
-- attendance_auth_attempt (P1b makes its org_id non-null). Only hashes and
-- opaque device ids are retained; raw IP addresses and join codes are not.
create table if not exists climate_vote.workshop_join_exchange_attempt (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  source_hash text check (source_hash is null or length(source_hash)=64),
  succeeded boolean not null,
  org_id uuid references climate_vote.org(id),
  session_id uuid references climate_vote.session(id),
  team_id uuid references climate_vote.team(id),
  attempted_at timestamptz not null default now()
);
create index if not exists workshop_join_attempt_device_idx
  on climate_vote.workshop_join_exchange_attempt(device_id,attempted_at desc)
  where not succeeded;
create index if not exists workshop_join_attempt_source_idx
  on climate_vote.workshop_join_exchange_attempt(source_hash,attempted_at desc)
  where source_hash is not null and not succeeded;

-- Staff-entered implementation updates are themselves the immutable audit
-- trail. P1a sorts before the P2 result_page table, so result_id/issue_id are
-- deliberately validated by the SECURITY DEFINER RPC instead of early FKs.
create table if not exists climate_vote.result_implementation_event (
  id bigint generated always as identity primary key,
  org_id uuid not null references climate_vote.org(id),
  session_id uuid not null references climate_vote.session(id),
  result_id uuid not null,
  result_token_hash text not null check (length(result_token_hash)=64),
  issue_id uuid not null,
  actor_user_id uuid not null,
  status text not null check (status in
    ('under_review','planned','in_progress','implemented','not_pursued')),
  responsible_body text not null check (length(trim(responsible_body)) between 1 and 200),
  effective_at timestamptz not null,
  summary text not null check (length(trim(summary)) between 1 and 1000),
  evidence_url text check (evidence_url is null or length(evidence_url)<=2000),
  created_at timestamptz not null default now()
);
create index if not exists result_implementation_event_result_idx
  on climate_vote.result_implementation_event(result_id,issue_id,created_at desc,id desc);
create index if not exists result_implementation_event_context_idx
  on climate_vote.result_implementation_event(org_id,session_id,created_at desc);

alter table climate_vote.workshop_request_ledger enable row level security;
alter table climate_vote.workshop_audit_event enable row level security;
alter table climate_vote.platform_canvas_round_event enable row level security;
alter table climate_vote.workshop_join_exchange_attempt enable row level security;
alter table climate_vote.result_implementation_event enable row level security;
revoke all on climate_vote.workshop_request_ledger,
  climate_vote.workshop_audit_event,
  climate_vote.platform_canvas_round_event,
  climate_vote.workshop_join_exchange_attempt,
  climate_vote.result_implementation_event from public, anon, authenticated;
revoke all on sequence climate_vote.workshop_audit_event_id_seq from public, anon, authenticated;
revoke all on sequence climate_vote.platform_canvas_round_event_id_seq
  from public, anon, authenticated;
revoke all on sequence climate_vote.workshop_join_exchange_attempt_id_seq
  from public, anon, authenticated;
revoke all on sequence climate_vote.result_implementation_event_id_seq
  from public, anon, authenticated;

create or replace function climate_vote.workshop_audit_append_only_guard()
returns trigger language plpgsql
set search_path = climate_vote, pg_temp as $fn$
begin
  raise exception 'workshop audit is append-only';
end $fn$;

create or replace function climate_vote.result_implementation_append_only_guard()
returns trigger language plpgsql
set search_path = climate_vote, pg_temp as $fn$
begin
  raise exception 'result implementation history is append-only';
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. Token versions of moderator round/timer and ballot operations
-- ---------------------------------------------------------------------------

create or replace function climate_vote.mod_create_round_v2(
  p_token text, p_title text, p_type text, p_options jsonb)
returns climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_row climate_vote.rounds;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if length(trim(coalesce(p_title,'')))=0 then raise exception 'round title required'; end if;
  if p_type is null or p_type not in ('RADIO','CHECKBOX','SCALE') then
    raise exception 'invalid round type';
  end if;
  if p_options is null then raise exception 'round options required'; end if;
  insert into climate_vote.rounds(
    id,title,type,options,sort_order,status,team_id,session_id,org_id,created_by)
  values('m-'||replace(gen_random_uuid()::text,'-',''),
    trim(p_title),p_type,p_options,0,'active',v_team.id,v_team.session_id,
    v_team.org_id,'mod:'||v_team.name)
  returning * into v_row;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'round_created','team',v_auth.actor_label,null,
    jsonb_build_object('round_id',v_row.id,'type',p_type));
  return v_row;
end $fn$;

create or replace function climate_vote.mod_create_round_v3(
  p_token text, p_title text, p_type text, p_options jsonb,
  p_idempotency_key uuid)
returns climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_row climate_vote.rounds; v_hash text; v_prior jsonb; v_options jsonb;
  v_constraint text;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if length(trim(coalesce(p_title,'')))=0 then raise exception 'round title required'; end if;
  if p_type is null or p_type not in ('RADIO','CHECKBOX','SCALE') then
    raise exception 'invalid round type';
  end if;
  if p_options is null or jsonb_typeof(p_options)<>'array'
     or jsonb_array_length(p_options) not between 1 and 50
     or exists(select 1 from jsonb_array_elements(p_options) option
       where jsonb_typeof(option)<>'string'
          or length(trim(option#>>'{}')) not between 1 and 200) then
    raise exception 'round options must be 1-50 nonempty labels';
  end if;
  select jsonb_agg(to_jsonb(trim(option#>>'{}')) order by ordinal)
    into v_options
    from jsonb_array_elements(p_options) with ordinality as x(option,ordinal);
  if (select count(*)<>count(distinct option#>>'{}')
        from jsonb_array_elements(v_options) option) then
    raise exception 'round option labels must be unique';
  end if;
  v_hash:=encode(digest(concat_ws('|',trim(p_title),p_type,v_options::text),
    'sha256'),'hex');
  -- Serialize distinct idempotency keys at the durable team boundary before
  -- claiming the request. Claiming first takes a foreign-key KEY SHARE lock on
  -- this row, so two callers could otherwise deadlock while both upgrade to
  -- FOR UPDATE. The unique index above remains the fail-closed database
  -- invariant if another writer bypasses this function.
  perform 1 from climate_vote.team t
   where t.id=v_team.id and t.session_id=v_team.session_id and t.org_id=v_team.org_id
   for update;
  if not found then raise exception 'round team scope is not provisioned'; end if;
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'mod_create_round_v3',v_hash,v_team.org_id,v_team.session_id,v_team.id);
  if v_prior is not null then
    select * into v_row from jsonb_populate_record(null::climate_vote.rounds,v_prior);
    return v_row;
  end if;
  select * into v_row from climate_vote.rounds r
   where r.team_id=v_team.id and r.session_id=v_team.session_id
     and r.org_id=v_team.org_id and r.status='active'
   order by r.id limit 1;
  if found then
    raise exception 'active round conflict: existing round %',v_row.id
      using detail='existing_round_id='||v_row.id;
  end if;
  begin
    insert into climate_vote.rounds(
      id,title,type,options,sort_order,status,team_id,session_id,org_id,created_by)
    values('m-'||replace(gen_random_uuid()::text,'-',''),
      trim(p_title),p_type,v_options,0,'active',v_team.id,v_team.session_id,
      v_team.org_id,'mod:'||v_team.name)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint<>'rounds_one_active_per_team_uidx' then raise; end if;
    -- A concurrent call can retain its outer statement snapshot while it
    -- waits on the team boundary. The unique index remains authoritative;
    -- after its wait completes, resolve the committed winner for a stable
    -- fail-closed conflict instead of leaking a generic constraint error.
    select * into v_row from climate_vote.rounds r
     where r.team_id=v_team.id and r.status='active'
     order by r.id limit 1;
    if not found then raise; end if;
    raise exception 'active round conflict: existing round %',v_row.id
      using detail='existing_round_id='||v_row.id;
  end;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,p_idempotency_key,'round_created','team',v_auth.actor_label,null,
    jsonb_build_object('round_id',v_row.id,'type',p_type));
  perform climate_vote.workshop_request_finish(p_idempotency_key,to_jsonb(v_row));
  return v_row;
end $fn$;

create or replace function climate_vote.mod_set_round_status_v2(
  p_token text, p_round_id text, p_status text)
returns climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_row climate_vote.rounds; v_old text;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if p_status is null or p_status not in ('active','closed') then
    raise exception 'invalid status';
  end if;
  select status into v_old from climate_vote.rounds
   where id=p_round_id and team_id=v_team.id for update;
  if not found then raise exception 'round not in authorization scope'; end if;
  if v_old=p_status then
    select * into v_row from climate_vote.rounds
     where id=p_round_id and team_id=v_team.id;
    return v_row;
  end if;
  update climate_vote.rounds set status=p_status,updated_at=now()
   where id=p_round_id returning * into v_row;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'round_status_changed','team',v_auth.actor_label,
    jsonb_build_object('round_id',p_round_id,'status',v_old),
    jsonb_build_object('round_id',p_round_id,'status',p_status));
  return v_row;
end $fn$;

-- Moderator round lifecycle is an exact compare-and-set. A successful retry
-- returns the stored row even after the live row has moved again, while a new
-- stale request fails without changing the round or appending audit history.
create or replace function climate_vote.mod_set_round_status_v3(
  p_token text, p_round_id text, p_expected_status text, p_status text,
  p_idempotency_key uuid)
returns climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_row climate_vote.rounds; v_hash text; v_prior jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if p_round_id is null or length(trim(p_round_id))=0 then
    raise exception 'round id required';
  end if;
  if p_expected_status is null or p_expected_status not in ('active','closed')
     or p_status is null or p_status not in ('active','closed')
     or p_expected_status=p_status then
    raise exception 'round status transition must be active to closed or closed to active';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'round_id',p_round_id,
    'expected_status',p_expected_status,
    'status',p_status)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'mod_set_round_status_v3',v_hash,v_team.org_id,v_team.session_id,v_team.id);
  if v_prior is not null then
    select * into v_row
      from jsonb_populate_record(null::climate_vote.rounds,v_prior);
    return v_row;
  end if;

  select r.* into v_row from climate_vote.rounds r
   where r.id=p_round_id and r.team_id=v_team.id
     and r.session_id=v_team.session_id and r.org_id=v_team.org_id
   for update;
  if not found then raise exception 'round not in authorization scope'; end if;
  if v_row.status is distinct from p_expected_status then
    raise exception 'round status conflict: expected %, current %',
      p_expected_status,v_row.status;
  end if;
  if p_expected_status='closed'
     and (v_row.updated_at is null
       or clock_timestamp()>v_row.updated_at+interval '60 seconds') then
    raise exception 'closed round can only be reopened within 60 seconds of the server close time';
  end if;

  update climate_vote.rounds
     set status=p_status,updated_at=now()
   where id=v_row.id
   returning * into v_row;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,p_idempotency_key,'round_status_changed','team',v_auth.actor_label,
    jsonb_build_object('round_id',p_round_id,'status',p_expected_status),
    jsonb_build_object('round_id',p_round_id,'status',p_status));
  perform climate_vote.workshop_request_finish(p_idempotency_key,to_jsonb(v_row));
  return v_row;
end $fn$;

create or replace function climate_vote.mod_proxy_vote_v2(
  p_token text, p_round_id text, p_choice jsonb, p_n int)
returns int language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session; i int;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if p_n is null or p_n<1 or p_n>5 then raise exception 'proxy 1..5 only'; end if;
  if p_choice is null then raise exception 'proxy choice required'; end if;
  perform 1 from climate_vote.rounds
   where id=p_round_id and team_id=v_team.id and status='active';
  if not found then raise exception 'round not active in authorization scope'; end if;
  for i in 1..p_n loop
    insert into climate_vote.votes(round_id,choice,voter_role,client_id,org_id)
    values(p_round_id,p_choice,'proxy','proxy-'||v_team.id||'-'||gen_random_uuid(),v_team.org_id);
  end loop;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'proxy_vote_recorded','team',v_auth.actor_label,null,
    jsonb_build_object('round_id',p_round_id,'count',p_n));
  return p_n;
end $fn$;

-- A proxy submission is not naturally idempotent: repeating it creates more
-- anonymous votes. The request-key form is the safe client migration target.
create or replace function climate_vote.mod_proxy_vote_v3(
  p_token text, p_round_id text, p_choice jsonb, p_n int,
  p_idempotency_key uuid)
returns int language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_round climate_vote.rounds; v_hash text; v_prior jsonb; v_result jsonb; i int;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if p_n is null or p_n<1 or p_n>5 then raise exception 'proxy 1..5 only'; end if;
  if p_choice is null then raise exception 'proxy choice required'; end if;
  v_hash:=encode(digest(concat_ws('|',p_round_id,p_choice::text,p_n::text),
    'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'mod_proxy_vote_v3',v_hash,v_team.org_id,v_team.session_id,v_team.id);
  if v_prior is not null then return (v_prior->>'recorded')::int; end if;
  select r.* into v_round from climate_vote.rounds r
   where r.id=p_round_id and r.team_id=v_team.id and r.status='active' for update;
  if not found then raise exception 'round not active in authorization scope'; end if;
  if jsonb_typeof(v_round.options)<>'array' or jsonb_array_length(v_round.options)=0 then
    raise exception 'round has no allowed choices';
  end if;
  if v_round.type='CHECKBOX' then
    if jsonb_typeof(p_choice)<>'array' or jsonb_array_length(p_choice)=0
       or exists(
         select 1 from jsonb_array_elements(p_choice) selected
          where not exists(
            select 1 from jsonb_array_elements(v_round.options) allowed
             where allowed=selected
          )
       )
       or (select count(*)<>count(distinct selected)
             from jsonb_array_elements(p_choice) selected) then
      raise exception 'invalid proxy vote choice';
    end if;
  elsif v_round.type in ('RADIO','SCALE') then
    if jsonb_typeof(p_choice) in ('array','object','null') or not exists(
      select 1 from jsonb_array_elements(v_round.options) allowed where allowed=p_choice
    ) then raise exception 'invalid proxy vote choice'; end if;
  else
    raise exception 'unsupported proxy round type';
  end if;
  for i in 1..p_n loop
    insert into climate_vote.votes(round_id,choice,voter_role,client_id,org_id)
    values(p_round_id,p_choice,'proxy',
      'proxy-'||v_team.id||'-'||gen_random_uuid(),v_team.org_id);
  end loop;
  v_result:=jsonb_build_object('recorded',p_n);
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,p_idempotency_key,'proxy_vote_recorded','team',v_auth.actor_label,null,
    jsonb_build_object('round_id',p_round_id,'count',p_n));
  perform climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  return p_n;
end $fn$;

create or replace function climate_vote.mod_log_timer_v2(
  p_token text, p_kind text, p_duration_s int, p_started_at timestamptz,
  p_ended_at timestamptz default null)
returns bigint language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session; v_id bigint;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if p_kind is null or p_kind not in ('speech','session') then raise exception 'invalid timer kind'; end if;
  if p_duration_s is null or p_duration_s<1 or p_duration_s>14400 then raise exception 'duration out of range'; end if;
  if p_started_at is null then raise exception 'timer start required'; end if;
  if p_ended_at is not null and p_ended_at<p_started_at then raise exception 'timer end before start'; end if;
  insert into climate_vote.timer_log(team_id,kind,duration_s,started_at,ended_at)
  values(v_team.id,p_kind,p_duration_s,p_started_at,p_ended_at) returning id into v_id;
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'timer_logged','team',v_auth.actor_label,null,
    jsonb_build_object('timer_id',v_id,'kind',p_kind,'duration_s',p_duration_s));
  return v_id;
end $fn$;

create or replace function climate_vote.ballot_create_v2(
  p_token text, p_title text, p_instructions text, p_items jsonb,
  p_subgroup text default null)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot; v_n int;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if length(trim(coalesce(p_title,'')))=0 then raise exception 'ballot title required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>20 then raise exception 'items must be array of 1..20'; end if;
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
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'ballot_created','team',v_auth.actor_label,null,
    jsonb_build_object('ballot_id',v_ballot.id,'items',v_n,'subgroup',p_subgroup));
  return jsonb_build_object('id',v_ballot.id,'token',v_ballot.token,
    'status',v_ballot.status,'subgroup',v_ballot.subgroup,'items',v_n);
end $fn$;

create or replace function climate_vote.ballot_create_v3(
  p_token text, p_title text, p_instructions text, p_items jsonb,
  p_subgroup text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_auth climate_vote.attendance_auth_session;
  v_ballot climate_vote.ballot; v_n int; v_hash text; v_prior jsonb; v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
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
end $fn$;

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

create or replace function climate_vote.ballot_list_v2(p_token text)
returns table(id uuid,title text,status text,token text,subgroup text,
  item_count bigint,response_count bigint,created_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  v_team:=climate_vote.team_token_row(p_token);
  return query select b.id,b.title,b.status,b.token,b.subgroup,
    (select count(*) from climate_vote.ballot_item bi where bi.ballot_id=b.id),
    (select count(*) from climate_vote.ballot_response br where br.ballot_id=b.id),b.created_at
  from climate_vote.ballot b where b.session_id=v_team.session_id
    and b.org_id=v_team.org_id and b.status<>'archived' order by b.created_at desc;
end $fn$;

create or replace function climate_vote.ballot_results_v2(
  p_ballot_token text, p_token text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_ballot climate_vote.ballot; v_out jsonb;
begin
  v_team:=climate_vote.team_token_row(p_token);
  select * into v_ballot from climate_vote.ballot where token=p_ballot_token
    and session_id=v_team.session_id and org_id=v_team.org_id;
  if not found then return null; end if;
  select jsonb_build_object('id',v_ballot.id,'title',v_ballot.title,
    'status',v_ballot.status,'subgroup',v_ballot.subgroup,
    'responses',(select count(*) from climate_vote.ballot_response br where br.ballot_id=v_ballot.id),
    'items',coalesce(jsonb_agg(item_agg order by item_ord),'[]'::jsonb)) into v_out
  from (select bi.ordinal item_ord,jsonb_build_object(
      'id',bi.id,'ordinal',bi.ordinal,'statement',bi.statement,'scale',bi.scale,
      'n',count(v.val),'avg',round(avg(v.val)::numeric,2),
      'dist',(select coalesce(jsonb_object_agg(d.k,d.c),'{}'::jsonb)
        from (select (br2.answers->>(bi.id::text))::int k,count(*) c
          from climate_vote.ballot_response br2 where br2.ballot_id=bi.ballot_id
            and (br2.answers->>(bi.id::text)) is not null group by 1)d)) item_agg
    from climate_vote.ballot_item bi
    left join lateral(select (br.answers->>(bi.id::text))::int val
      from climate_vote.ballot_response br where br.ballot_id=bi.ballot_id
        and (br.answers->>(bi.id::text)) is not null)v on true
    where bi.ballot_id=v_ballot.id
    group by bi.id,bi.ordinal,bi.statement,bi.scale,bi.ballot_id)agg;
  return v_out;
end $fn$;

-- Public ballot tokens are non-binding participation capabilities. Accept a
-- response only while the entire owning tenancy is active and inside its hard
-- event window. The ballot row lock linearizes submit against staff close.
create or replace function climate_vote.ballot_submit(
  p_token text, p_client_id text, p_answers jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_ballot climate_vote.ballot; v_item record; v_value_text text; v_val int;
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

  insert into climate_vote.ballot_response(ballot_id,client_id,answers,org_id)
  values(v_ballot.id,trim(p_client_id),p_answers,v_ballot.org_id);
  return jsonb_build_object('ok',true);
exception when unique_violation then
  raise exception 'already submitted';
end $fn$;

-- Supabase Auth staff path. org_of_uid() is single-membership fail-closed in
-- P1 and becomes request-selected-org aware when P1c is installed. The caller
-- supplies a session id, but the server accepts it only inside that selected
-- active membership and the canonical session -> assembly organization chain.
create or replace function climate_vote.platform_staff_session_row(p_session_id uuid)
returns climate_vote.session language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_user uuid:=auth.uid(); v_org uuid; v_session climate_vote.session;
begin
  if v_user is null then raise exception 'authenticated staff required'; end if;
  v_org:=climate_vote.org_of_uid();
  if v_org is null then raise exception 'active organization membership required'; end if;
  select s.* into v_session
    from climate_vote.session s
    join climate_vote.assembly a on a.id=s.assembly_id and a.org_id=s.org_id
    join climate_vote.org o on o.id=s.org_id and o.status='active'
   where s.id=p_session_id and s.org_id=v_org
     and exists(select 1 from climate_vote.membership m
       where m.user_id=v_user and m.org_id=v_org and m.status='active');
  if not found then
    raise exception 'staff session is not in selected organization scope';
  end if;
  return v_session;
end $fn$;

-- Mutations that open a new participation surface require the whole event
-- hierarchy and its hard access window to be live. Read/recovery and closing
-- paths intentionally continue to use platform_staff_session_row so operators
-- can inspect and close an already-open round after the event window expires.
create or replace function climate_vote.platform_staff_live_session_row(p_session_id uuid)
returns climate_vote.session language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  perform 1 from climate_vote.session s
    join climate_vote.assembly a on a.id=s.assembly_id and a.org_id=s.org_id
    join climate_vote.org o on o.id=s.org_id
   where s.id=v_session.id and s.org_id=v_session.org_id
     and s.status='active'
     and a.status='active' and a.archived_at is null
     and o.status='active' and o.archived_at is null
     and s.access_expires_at is not null and s.access_expires_at>now();
  if not found then
    raise exception 'staff session is inactive, archived, or outside its access window';
  end if;
  return v_session;
end $fn$;

-- The legacy readiness_check(uuid) accepts any session id. Keep its proven
-- aggregate contract, but put the selected-organization membership boundary in
-- front of it so authenticated staff cannot probe another institution.
create or replace function climate_vote.platform_readiness_check_v2(p_session_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  if p_session_id is null then raise exception 'staff session id required'; end if;
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  return climate_vote.readiness_check(v_session.id);
end $fn$;

create or replace function climate_vote.platform_ballot_list_v2(p_session_id uuid)
returns table(id uuid,title text,status text,token text,subgroup text,
  item_count bigint,response_count bigint,created_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  return query select b.id,b.title,b.status,b.token,b.subgroup,
    (select count(*) from climate_vote.ballot_item bi where bi.ballot_id=b.id),
    (select count(*) from climate_vote.ballot_response br where br.ballot_id=b.id),b.created_at
  from climate_vote.ballot b
  where b.session_id=v_session.id and b.org_id=v_session.org_id
    and b.status<>'archived'
  order by b.created_at desc;
end $fn$;

create or replace function climate_vote.platform_ballot_results_v2(
  p_ballot_token text, p_session_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_ballot climate_vote.ballot; v_out jsonb;
begin
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  select * into v_ballot from climate_vote.ballot
   where token=p_ballot_token and session_id=v_session.id and org_id=v_session.org_id;
  if not found then return null; end if;
  select jsonb_build_object('id',v_ballot.id,'title',v_ballot.title,
    'status',v_ballot.status,'subgroup',v_ballot.subgroup,
    'responses',(select count(*) from climate_vote.ballot_response br where br.ballot_id=v_ballot.id),
    'items',coalesce(jsonb_agg(item_agg order by item_ord),'[]'::jsonb)) into v_out
  from (select bi.ordinal item_ord,jsonb_build_object(
      'id',bi.id,'ordinal',bi.ordinal,'statement',bi.statement,'scale',bi.scale,
      'n',count(v.val),'avg',round(avg(v.val)::numeric,2),
      'dist',(select coalesce(jsonb_object_agg(d.k,d.c),'{}'::jsonb)
        from (select (br2.answers->>(bi.id::text))::int k,count(*) c
          from climate_vote.ballot_response br2 where br2.ballot_id=bi.ballot_id
            and (br2.answers->>(bi.id::text)) is not null group by 1)d)) item_agg
    from climate_vote.ballot_item bi
    left join lateral(select (br.answers->>(bi.id::text))::int val
      from climate_vote.ballot_response br where br.ballot_id=bi.ballot_id
        and (br.answers->>(bi.id::text)) is not null)v on true
    where bi.ballot_id=v_ballot.id
    group by bi.id,bi.ordinal,bi.statement,bi.scale,bi.ballot_id)agg;
  return v_out;
end $fn$;

create or replace function climate_vote.platform_staff_session_for_roles(
  p_session_id uuid, p_allowed_roles text[])
returns climate_vote.session language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_user uuid:=auth.uid();
begin
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  if p_allowed_roles is null or cardinality(p_allowed_roles)=0 then
    raise exception 'staff role policy required';
  end if;
  if not exists(select 1 from climate_vote.membership m
    where m.user_id=v_user and m.org_id=v_session.org_id
      and m.status='active' and m.role=any(p_allowed_roles)) then
    raise exception 'staff role is not allowed for this operation';
  end if;
  return v_session;
end $fn$;

-- Authenticated Canvas staff create an event-wide, high-entropy public round
-- without direct table access. The request UUID deterministically names the
-- row, so retrying an ambiguous response cannot create a second round.
create or replace function climate_vote.platform_canvas_round_create_v2(
  p_session_id uuid, p_options jsonb, p_idempotency_key uuid)
returns table(id text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_id text; v_round climate_vote.rounds;
  v_options jsonb;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','operator']);
  perform climate_vote.platform_staff_live_session_row(v_session.id);
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if p_options is null or jsonb_typeof(p_options)<>'array'
     or jsonb_array_length(p_options) not between 1 and 100
     or exists(select 1 from jsonb_array_elements(p_options) option
       where jsonb_typeof(option)<>'string'
          or length(trim(option#>>'{}')) not between 1 and 500) then
    raise exception 'canvas round options must be 1-100 nonempty labels';
  end if;
  select jsonb_agg(to_jsonb(trim(option#>>'{}')) order by ordinal)
    into v_options
    from jsonb_array_elements(p_options) with ordinality as x(option,ordinal);
  if (select count(*)<>count(distinct option#>>'{}')
        from jsonb_array_elements(v_options) option) then
    raise exception 'canvas round option labels must be unique';
  end if;
  v_id:='AGV-'||replace(p_idempotency_key::text,'-','');

  -- One non-closed Canvas round per session. The advisory lock closes the
  -- read/create race and makes every open round recoverable as one current task.
  perform pg_advisory_xact_lock(hashtextextended('canvas-round:'||v_session.id::text,0));
  select r.* into v_round from climate_vote.rounds r
   where r.id=v_id and r.team_id is null and r.session_id=v_session.id
     and r.org_id=v_session.org_id for update;
  if found then
    if v_round.type<>'SCALE_MULTI' or v_round.options<>v_options then
      raise exception 'canvas round idempotency conflict';
    end if;
  else
    if exists(select 1 from climate_vote.rounds r
      where r.team_id is null and r.session_id=v_session.id
        and r.org_id=v_session.org_id and r.status in ('pending','active')) then
      raise exception 'close the current canvas round before creating another';
    end if;
  insert into climate_vote.rounds(
    id,title,description,type,options,scale_low,scale_high,
    scale_low_label,scale_high_label,status,sort_order,team_id,session_id,org_id,created_by)
  values(v_id,'의제 평가 투표','각 의제의 중요도를 5점 척도로 평가해 주세요.',
    'SCALE_MULTI',v_options,1,5,'낮음','높음','pending',100,null,
    v_session.id,v_session.org_id,'platform:'||auth.uid()::text)
  returning * into v_round;
  end if;
  insert into climate_vote.platform_canvas_round_event(
    org_id,session_id,round_id,action,before_status,after_status,actor_user_id,request_id)
  values(v_session.org_id,v_session.id,v_round.id,'created',null,'pending',auth.uid(),
    p_idempotency_key)
  on conflict(request_id,action) do nothing;
  return query select v_id;
end $fn$;

-- Reload-safe recovery surface for the one open Canvas round in a selected
-- staff session. It returns only the fields needed to restore status controls.
create or replace function climate_vote.platform_canvas_round_current_v2(p_session_id uuid)
returns table(id text,title text,status text,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','operator']);
  return query
  select r.id,r.title,r.status,r.created_at,r.updated_at
    from climate_vote.rounds r
   where r.team_id is null and r.session_id=v_session.id
     and r.org_id=v_session.org_id and r.status in ('pending','active')
   order by r.created_at desc
   limit 1;
end $fn$;

-- These functions are installed before P2 in lexicographic order. PostgreSQL
-- therefore defers body relation checks until first call; each call explicitly
-- refuses to run until the P2 schema exists. The PG16 verification executes all
-- bodies after P2 to retain real type/query checking at the behavior seam.
set local check_function_bodies=off;

-- Canonical review CAS. The hash binds the complete semantic issue state to
-- the exact ordered evidence links, including the linked source text shown in
-- the review console. Metadata such as row creation timestamps is deliberately
-- excluded so semantically identical data produces the same digest.
create or replace function climate_vote.platform_issue_snapshot_hash(
  p_issue_id uuid)
returns text language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_snapshot jsonb;
begin
  if to_regclass('climate_vote.issue_link') is null then
    raise exception 'P2 analysis schema required';
  end if;
  select jsonb_build_object(
      'id',i.id,
      'topic_id',i.topic_id,
      'org_id',i.org_id,
      'label',i.label,
      'stance',i.stance,
      'frequency_class',i.frequency_class,
      'summary',i.summary,
      'origin',i.origin,
      'review_status',i.review_status,
      'reviewed_by',i.reviewed_by,
      'reviewed_at',i.reviewed_at,
      'archived_at',i.archived_at,
      'links',coalesce((
        select jsonb_agg(jsonb_build_object(
          'item_id',il.item_id,
          'cluster_id',il.cluster_id,
          'linked_by',il.linked_by,
          'source',jsonb_build_object(
            'submission_id',si.submission_id,
            'ordinal',si.ordinal,
            'kind',si.kind,
            'content',si.content,
            'rationale',si.rationale))
          order by il.item_id)
        from climate_vote.issue_link il
        join climate_vote.submission_item si on si.id=il.item_id
        where il.issue_id=i.id),'[]'::jsonb))
    into v_snapshot
    from climate_vote.issue i where i.id=p_issue_id;
  if v_snapshot is null then return null; end if;
  return encode(extensions.digest(v_snapshot::text,'sha256'),'hex');
end $fn$;

-- Semantic CAS token for one issue's published implementation state. The
-- embedded snapshot_hash is deliberately excluded, so the digest remains
-- stable when a legacy body is backfilled at the P2a cutover.
create or replace function climate_vote.platform_result_implementation_snapshot_hash(
  p_implementation jsonb)
returns text language plpgsql immutable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_snapshot jsonb;
begin
  if p_implementation is null or jsonb_typeof(p_implementation)<>'object' then
    return null;
  end if;
  v_snapshot:=jsonb_build_object(
    'status',p_implementation->>'status',
    'responsible_body',p_implementation->>'responsible_body',
    'updated_at',p_implementation->>'updated_at',
    'summary',p_implementation->>'summary',
    'evidence_url',p_implementation->'evidence_url');
  return encode(extensions.digest(v_snapshot::text,'sha256'),'hex');
end $fn$;

create or replace function climate_vote.platform_issue_list_v2(
  p_session_id uuid, p_topic_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_issues jsonb; v_unclassified int; v_reviewed int;
begin
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  if to_regclass('climate_vote.issue') is null then raise exception 'P2 analysis schema required'; end if;
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id and dt.org_id=v_session.org_id;
  if not found then raise exception 'topic not in selected staff session'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'label',i.label,'stance',i.stance,
      'frequency_class',i.frequency_class,'summary',i.summary,
      'origin',i.origin,'review_status',i.review_status,
      'reviewed_by',i.reviewed_by,'reviewed_at',i.reviewed_at,
      'archived_at',i.archived_at,
      'snapshot_hash',climate_vote.platform_issue_snapshot_hash(i.id),
      'linked_item_count',(select count(*) from climate_vote.issue_link il where il.issue_id=i.id),
      'consensus_denominator',(select count(distinct coalesce(il.cluster_id,il.item_id))
        from climate_vote.issue_link il where il.issue_id=i.id))
      order by i.created_at),'[]'::jsonb) into v_issues
    from climate_vote.issue i
   where i.topic_id=p_topic_id and i.org_id=v_session.org_id and i.archived_at is null;
  select count(*) into v_unclassified
    from climate_vote.submission_item si
    join climate_vote.submission su on su.id=si.submission_id
   where su.topic_id=p_topic_id and su.org_id=v_session.org_id
     and not exists(select 1 from climate_vote.issue_link il where il.item_id=si.id);
  select count(*) into v_reviewed from climate_vote.issue i
   where i.topic_id=p_topic_id and i.org_id=v_session.org_id
     and i.review_status='reviewed' and i.archived_at is null;
  return jsonb_build_object('topic_id',p_topic_id,'issues',v_issues,
    'unclassified_count',v_unclassified,'reviewed_count',v_reviewed);
end $fn$;

create or replace function climate_vote.platform_issue_items_v2(
  p_session_id uuid, p_topic_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_items jsonb;
begin
  v_session:=climate_vote.platform_staff_session_row(p_session_id);
  if to_regclass('climate_vote.issue_link') is null then raise exception 'P2 analysis schema required'; end if;
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id and dt.org_id=v_session.org_id;
  if not found then raise exception 'topic not in selected staff session'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',si.id,'content',si.content,'rationale',si.rationale,
      'kind',si.kind,'ordinal',si.ordinal,'team_id',su.team_id,'team_name',tm.name,
      'submission_id',su.id,
      'links',(select coalesce(jsonb_agg(jsonb_build_object(
        'issue_id',il.issue_id,'cluster_id',il.cluster_id,'linked_by',il.linked_by)),
        '[]'::jsonb) from climate_vote.issue_link il where il.item_id=si.id),
      'unclassified',not exists(select 1 from climate_vote.issue_link il where il.item_id=si.id))
      order by tm.name,su.id,si.ordinal),'[]'::jsonb) into v_items
    from climate_vote.submission_item si
    join climate_vote.submission su on su.id=si.submission_id
    left join climate_vote.team tm on tm.id=su.team_id and tm.org_id=v_session.org_id
   where su.topic_id=p_topic_id and su.org_id=v_session.org_id;
  return jsonb_build_object('topic_id',p_topic_id,'items',v_items);
end $fn$;

create or replace function climate_vote.platform_issue_upsert_v2(
  p_session_id uuid, p_topic_id uuid, p_issue jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_id uuid; v_label text; v_stance text;
  v_freq text; v_summary text; v_existing record; v_created boolean:=false;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue') is null then raise exception 'P2 analysis schema required'; end if;
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id and dt.org_id=v_session.org_id;
  if not found then raise exception 'topic not in selected staff session'; end if;
  if p_issue is null or jsonb_typeof(p_issue)<>'object' then raise exception 'issue object required'; end if;
  v_label:=trim(coalesce(p_issue->>'label',''));
  v_stance:=nullif(p_issue->>'stance','');
  v_freq:=coalesce(nullif(p_issue->>'frequency',''),nullif(p_issue->>'frequency_class',''));
  v_summary:=nullif(p_issue->>'summary','');
  if length(v_label)=0 then raise exception 'label required'; end if;
  v_id:=nullif(p_issue->>'id','')::uuid;
  if v_id is not null then
    insert into climate_vote.issue
      (id,topic_id,label,stance,frequency_class,summary,origin,review_status,org_id)
    values(v_id,p_topic_id,v_label,v_stance,v_freq,v_summary,'human','draft',v_session.org_id)
    on conflict(id) do nothing returning true into v_created;
    if coalesce(v_created,false) then
      return jsonb_build_object('id',v_id,'created',true);
    end if;
    select i.topic_id,i.org_id,i.archived_at into v_existing
      from climate_vote.issue i where i.id=v_id for update;
    if not found or v_existing.topic_id<>p_topic_id
       or v_existing.org_id<>v_session.org_id or v_existing.archived_at is not null then
      raise exception 'client issue id already belongs to another scope';
    end if;
    update climate_vote.issue set label=v_label,stance=v_stance,
      frequency_class=v_freq,summary=v_summary,review_status='draft',
      reviewed_by=null,reviewed_at=null where id=v_id;
    return jsonb_build_object('id',v_id,'created',false);
  end if;
  insert into climate_vote.issue
    (topic_id,label,stance,frequency_class,summary,origin,review_status,org_id)
  values(p_topic_id,v_label,v_stance,v_freq,v_summary,'human','draft',v_session.org_id)
  returning id into v_id;
  return jsonb_build_object('id',v_id,'created',true);
end $fn$;

-- Editing is a semantic snapshot CAS. Creation also requires a client UUID so
-- an ambiguous network response can be retried without manufacturing a second
-- issue. The request ledger is claimed before lookup, allowing an exact retry
-- to recover the first result after later state changes.
create or replace function climate_vote.platform_issue_upsert_v3(
  p_session_id uuid, p_topic_id uuid, p_issue jsonb,
  p_expected_snapshot_hash text, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_session climate_vote.session; v_id uuid; v_label text; v_stance text;
  v_freq text; v_summary text; v_existing record; v_current_hash text;
  v_hash text; v_prior jsonb; v_result jsonb; v_created boolean:=false;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue') is null then
    raise exception 'P2 analysis schema required';
  end if;
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id
     and dt.org_id=v_session.org_id and dt.archived_at is null;
  if not found then raise exception 'topic not in selected staff session'; end if;
  if p_issue is null or jsonb_typeof(p_issue)<>'object' then
    raise exception 'issue object required';
  end if;
  begin
    v_id:=nullif(trim(coalesce(p_issue->>'id','')),'')::uuid;
  exception when invalid_text_representation then
    raise exception 'valid client issue id required';
  end;
  if v_id is null then raise exception 'client issue id required'; end if;
  v_label:=trim(coalesce(p_issue->>'label',''));
  v_stance:=nullif(trim(coalesce(p_issue->>'stance','')),'');
  v_freq:=coalesce(
    nullif(trim(coalesce(p_issue->>'frequency','')),''),
    nullif(trim(coalesce(p_issue->>'frequency_class','')),''));
  v_summary:=nullif(trim(coalesce(p_issue->>'summary','')),'');
  if length(v_label) not between 1 and 200 then
    raise exception 'label must be 1-200 characters';
  end if;
  if v_stance is not null
     and v_stance not in ('pro','con','conditional','concern','proposal','neutral') then
    raise exception 'invalid issue stance';
  end if;
  if v_freq is not null
     and v_freq not in ('consensus','majority','minority','mixed') then
    raise exception 'invalid issue frequency';
  end if;
  if p_expected_snapshot_hash is not null
     and p_expected_snapshot_hash!~'^[0-9a-f]{64}$' then
    raise exception 'valid expected issue snapshot hash required';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'session_id',p_session_id,
    'topic_id',p_topic_id,
    'id',v_id,
    'label',v_label,
    'stance',v_stance,
    'frequency_class',v_freq,
    'summary',v_summary,
    'expected_snapshot_hash',p_expected_snapshot_hash)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'platform_issue_upsert_v3',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  select i.topic_id,i.org_id,i.archived_at into v_existing
    from climate_vote.issue i where i.id=v_id for update;
  if found then
    if v_existing.topic_id<>p_topic_id or v_existing.org_id<>v_session.org_id
       or v_existing.archived_at is not null then
      raise exception 'client issue id already belongs to another scope';
    end if;
    v_current_hash:=climate_vote.platform_issue_snapshot_hash(v_id);
    if p_expected_snapshot_hash is null
       or v_current_hash is distinct from p_expected_snapshot_hash then
      v_result:=jsonb_build_object(
        'status','conflict','id',v_id,'created',false,
        'current_snapshot_hash',v_current_hash);
      return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
    end if;
    update climate_vote.issue
       set label=v_label,stance=v_stance,frequency_class=v_freq,summary=v_summary,
           origin='human',review_status='draft',reviewed_by=null,reviewed_at=null
     where id=v_id;
  else
    if p_expected_snapshot_hash is not null then
      v_result:=jsonb_build_object(
        'status','conflict','id',v_id,'created',false,
        'current_snapshot_hash',null);
      return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
    end if;
    insert into climate_vote.issue
      (id,topic_id,label,stance,frequency_class,summary,origin,review_status,org_id)
    values(v_id,p_topic_id,v_label,v_stance,v_freq,v_summary,
      'human','draft',v_session.org_id)
    on conflict(id) do nothing returning true into v_created;
    if not coalesce(v_created,false) then
      select i.topic_id,i.org_id,i.archived_at into v_existing
        from climate_vote.issue i where i.id=v_id for update;
      if not found or v_existing.topic_id<>p_topic_id
         or v_existing.org_id<>v_session.org_id or v_existing.archived_at is not null then
        raise exception 'client issue id already belongs to another scope';
      end if;
      v_current_hash:=climate_vote.platform_issue_snapshot_hash(v_id);
      v_result:=jsonb_build_object(
        'status','conflict','id',v_id,'created',false,
        'current_snapshot_hash',v_current_hash);
      return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
    end if;
  end if;

  v_current_hash:=climate_vote.platform_issue_snapshot_hash(v_id);
  v_result:=jsonb_build_object(
    'status','applied','id',v_id,'created',coalesce(v_created,false),
    'snapshot_hash',v_current_hash);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.platform_issue_link_set_v2(
  p_session_id uuid, p_issue_id uuid, p_item_ids uuid[], p_cluster_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_topic uuid; v_bad int; v_n int;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue_link') is null then raise exception 'P2 analysis schema required'; end if;
  if p_item_ids is null then raise exception 'item ids must be an explicit array'; end if;
  select i.topic_id into v_topic from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=p_issue_id and i.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and i.archived_at is null for update of i;
  if v_topic is null then raise exception 'issue not in selected staff session'; end if;
  select count(*) into v_bad
    from unnest(coalesce(p_item_ids,array[]::uuid[])) x(item_id)
   where not exists(select 1 from climate_vote.submission_item si
     join climate_vote.submission su on su.id=si.submission_id
     where si.id=x.item_id and su.topic_id=v_topic and su.org_id=v_session.org_id);
  if v_bad>0 then raise exception '% item(s) not in selected staff topic',v_bad; end if;
  delete from climate_vote.issue_link where issue_id=p_issue_id;
  insert into climate_vote.issue_link(issue_id,item_id,cluster_id,linked_by)
  select p_issue_id,x.item_id,p_cluster_id,'human'
    from (select distinct unnest(coalesce(p_item_ids,array[]::uuid[])) item_id)x;
  get diagnostics v_n=row_count;
  update climate_vote.issue set review_status='draft',reviewed_by=null,reviewed_at=null
   where id=p_issue_id and review_status='reviewed';
  return jsonb_build_object('issue_id',p_issue_id,'linked',v_n);
end $fn$;

-- A browser reclassification can replace both the destination and source link
-- sets. Applying those sets through separate RPC calls permits a half-move when
-- the second request fails. This endpoint validates the complete plan, locks
-- every affected issue in deterministic order, compares the caller's complete
-- link snapshot (CAS), and only then replaces all link sets in one transaction.
create or replace function climate_vote.platform_issue_reclassify_v2(
  p_session_id uuid, p_topic_id uuid, p_plan jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_session climate_vote.session; v_calls jsonb; v_call_count int;
  v_issue_ids uuid[]; v_locked int; v_bad int; v_call jsonb;
  v_issue_id uuid; v_actual jsonb; v_expected jsonb; v_hash text;
  v_prior jsonb; v_result jsonb; v_linked_count int;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue_link') is null then
    raise exception 'P2 analysis schema required';
  end if;
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id
     and dt.org_id=v_session.org_id and dt.archived_at is null;
  if not found then raise exception 'topic not in selected staff session'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'object'
     or jsonb_typeof(p_plan->'calls') is distinct from 'array' then
    raise exception 'reclassification plan calls array required';
  end if;
  v_calls:=p_plan->'calls';
  v_call_count:=jsonb_array_length(v_calls);
  if v_call_count not between 1 and 2 then
    raise exception 'reclassification plan must contain 1-2 calls';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_calls) call
     where jsonb_typeof(call)<>'object'
        or nullif(trim(coalesce(call->>'issue_id','')),'') is null
        or call->>'role' is null or call->>'role' not in ('target','source')
        or jsonb_typeof(call->'item_ids') is distinct from 'array'
        or jsonb_typeof(call->'expected_links') is distinct from 'array'
        or jsonb_array_length(call->'item_ids')>5000
        or jsonb_array_length(call->'expected_links')>5000
        or ((call ? 'cluster_id')
          and jsonb_typeof(call->'cluster_id') is distinct from 'string'
          and jsonb_typeof(call->'cluster_id') is distinct from 'null')
  ) then raise exception 'invalid reclassification call'; end if;
  if v_call_count=2 and (
       (select count(*) from jsonb_array_elements(v_calls) call
         where call->>'role'='target')<>1
       or (select count(*) from jsonb_array_elements(v_calls) call
         where call->>'role'='source')<>1) then
    raise exception 'two-call reclassification requires one target and one source';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_calls) call,
      lateral jsonb_array_elements(call->'item_ids') item
     where jsonb_typeof(item)<>'string'
        or nullif(trim(coalesce(item#>>'{}','')),'') is null
  ) then raise exception 'reclassification item ids must be UUID strings'; end if;
  if exists(
    select 1 from jsonb_array_elements(v_calls) call,
      lateral jsonb_array_elements(call->'expected_links') link
     where jsonb_typeof(link)<>'object'
        or nullif(trim(coalesce(link->>'item_id','')),'') is null
        or link->>'linked_by' is null or link->>'linked_by' not in ('ai','human')
        or ((link ? 'cluster_id')
          and jsonb_typeof(link->'cluster_id') is distinct from 'string'
          and jsonb_typeof(link->'cluster_id') is distinct from 'null')
  ) then raise exception 'invalid expected reclassification links'; end if;

  select array_agg((call->>'issue_id')::uuid order by (call->>'issue_id')::uuid)
    into v_issue_ids from jsonb_array_elements(v_calls) call;
  if cardinality(v_issue_ids)<>(select count(distinct call->>'issue_id')
      from jsonb_array_elements(v_calls) call) then
    raise exception 'reclassification issue ids must be unique';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_calls) call,
      lateral jsonb_array_elements(call->'item_ids') item
    group by call->>'issue_id',item#>>'{}' having count(*)>1
  ) then raise exception 'reclassification item ids must be unique per issue'; end if;
  if exists(
    select 1 from jsonb_array_elements(v_calls) call,
      lateral jsonb_array_elements(call->'expected_links') link
    group by call->>'issue_id',link->>'item_id' having count(*)>1
  ) then raise exception 'expected links must be unique per issue'; end if;

  -- Validate both desired and expected item snapshots against the exact topic,
  -- organization and session before any issue_link row can be changed.
  select count(*) into v_bad from (
    select distinct (item#>>'{}')::uuid item_id
      from jsonb_array_elements(v_calls) call,
        lateral jsonb_array_elements(call->'item_ids') item
    union
    select distinct (link->>'item_id')::uuid item_id
      from jsonb_array_elements(v_calls) call,
        lateral jsonb_array_elements(call->'expected_links') link
  ) planned
  where not exists(
    select 1 from climate_vote.submission_item si
    join climate_vote.submission su on su.id=si.submission_id
    join climate_vote.discussion_topic dt on dt.id=su.topic_id
    where si.id=planned.item_id and su.topic_id=p_topic_id
      and su.org_id=v_session.org_id and dt.session_id=v_session.id
      and dt.org_id=v_session.org_id and dt.archived_at is null);
  if v_bad>0 then
    raise exception '% reclassification item(s) not in selected staff topic',v_bad;
  end if;

  -- The sort gives overlapping requests one lock order and avoids avoidable
  -- source/destination deadlocks.
  perform i.id from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=any(v_issue_ids) and i.topic_id=p_topic_id
     and i.org_id=v_session.org_id and i.archived_at is null
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and dt.archived_at is null
   order by i.id for update of i;
  get diagnostics v_locked=row_count;
  if v_locked<>v_call_count then
    raise exception 'reclassification issue not in selected staff topic';
  end if;

  v_hash:=encode(digest(concat_ws('|',p_topic_id::text,p_plan::text),
    'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'platform_issue_reclassify_v2',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  for v_call in
    select call from jsonb_array_elements(v_calls) call
      order by (call->>'issue_id')::uuid
  loop
    v_issue_id:=(v_call->>'issue_id')::uuid;
    select coalesce(jsonb_agg(jsonb_build_object(
        'item_id',il.item_id,'cluster_id',il.cluster_id,'linked_by',il.linked_by)
        order by il.item_id),'[]'::jsonb)
      into v_actual from climate_vote.issue_link il where il.issue_id=v_issue_id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'item_id',(link->>'item_id')::uuid,
        'cluster_id',nullif(link->>'cluster_id','')::uuid,
        'linked_by',link->>'linked_by')
        order by (link->>'item_id')::uuid),'[]'::jsonb)
      into v_expected from jsonb_array_elements(v_call->'expected_links') link;
    if v_actual<>v_expected then
      v_result:=jsonb_build_object('status','conflict',
        'conflict_issue_id',v_issue_id);
      return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
    end if;
  end loop;

  for v_call in select call from jsonb_array_elements(v_calls) call loop
    v_issue_id:=(v_call->>'issue_id')::uuid;
    delete from climate_vote.issue_link where issue_id=v_issue_id;
    insert into climate_vote.issue_link(issue_id,item_id,cluster_id,linked_by)
    select v_issue_id,(item#>>'{}')::uuid,
      nullif(v_call->>'cluster_id','')::uuid,'human'
      from jsonb_array_elements(v_call->'item_ids') item;
  end loop;
  update climate_vote.issue set review_status='draft',reviewed_by=null,reviewed_at=null
   where id=any(v_issue_ids);
  select coalesce(sum(jsonb_array_length(call->'item_ids')),0)::int
    into v_linked_count from jsonb_array_elements(v_calls) call;
  v_result:=jsonb_build_object('status','applied','affected_issues',v_call_count,
    'linked_count',v_linked_count,'issue_ids',to_jsonb(v_issue_ids));
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.platform_issue_merge_v2(
  p_session_id uuid, p_src_issue_id uuid, p_dst_issue_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_src record; v_dst record; v_moved int;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue_link') is null then raise exception 'P2 analysis schema required'; end if;
  if p_src_issue_id=p_dst_issue_id then raise exception 'cannot merge issue into itself'; end if;
  select i.* into v_src from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=p_src_issue_id and i.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and i.archived_at is null for update of i;
  if not found then raise exception 'src issue not in selected staff session'; end if;
  select i.* into v_dst from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=p_dst_issue_id and i.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and i.archived_at is null for update of i;
  if not found then raise exception 'dst issue not in selected staff session'; end if;
  if v_src.topic_id<>v_dst.topic_id then raise exception 'cannot merge across topics'; end if;
  insert into climate_vote.issue_link(issue_id,item_id,cluster_id,linked_by,created_at)
  select p_dst_issue_id,il.item_id,il.cluster_id,il.linked_by,il.created_at
    from climate_vote.issue_link il where il.issue_id=p_src_issue_id
  on conflict(issue_id,item_id) do nothing;
  get diagnostics v_moved=row_count;
  delete from climate_vote.issue_link where issue_id=p_src_issue_id;
  update climate_vote.issue set review_status='archived',archived_at=now()
   where id=p_src_issue_id;
  update climate_vote.issue set review_status='draft',reviewed_by=null,reviewed_at=null
   where id=p_dst_issue_id and review_status='reviewed';
  return jsonb_build_object('src',p_src_issue_id,'dst',p_dst_issue_id,'moved',v_moved);
end $fn$;

create or replace function climate_vote.platform_issue_review_v2(
  p_session_id uuid, p_issue_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_status text;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue') is null then raise exception 'P2 analysis schema required'; end if;
  select i.review_status into v_status from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=p_issue_id and i.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and i.archived_at is null for update of i;
  if v_status is null then raise exception 'issue not in selected staff session'; end if;
  if v_status='reviewed' then
    return jsonb_build_object('id',p_issue_id,'review_status','reviewed');
  end if;
  if v_status<>'draft' then raise exception 'only draft issues can be reviewed (current: %)',v_status; end if;
  update climate_vote.issue set review_status='reviewed',
    reviewed_by='staff:'||auth.uid()::text,reviewed_at=now() where id=p_issue_id;
  return jsonb_build_object('id',p_issue_id,'review_status','reviewed');
end $fn$;

-- Human review is a compare-and-set over the exact server snapshot returned by
-- platform_issue_list_v2. Every issue mutation path takes the issue row lock,
-- so review racing an edit or reclassification either observes the new digest
-- and conflicts, or commits first and is subsequently invalidated to draft.
create or replace function climate_vote.platform_issue_review_v3(
  p_session_id uuid, p_issue_id uuid, p_expected_snapshot_hash text,
  p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_session climate_vote.session; v_hash text; v_prior jsonb;
  v_status text; v_current_hash text; v_result jsonb;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue') is null then
    raise exception 'P2 analysis schema required';
  end if;
  if p_issue_id is null then raise exception 'issue id required'; end if;
  if p_expected_snapshot_hash is null
     or p_expected_snapshot_hash!~'^[0-9a-f]{64}$' then
    raise exception 'valid expected issue snapshot hash required';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'session_id',p_session_id,
    'issue_id',p_issue_id,
    'expected_snapshot_hash',p_expected_snapshot_hash)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'platform_issue_review_v3',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  select i.review_status into v_status
    from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=p_issue_id and i.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and i.archived_at is null
   for update of i;
  if not found then raise exception 'issue not in selected staff session'; end if;

  v_current_hash:=climate_vote.platform_issue_snapshot_hash(p_issue_id);
  if v_current_hash is distinct from p_expected_snapshot_hash then
    v_result:=jsonb_build_object(
      'status','conflict',
      'conflict_issue_id',p_issue_id,
      'current_snapshot_hash',v_current_hash);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  if v_status not in ('draft','reviewed') then
    raise exception 'only draft issues can be reviewed (current: %)',v_status;
  end if;
  if v_status='draft' then
    update climate_vote.issue set review_status='reviewed',
      reviewed_by='staff:'||auth.uid()::text,reviewed_at=now()
     where id=p_issue_id;
  end if;
  v_current_hash:=climate_vote.platform_issue_snapshot_hash(p_issue_id);
  v_result:=jsonb_build_object(
    'status','applied','id',p_issue_id,'review_status','reviewed',
    'snapshot_hash',v_current_hash);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

-- Atomic merge uses deterministic row-lock ordering and snapshot CAS for both
-- participants. The request is claimed before active-source lookup so an exact
-- retry can recover its stored result after the source has been archived.
create or replace function climate_vote.platform_issue_merge_v3(
  p_session_id uuid, p_src_issue_id uuid, p_dst_issue_id uuid,
  p_expected_src_snapshot_hash text, p_expected_dst_snapshot_hash text,
  p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_session climate_vote.session; v_hash text; v_prior jsonb; v_result jsonb;
  v_src record; v_dst record; v_locked int; v_moved int;
  v_src_hash text; v_dst_hash text; v_conflict_issue uuid;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['operator','org_admin','hq']);
  if to_regclass('climate_vote.issue_link') is null then
    raise exception 'P2 analysis schema required';
  end if;
  if p_src_issue_id is null or p_dst_issue_id is null then
    raise exception 'source and destination issue ids required';
  end if;
  if p_src_issue_id=p_dst_issue_id then raise exception 'cannot merge issue into itself'; end if;
  if p_expected_src_snapshot_hash is null
     or p_expected_src_snapshot_hash!~'^[0-9a-f]{64}$'
     or p_expected_dst_snapshot_hash is null
     or p_expected_dst_snapshot_hash!~'^[0-9a-f]{64}$' then
    raise exception 'valid expected issue snapshot hashes required';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'session_id',p_session_id,
    'src_issue_id',p_src_issue_id,
    'dst_issue_id',p_dst_issue_id,
    'expected_src_snapshot_hash',p_expected_src_snapshot_hash,
    'expected_dst_snapshot_hash',p_expected_dst_snapshot_hash)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'platform_issue_merge_v3',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  perform i.id
    from climate_vote.issue i
    join climate_vote.discussion_topic dt on dt.id=i.topic_id
   where i.id=any(array[p_src_issue_id,p_dst_issue_id])
     and i.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and i.archived_at is null
   order by i.id for update of i;
  get diagnostics v_locked=row_count;
  if v_locked<>2 then
    raise exception 'merge issues not in selected staff session';
  end if;
  select i.* into v_src from climate_vote.issue i where i.id=p_src_issue_id;
  select i.* into v_dst from climate_vote.issue i where i.id=p_dst_issue_id;
  if v_src.topic_id<>v_dst.topic_id then raise exception 'cannot merge across topics'; end if;

  v_src_hash:=climate_vote.platform_issue_snapshot_hash(p_src_issue_id);
  v_dst_hash:=climate_vote.platform_issue_snapshot_hash(p_dst_issue_id);
  if v_src_hash is distinct from p_expected_src_snapshot_hash
     or v_dst_hash is distinct from p_expected_dst_snapshot_hash then
    v_conflict_issue:=case
      when v_src_hash is distinct from p_expected_src_snapshot_hash
        then p_src_issue_id else p_dst_issue_id end;
    v_result:=jsonb_build_object(
      'status','conflict',
      'conflict_issue_id',v_conflict_issue,
      'current_snapshot_hash',case when v_conflict_issue=p_src_issue_id
        then v_src_hash else v_dst_hash end,
      'src_snapshot_hash',v_src_hash,
      'dst_snapshot_hash',v_dst_hash);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;

  insert into climate_vote.issue_link(issue_id,item_id,cluster_id,linked_by,created_at)
  select p_dst_issue_id,il.item_id,il.cluster_id,il.linked_by,il.created_at
    from climate_vote.issue_link il where il.issue_id=p_src_issue_id
  on conflict(issue_id,item_id) do nothing;
  get diagnostics v_moved=row_count;
  delete from climate_vote.issue_link where issue_id=p_src_issue_id;
  update climate_vote.issue set review_status='archived',archived_at=now()
   where id=p_src_issue_id;
  update climate_vote.issue set review_status='draft',reviewed_by=null,reviewed_at=null
   where id=p_dst_issue_id;
  v_dst_hash:=climate_vote.platform_issue_snapshot_hash(p_dst_issue_id);
  v_result:=jsonb_build_object(
    'status','applied','src',p_src_issue_id,'dst',p_dst_issue_id,
    'moved',v_moved,'dst_snapshot_hash',v_dst_hash);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.platform_result_publish_v2(
  p_session_id uuid, p_scope text, p_scope_id uuid, p_title text)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_title text; v_topic_ids uuid[];
  v_issues jsonb; v_unclassified int; v_reviewed int; v_body jsonb; v_page record;
  v_existing boolean:=false; v_page_count int;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','hq']);
  if to_regclass('climate_vote.result_page') is null then raise exception 'P2 analysis schema required'; end if;
  if p_scope is null or p_scope not in ('topic','session','assembly') then
    raise exception 'invalid scope: %',p_scope;
  end if;
  if p_scope_id is null then raise exception 'scope id required'; end if;
  v_title:=nullif(trim(coalesce(p_title,'')),'');
  if v_title is null then raise exception 'title required'; end if;
  if p_scope='topic' then
    perform 1 from climate_vote.discussion_topic dt where dt.id=p_scope_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id;
    if not found then raise exception 'publish topic not in selected staff session'; end if;
    v_topic_ids:=array[p_scope_id];
  elsif p_scope='session' then
    if p_scope_id<>v_session.id then raise exception 'publish session scope mismatch'; end if;
    select coalesce(array_agg(dt.id),array[]::uuid[]) into v_topic_ids
      from climate_vote.discussion_topic dt
     where dt.session_id=v_session.id and dt.org_id=v_session.org_id;
  else
    if p_scope_id<>v_session.assembly_id then raise exception 'publish assembly scope mismatch'; end if;
    select coalesce(array_agg(dt.id),array[]::uuid[]) into v_topic_ids
      from climate_vote.discussion_topic dt
      join climate_vote.session s on s.id=dt.session_id
     where s.assembly_id=v_session.assembly_id and s.org_id=v_session.org_id
       and dt.org_id=v_session.org_id;
  end if;
  -- result_page intentionally has no unique scope constraint in P2. Serialize
  -- the first-publish select/insert per organization+scope without mutating or
  -- pre-validating legacy rows as part of this additive migration.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|',v_session.org_id::text,p_scope,p_scope_id::text),0));
  select count(*) into v_page_count from climate_vote.result_page rp
   where rp.scope=p_scope and rp.scope_id=p_scope_id and rp.org_id=v_session.org_id
     and rp.archived_at is null;
  if v_page_count>1 then
    raise exception 'duplicate live result pages require repair before publish';
  end if;
  select * into v_page from climate_vote.result_page rp
   where rp.scope=p_scope and rp.scope_id=p_scope_id and rp.org_id=v_session.org_id
     and rp.archived_at is null for update;
  v_existing:=found;
  -- reviewed_count, issue payload, and unclassified_count must describe one MVCC
  -- snapshot. Keeping them in a single SQL statement prevents a concurrent
  -- review/link edit from producing a self-contradictory published body.
  with reviewed as materialized (
    select i.* from climate_vote.issue i
     where i.topic_id=any(v_topic_ids) and i.org_id=v_session.org_id
       and i.review_status='reviewed' and i.archived_at is null
  ), snapshot as (
    select
      (select count(*)::int from reviewed) as reviewed_count,
      coalesce((select jsonb_agg(
        jsonb_build_object(
          'id',i.id,'label',i.label,'stance',i.stance,
          'frequency_class',i.frequency_class,'summary',i.summary,
          'review_status',i.review_status,'topic_id',i.topic_id,
          'consensus_denominator',(select count(distinct coalesce(il.cluster_id,il.item_id))
            from climate_vote.issue_link il where il.issue_id=i.id),
          'teams',(select coalesce(jsonb_agg(distinct tm.name),'[]'::jsonb)
            from climate_vote.issue_link il
            join climate_vote.submission_item si on si.id=il.item_id
            join climate_vote.submission su on su.id=si.submission_id
            join climate_vote.team tm on tm.id=su.team_id
            where il.issue_id=i.id and su.org_id=v_session.org_id
              and tm.org_id=v_session.org_id))
          ||coalesce((select jsonb_build_object('implementation',jsonb_build_object(
              'status',rie.status,'responsible_body',rie.responsible_body,
              'updated_at',to_char(rie.effective_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'summary',rie.summary,'evidence_url',rie.evidence_url,
              'snapshot_hash',climate_vote.platform_result_implementation_snapshot_hash(
                jsonb_build_object(
                  'status',rie.status,'responsible_body',rie.responsible_body,
                  'updated_at',to_char(rie.effective_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'summary',rie.summary,'evidence_url',rie.evidence_url))))
            from climate_vote.result_implementation_event rie
            where v_existing and rie.result_id=v_page.id and rie.issue_id=i.id
              and rie.org_id=v_session.org_id
            order by rie.created_at desc,rie.id desc limit 1),'{}'::jsonb)
          order by i.created_at,i.id)
        from reviewed i),'[]'::jsonb) as issues,
      (select count(*)::int from climate_vote.submission_item si
        join climate_vote.submission su on su.id=si.submission_id
       where su.topic_id=any(v_topic_ids) and su.org_id=v_session.org_id
         and not exists(select 1 from climate_vote.issue_link il
           where il.item_id=si.id)) as unclassified_count
  )
  select reviewed_count,issues,unclassified_count
    into v_reviewed,v_issues,v_unclassified from snapshot;
  if v_reviewed=0 then raise exception 'no reviewed issue in scope — cannot publish'; end if;
  v_body:=jsonb_build_object('scope',p_scope,'scope_id',p_scope_id,'title',v_title,
    'hitl_notice','AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.',
    'consensus_rule','합의도 분모 = 연결 원문의 cluster 기준(cluster_id 있으면 cluster, 없으면 distinct item).',
    'issues',v_issues,'reviewed_count',v_reviewed,
    'unclassified_count',v_unclassified,'generated_at',now());
  if v_existing then
    update climate_vote.result_page set title=v_title,body=v_body,published_at=now(),
      published_by='staff:'||auth.uid()::text where id=v_page.id returning * into v_page;
  else
    insert into climate_vote.result_page
      (scope,scope_id,title,body,published_at,published_by,org_id)
    values(p_scope,p_scope_id,v_title,v_body,now(),'staff:'||auth.uid()::text,v_session.org_id)
    returning * into v_page;
  end if;
  return jsonb_build_object('id',v_page.id,'token',v_page.token,
    'published_at',v_page.published_at,'reviewed_count',v_reviewed);
end $fn$;

create or replace function climate_vote.platform_result_unpublish_v2(
  p_session_id uuid, p_result_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_page record; v_in_scope boolean:=false;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','hq']);
  if to_regclass('climate_vote.result_page') is null then raise exception 'P2 analysis schema required'; end if;
  select * into v_page from climate_vote.result_page rp
   where rp.id=p_result_id and rp.org_id=v_session.org_id and rp.archived_at is null for update;
  if not found then raise exception 'result page not in selected organization'; end if;
  if v_page.scope='topic' then
    select exists(select 1 from climate_vote.discussion_topic dt
      where dt.id=v_page.scope_id and dt.session_id=v_session.id
        and dt.org_id=v_session.org_id) into v_in_scope;
  elsif v_page.scope='session' then
    v_in_scope:=v_page.scope_id=v_session.id;
  elsif v_page.scope='assembly' then
    v_in_scope:=v_page.scope_id=v_session.assembly_id;
  end if;
  if not v_in_scope then raise exception 'result page not in selected staff session scope'; end if;
  if v_page.published_at is null then
    return jsonb_build_object('id',p_result_id,'published_at',null);
  end if;
  update climate_vote.result_page set published_at=null where id=p_result_id;
  return jsonb_build_object('id',p_result_id,'published_at',null);
end $fn$;

create or replace function climate_vote.platform_result_implementation_upsert_v2(
  p_session_id uuid, p_result_token text, p_issue_id uuid,
  p_implementation jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_page record; v_in_scope boolean:=false;
  v_status text; v_body_name text; v_updated_text text; v_summary text;
  v_evidence text; v_effective_at timestamptz; v_implementation jsonb;
  v_issues jsonb; v_recorded_at timestamptz; v_event_id bigint;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','hq']);
  if to_regclass('climate_vote.result_page') is null then
    raise exception 'P2 analysis schema required';
  end if;
  if p_implementation is null or jsonb_typeof(p_implementation)<>'object' then
    raise exception 'implementation object required';
  end if;
  if exists(select 1 from jsonb_object_keys(p_implementation) k
    where k not in ('status','responsible_body','updated_at','summary','evidence_url')) then
    raise exception 'implementation contains unsupported fields';
  end if;
  if p_result_token is null or p_result_token!~'^[0-9a-f]{32}$' then
    raise exception 'invalid result token';
  end if;
  select * into v_page from climate_vote.result_page rp
   where rp.token=p_result_token and rp.org_id=v_session.org_id
     and rp.published_at is not null and rp.archived_at is null for update;
  if not found then raise exception 'published result not in selected organization'; end if;
  if v_page.scope='topic' then
    select exists(select 1 from climate_vote.discussion_topic dt
      where dt.id=v_page.scope_id and dt.session_id=v_session.id
        and dt.org_id=v_session.org_id) into v_in_scope;
  elsif v_page.scope='session' then
    v_in_scope:=v_page.scope_id=v_session.id;
  elsif v_page.scope='assembly' then
    v_in_scope:=v_page.scope_id=v_session.assembly_id;
  end if;
  if not v_in_scope then raise exception 'result page not in selected staff session scope'; end if;
  if jsonb_typeof(v_page.body->'issues')<>'array'
     or not exists(select 1 from jsonb_array_elements(v_page.body->'issues') item
       where item->>'id'=p_issue_id::text and item->>'review_status'='reviewed') then
    raise exception 'reviewed issue not present in published result snapshot';
  end if;

  v_status:=p_implementation->>'status';
  v_body_name:=trim(coalesce(p_implementation->>'responsible_body',''));
  v_updated_text:=p_implementation->>'updated_at';
  v_summary:=trim(coalesce(p_implementation->>'summary',''));
  v_evidence:=nullif(trim(coalesce(p_implementation->>'evidence_url','')),'');
  if v_status is null
     or v_status not in ('under_review','planned','in_progress','implemented','not_pursued') then
    raise exception 'invalid implementation status';
  end if;
  if length(v_body_name) not between 1 and 200 then
    raise exception 'responsible_body length must be 1..200';
  end if;
  if length(v_summary) not between 1 and 1000 then
    raise exception 'summary length must be 1..1000';
  end if;
  if v_updated_text is null or length(v_updated_text)>80
     or v_updated_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then
    raise exception 'updated_at must be canonical UTC';
  end if;
  v_effective_at:=v_updated_text::timestamptz;
  v_updated_text:=to_char(v_effective_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_evidence is not null then
    if length(v_evidence)>2000 or v_evidence!~'^https://' then
      raise exception 'evidence_url must be HTTPS and at most 2000 characters';
    end if;
    if position('@' in substring(v_evidence from '^https://([^/?#]+)'))>0 then
      raise exception 'evidence_url credentials are not allowed';
    end if;
  end if;
  if v_status in ('implemented','not_pursued') and v_evidence is null then
    raise exception 'evidence_url required for terminal implementation status';
  end if;
  v_implementation:=jsonb_build_object('status',v_status,
    'responsible_body',v_body_name,'updated_at',v_updated_text,
    'summary',v_summary,'evidence_url',v_evidence);
  select rie.id,rie.created_at into v_event_id,v_recorded_at
    from climate_vote.result_implementation_event rie
   where rie.result_id=v_page.id and rie.issue_id=p_issue_id
     and rie.org_id=v_session.org_id and rie.status=v_status
     and rie.responsible_body=v_body_name and rie.effective_at=v_effective_at
     and rie.summary=v_summary and rie.evidence_url is not distinct from v_evidence
   order by rie.created_at desc,rie.id desc limit 1;
  if found and exists(select 1 from jsonb_array_elements(v_page.body->'issues') item
      where item->>'id'=p_issue_id::text and item->'implementation'=v_implementation) then
    return jsonb_build_object('result_id',v_page.id,'issue_id',p_issue_id,
      'updated_at',v_recorded_at,'event_id',v_event_id);
  end if;
  select jsonb_agg(case when item->>'id'=p_issue_id::text
      then jsonb_set(item,'{implementation}',v_implementation,true) else item end
      order by ordinality) into v_issues
    from jsonb_array_elements(v_page.body->'issues') with ordinality as x(item,ordinality);
  update climate_vote.result_page
     set body=jsonb_set(v_page.body,'{issues}',coalesce(v_issues,'[]'::jsonb),true)
   where id=v_page.id;
  insert into climate_vote.result_implementation_event(
    org_id,session_id,result_id,result_token_hash,issue_id,actor_user_id,
    status,responsible_body,effective_at,summary,evidence_url)
  values(v_session.org_id,v_session.id,v_page.id,
    encode(digest(p_result_token,'sha256'),'hex'),p_issue_id,auth.uid(),
    v_status,v_body_name,v_effective_at,v_summary,v_evidence)
  returning id,created_at into v_event_id,v_recorded_at;
  return jsonb_build_object('result_id',v_page.id,'issue_id',p_issue_id,
    'updated_at',v_recorded_at,'event_id',v_event_id);
end $fn$;

-- Staff implementation edits use the published issue body as their visible
-- compare-and-set snapshot. A stable request UUID makes both an applied write
-- and a stale conflict replayable after later edits without appending another
-- audit event.
create or replace function climate_vote.platform_result_implementation_upsert_v3(
  p_session_id uuid, p_result_token text, p_issue_id uuid,
  p_implementation jsonb, p_expected_snapshot_hash text,
  p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_session climate_vote.session; v_page record; v_in_scope boolean:=false;
  v_status text; v_body_name text; v_updated_text text; v_summary text;
  v_evidence text; v_effective_at timestamptz; v_semantic jsonb;
  v_implementation jsonb; v_current_implementation jsonb; v_issues jsonb;
  v_current_hash text; v_new_hash text; v_request_hash text; v_prior jsonb;
  v_result jsonb; v_recorded_at timestamptz; v_event_id bigint;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','hq']);
  if to_regclass('climate_vote.result_page') is null then
    raise exception 'P2 analysis schema required';
  end if;
  if p_implementation is null or jsonb_typeof(p_implementation)<>'object' then
    raise exception 'implementation object required';
  end if;
  if exists(select 1 from jsonb_object_keys(p_implementation) k
    where k not in ('status','responsible_body','updated_at','summary','evidence_url')) then
    raise exception 'implementation contains unsupported fields';
  end if;
  if p_result_token is null or p_result_token!~'^[0-9a-f]{32}$' then
    raise exception 'invalid result token';
  end if;
  if p_issue_id is null then raise exception 'issue id required'; end if;
  if p_expected_snapshot_hash is not null
     and p_expected_snapshot_hash!~'^[0-9a-f]{64}$' then
    raise exception 'valid expected implementation snapshot hash required';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  -- Establish current tenant/session authorization before claiming a request
  -- key. The page is locked and revalidated only after an exact replay has had
  -- a chance to return its stored result.
  select rp.id,rp.scope,rp.scope_id,rp.published_at,rp.body,rp.org_id
    into v_page from climate_vote.result_page rp
   where rp.token=p_result_token and rp.org_id=v_session.org_id
     and rp.archived_at is null;
  if not found then raise exception 'result not in selected organization'; end if;
  if v_page.scope='topic' then
    select exists(select 1 from climate_vote.discussion_topic dt
      where dt.id=v_page.scope_id and dt.session_id=v_session.id
        and dt.org_id=v_session.org_id) into v_in_scope;
  elsif v_page.scope='session' then
    v_in_scope:=v_page.scope_id=v_session.id;
  elsif v_page.scope='assembly' then
    v_in_scope:=v_page.scope_id=v_session.assembly_id;
  end if;
  if not v_in_scope then
    raise exception 'result page not in selected staff session scope';
  end if;

  v_status:=p_implementation->>'status';
  v_body_name:=trim(coalesce(p_implementation->>'responsible_body',''));
  v_updated_text:=p_implementation->>'updated_at';
  v_summary:=trim(coalesce(p_implementation->>'summary',''));
  v_evidence:=nullif(trim(coalesce(p_implementation->>'evidence_url','')),'');
  if v_status is null
     or v_status not in ('under_review','planned','in_progress','implemented','not_pursued') then
    raise exception 'invalid implementation status';
  end if;
  if length(v_body_name) not between 1 and 200 then
    raise exception 'responsible_body length must be 1..200';
  end if;
  if length(v_summary) not between 1 and 1000 then
    raise exception 'summary length must be 1..1000';
  end if;
  if v_updated_text is null or length(v_updated_text)>80
     or v_updated_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then
    raise exception 'updated_at must be canonical UTC';
  end if;
  v_effective_at:=v_updated_text::timestamptz;
  v_updated_text:=to_char(v_effective_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_evidence is not null then
    if length(v_evidence)>2000 or v_evidence!~'^https://' then
      raise exception 'evidence_url must be HTTPS and at most 2000 characters';
    end if;
    if position('@' in substring(v_evidence from '^https://([^/?#]+)'))>0 then
      raise exception 'evidence_url credentials are not allowed';
    end if;
  end if;
  if v_status in ('implemented','not_pursued') and v_evidence is null then
    raise exception 'evidence_url required for terminal implementation status';
  end if;
  v_semantic:=jsonb_build_object('status',v_status,
    'responsible_body',v_body_name,'updated_at',v_updated_text,
    'summary',v_summary,'evidence_url',v_evidence);
  v_new_hash:=climate_vote.platform_result_implementation_snapshot_hash(v_semantic);
  v_implementation:=v_semantic||jsonb_build_object('snapshot_hash',v_new_hash);
  v_request_hash:=encode(extensions.digest(jsonb_build_object(
    'session_id',p_session_id,
    'result_token_sha256',encode(extensions.digest(p_result_token,'sha256'),'hex'),
    'issue_id',p_issue_id,
    'implementation',v_semantic,
    'expected_snapshot_hash',p_expected_snapshot_hash)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'platform_result_implementation_upsert_v3',v_request_hash,
    v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  select rp.id,rp.scope,rp.scope_id,rp.published_at,rp.body,rp.org_id
    into v_page from climate_vote.result_page rp
   where rp.id=v_page.id and rp.org_id=v_session.org_id
     and rp.archived_at is null for update;
  if not found then raise exception 'result not in selected organization'; end if;
  if v_page.published_at is null then
    raise exception 'published result not in selected organization';
  end if;
  if jsonb_typeof(v_page.body->'issues')<>'array'
     or not exists(select 1 from jsonb_array_elements(v_page.body->'issues') item
       where item->>'id'=p_issue_id::text and item->>'review_status'='reviewed') then
    raise exception 'reviewed issue not present in published result snapshot';
  end if;
  select case when jsonb_typeof(item->'implementation')='object'
      then item->'implementation' else null end
    into v_current_implementation
    from jsonb_array_elements(v_page.body->'issues') item
   where item->>'id'=p_issue_id::text and item->>'review_status'='reviewed'
   limit 1;
  v_current_hash:=climate_vote.platform_result_implementation_snapshot_hash(
    v_current_implementation);
  if v_current_hash is distinct from p_expected_snapshot_hash then
    v_result:=jsonb_build_object(
      'status','conflict','result_id',v_page.id,'issue_id',p_issue_id,
      'current_snapshot_hash',v_current_hash);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;

  -- A semantically identical save with a fresh request key is a successful
  -- no-op. Reuse the immutable event identity instead of growing history.
  if v_current_hash=v_new_hash then
    select rie.id,rie.created_at into v_event_id,v_recorded_at
      from climate_vote.result_implementation_event rie
     where rie.result_id=v_page.id and rie.issue_id=p_issue_id
       and rie.org_id=v_session.org_id and rie.status=v_status
       and rie.responsible_body=v_body_name and rie.effective_at=v_effective_at
       and rie.summary=v_summary and rie.evidence_url is not distinct from v_evidence
     order by rie.created_at desc,rie.id desc limit 1;
    if found then
      if v_current_implementation is distinct from v_implementation then
        select jsonb_agg(case when item->>'id'=p_issue_id::text
            then jsonb_set(item,'{implementation}',v_implementation,true)
            else item end order by ordinality) into v_issues
          from jsonb_array_elements(v_page.body->'issues')
            with ordinality as x(item,ordinality);
        update climate_vote.result_page
           set body=jsonb_set(v_page.body,'{issues}',coalesce(v_issues,'[]'::jsonb),true)
         where id=v_page.id;
      end if;
      v_result:=jsonb_build_object(
        'status','applied','result_id',v_page.id,'issue_id',p_issue_id,
        'updated_at',v_recorded_at,'event_id',v_event_id,
        'snapshot_hash',v_new_hash);
      return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
    end if;
  end if;

  select jsonb_agg(case when item->>'id'=p_issue_id::text
      then jsonb_set(item,'{implementation}',v_implementation,true) else item end
      order by ordinality) into v_issues
    from jsonb_array_elements(v_page.body->'issues') with ordinality as x(item,ordinality);
  update climate_vote.result_page
     set body=jsonb_set(v_page.body,'{issues}',coalesce(v_issues,'[]'::jsonb),true)
   where id=v_page.id;
  insert into climate_vote.result_implementation_event(
    org_id,session_id,result_id,result_token_hash,issue_id,actor_user_id,
    status,responsible_body,effective_at,summary,evidence_url)
  values(v_session.org_id,v_session.id,v_page.id,
    encode(extensions.digest(p_result_token,'sha256'),'hex'),p_issue_id,auth.uid(),
    v_status,v_body_name,v_effective_at,v_summary,v_evidence)
  returning id,created_at into v_event_id,v_recorded_at;
  v_result:=jsonb_build_object(
    'status','applied','result_id',v_page.id,'issue_id',p_issue_id,
    'updated_at',v_recorded_at,'event_id',v_event_id,
    'snapshot_hash',v_new_hash);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

set local check_function_bodies=on;

-- ---------------------------------------------------------------------------
-- 4. Team-scoped topics and submission OCC
-- ---------------------------------------------------------------------------

create or replace function climate_vote.topic_list_v2(p_token text)
returns table(id uuid, ordinal int, block text, prompt text, guidance text,
              status text, deadline_at timestamptz, server_now timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  v_team := climate_vote.team_token_row(p_token);
  return query
  select dt.id, dt.ordinal, dt.block, dt.prompt, dt.guidance, dt.status,
         dt.deadline_at, now()
    from climate_vote.discussion_topic dt
   where dt.session_id=v_team.session_id and dt.org_id=v_team.org_id
     and dt.status in ('open','closed')
   order by dt.ordinal;
end $fn$;

create or replace function climate_vote.submission_payload(
  p_submission_id uuid, p_status text, p_version bigint,
  p_updated_at timestamptz, p_finalized_at timestamptz)
returns jsonb language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select jsonb_build_object(
    'id',p_submission_id, 'status',p_status, 'version',p_version,
    'updated_at',p_updated_at, 'finalized_at',p_finalized_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'ordinal',si.ordinal,'kind',si.kind,'content',si.content,
      'rationale',si.rationale) order by si.ordinal)
      from climate_vote.submission_item si
      where si.submission_id=p_submission_id),'[]'::jsonb));
$fn$;

create or replace function climate_vote.submission_get_v2(
  p_token text, p_topic_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_sub climate_vote.submission;
begin
  v_team := climate_vote.team_token_row(p_token);
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_team.session_id
     and dt.org_id=v_team.org_id and dt.status <> 'archived';
  if not found then raise exception 'topic not in authorization scope'; end if;
  select * into v_sub from climate_vote.submission
   where topic_id=p_topic_id and team_id=v_team.id and org_id=v_team.org_id;
  if not found then
    return jsonb_build_object('status',null,'version',0,'items','[]'::jsonb);
  end if;
  return climate_vote.submission_payload(
    v_sub.id,v_sub.status,v_sub.version,v_sub.updated_at,v_sub.finalized_at);
end $fn$;

create or replace function climate_vote.submission_save_v3(
  p_token text, p_topic_id uuid, p_items jsonb, p_expected_version bigint,
  p_idempotency_key uuid, p_force boolean default false)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_team climate_vote.team;
  v_sub climate_vote.submission; v_items jsonb; v_in int; v_out int;
  v_saved int; v_ords int[]; v_skipped boolean := false;
  v_hash text; v_prior jsonb; v_result jsonb; v_before jsonb;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  v_team := climate_vote.team_token_row(p_token);
  perform 1 from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.status='open'
     and dt.session_id=v_team.session_id and dt.org_id=v_team.org_id;
  if not found then raise exception 'topic not open in authorization scope'; end if;
  -- Serialize new submission creation with the HQ exact-set clear. Existing-row
  -- edits are additionally protected by the submission row lock below.
  perform pg_advisory_xact_lock(hashtextextended(
    'workshop-submissions|'||v_team.session_id::text,0));
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 200 then
    raise exception 'items must be array (max 200)';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'expected version must be nonnegative';
  end if;
  if p_force is null then raise exception 'force flag must be explicit'; end if;

  v_hash := encode(digest(concat_ws('|',p_topic_id::text,p_items::text,
    p_expected_version::text,p_force::text),'sha256'),'hex');
  v_prior := climate_vote.workshop_request_claim(
    p_idempotency_key,'submission_save_v3',v_hash,v_team.org_id,
    v_team.session_id,v_team.id);
  if v_prior is not null then return v_prior; end if;

  v_in := jsonb_array_length(p_items);
  v_items := climate_vote.submission_split_items(p_items);
  v_out := jsonb_array_length(v_items);
  if v_out > 200 then v_items:=p_items; v_out:=v_in; v_skipped:=true; end if;

  insert into climate_vote.submission(topic_id,team_id,org_id)
  values(p_topic_id,v_team.id,v_team.org_id)
  on conflict(topic_id,team_id) do nothing;
  select * into v_sub from climate_vote.submission
   where topic_id=p_topic_id and team_id=v_team.id for update;
  if v_sub.org_id <> v_team.org_id then raise exception 'submission org mismatch'; end if;
  if v_sub.status not in ('draft','reopened') then
    raise exception 'submission is finalized';
  end if;

  -- An explicit replacement may overwrite only the exact server version the
  -- operator reviewed. `p_force` records that intent; it never disables CAS.
  if v_sub.version <> p_expected_version then
    v_result := climate_vote.submission_payload(
      v_sub.id,'conflict',v_sub.version,v_sub.updated_at,v_sub.finalized_at)
      || jsonb_build_object('submission_status',v_sub.status);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  v_before := jsonb_build_object('version',v_sub.version,'status',v_sub.status,
    'item_count',(select count(*) from climate_vote.submission_item
                  where submission_id=v_sub.id));

  select coalesce(array_agg(coalesce((e->>'ordinal')::int,rn)),array[]::int[])
    into v_ords
    from jsonb_array_elements(v_items) with ordinality as x(e,rn)
   where length(trim(coalesce(e->>'content',''))) > 0;

  -- P2 may be applied after this migration. Use dynamic SQL only when its tables exist.
  if to_regclass('climate_vote.issue_link') is not null
     and to_regclass('climate_vote.issue') is not null then
    execute 'update climate_vote.issue i set review_status=''draft'', reviewed_by=null, reviewed_at=null
      where i.review_status=''reviewed'' and i.id in (
        select il.issue_id from climate_vote.issue_link il
        join climate_vote.submission_item si on si.id=il.item_id
        where si.submission_id=$1 and not(si.ordinal=any($2)))'
      using v_sub.id,v_ords;
    execute 'delete from climate_vote.issue_link il using climate_vote.submission_item si
      where il.item_id=si.id and si.submission_id=$1 and not(si.ordinal=any($2))'
      using v_sub.id,v_ords;
  end if;
  delete from climate_vote.submission_item
   where submission_id=v_sub.id and not(ordinal=any(v_ords));
  -- Stable item ids preserve issue links, but an in-place replacement would
  -- otherwise bypass the legacy AFTER DELETE archive trigger. Append the old
  -- source exactly once when a same-ordinal value materially changes.
  insert into climate_vote.submission_item_archive
    (submission_id,ordinal,kind,content,rationale,created_at)
  select si.submission_id,si.ordinal,si.kind,si.content,si.rationale,si.created_at
    from climate_vote.submission_item si
    join jsonb_array_elements(v_items) with ordinality as x(e,rn)
      on si.ordinal=coalesce((e->>'ordinal')::int,rn)
   where si.submission_id=v_sub.id
     and length(trim(coalesce(e->>'content',''))) > 0
     and (si.kind,si.content,si.rationale) is distinct from
         (coalesce(nullif(e->>'kind',''),'core'),e->>'content',nullif(e->>'rationale',''));
  insert into climate_vote.submission_item(submission_id,ordinal,kind,content,rationale)
  select v_sub.id,coalesce((e->>'ordinal')::int,rn),
         coalesce(nullif(e->>'kind',''),'core'),e->>'content',nullif(e->>'rationale','')
    from jsonb_array_elements(v_items) with ordinality as x(e,rn)
   where length(trim(coalesce(e->>'content',''))) > 0
  on conflict(submission_id,ordinal) do update
    set kind=excluded.kind,content=excluded.content,rationale=excluded.rationale;
  select count(*) into v_saved from climate_vote.submission_item
   where submission_id=v_sub.id;
  update climate_vote.submission
     set version=version+1,updated_at=now(),last_saved_by=v_auth.actor_label
   where id=v_sub.id returning * into v_sub;

  v_result := jsonb_build_object('id',v_sub.id,'status',v_sub.status,
    'saved',v_saved,'version',v_sub.version,'updated_at',v_sub.updated_at,
    'split',greatest(v_out-v_in,0),'split_skipped_over_cap',v_skipped,
    'forced',p_force);
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,p_idempotency_key,'submission_saved','team',v_auth.actor_label,
    v_before,jsonb_build_object('version',v_sub.version,'status',v_sub.status,
                               'item_count',v_saved,'forced',p_force));
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.submission_finalize_v2(
  p_token text, p_topic_id uuid, p_expected_version bigint)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_team climate_vote.team;
  v_sub climate_vote.submission; v_cnt int; v_before_status text;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if p_expected_version is null or p_expected_version<0 then
    raise exception 'expected version must be nonnegative';
  end if;
  select * into v_sub from climate_vote.submission
   where topic_id=p_topic_id and team_id=v_team.id and org_id=v_team.org_id for update;
  if not found then raise exception 'nothing to finalize'; end if;
  if v_sub.version <> p_expected_version then
    return climate_vote.submission_payload(
      v_sub.id,'conflict',v_sub.version,v_sub.updated_at,v_sub.finalized_at)
      || jsonb_build_object('submission_status',v_sub.status);
  end if;
  if v_sub.status='final' then
    return jsonb_build_object('id',v_sub.id,'status','final','version',v_sub.version);
  end if;
  v_before_status:=v_sub.status;
  perform 1 from climate_vote.discussion_topic where id=p_topic_id
    and session_id=v_team.session_id and org_id=v_team.org_id and status='open';
  if not found then raise exception 'topic not open in authorization scope'; end if;
  select count(*) into v_cnt from climate_vote.submission_item where submission_id=v_sub.id;
  if v_cnt=0 then raise exception 'cannot finalize empty submission'; end if;
  update climate_vote.submission set status='final',finalized_at=now(),
    finalized_by='mod:'||v_team.name,version=version+1,updated_at=now()
   where id=v_sub.id returning * into v_sub;
  insert into climate_vote.submission_lock_event
    (submission_id,action,actor_scope,actor_label)
  values(v_sub.id,'finalize','team',v_auth.actor_label);
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'submission_finalized','team',v_auth.actor_label,
    jsonb_build_object('version',p_expected_version,'status',v_before_status),
    jsonb_build_object('version',v_sub.version,'status','final','item_count',v_cnt));
  return jsonb_build_object('id',v_sub.id,'status','final','version',v_sub.version);
end $fn$;

create or replace function climate_vote.submission_reopen_by_team_v2(
  p_token text, p_topic_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_team climate_vote.team;
  v_sub climate_vote.submission;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  select su.* into v_sub from climate_vote.submission su
    join climate_vote.discussion_topic dt on dt.id=su.topic_id
   where su.topic_id=p_topic_id and su.team_id=v_team.id
     and su.org_id=v_team.org_id and dt.session_id=v_team.session_id
     and dt.org_id=v_team.org_id and dt.status='open'
   for update of su;
  if not found then raise exception 'nothing to reopen in open authorization scope'; end if;
  if v_sub.status='reopened' then
    return jsonb_build_object('id',v_sub.id,'status','reopened','version',v_sub.version);
  end if;
  if v_sub.status <> 'final' then raise exception 'only finalized submission can be reopened'; end if;
  update climate_vote.submission set status='reopened',version=version+1,
    updated_at=now() where id=v_sub.id returning * into v_sub;
  insert into climate_vote.submission_lock_event
    (submission_id,action,actor_scope,actor_label,reason)
  values(v_sub.id,'reopen','team',v_auth.actor_label,'조가 직접 다시 엶');
  perform climate_vote.workshop_audit(v_team.org_id,v_team.session_id,v_team.id,
    v_auth.id,null,'submission_reopened','team',v_auth.actor_label,
    jsonb_build_object('version',v_sub.version-1,'status','final'),
    jsonb_build_object('version',v_sub.version,'status','reopened'));
  return jsonb_build_object('id',v_sub.id,'status','reopened','version',v_sub.version);
end $fn$;

drop trigger if exists workshop_audit_append_only_guard on climate_vote.workshop_audit_event;
create trigger workshop_audit_append_only_guard
  before update or delete on climate_vote.workshop_audit_event
  for each row execute function climate_vote.workshop_audit_append_only_guard();

drop trigger if exists platform_canvas_round_event_append_only_guard
  on climate_vote.platform_canvas_round_event;
create trigger platform_canvas_round_event_append_only_guard
  before update or delete on climate_vote.platform_canvas_round_event
  for each row execute function climate_vote.workshop_audit_append_only_guard();

create or replace function climate_vote.workshop_audit(
  p_org_id uuid, p_session_id uuid, p_team_id uuid, p_auth_session_id uuid,
  p_request_id uuid, p_action text, p_actor_scope text, p_actor_label text,
  p_before jsonb default null, p_after jsonb default null)
returns bigint language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_id bigint;
begin
  insert into climate_vote.workshop_audit_event
    (org_id, session_id, team_id, auth_session_id, request_id, action,
     actor_scope, actor_label, before_value, after_value)
  values
    (p_org_id, p_session_id, p_team_id, p_auth_session_id, p_request_id,
     p_action, p_actor_scope, left(p_actor_label, 80), p_before, p_after)
  returning id into v_id;
  return v_id;
end $fn$;

-- Claims and locks a request key. A repeated identical request returns its saved result;
-- reuse for a different operation, scope, or payload is rejected loudly.
create or replace function climate_vote.workshop_request_claim(
  p_idempotency_key uuid, p_operation text, p_request_hash text,
  p_org_id uuid, p_session_id uuid, p_team_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_row climate_vote.workshop_request_ledger;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  insert into climate_vote.workshop_request_ledger
    (idempotency_key, operation, request_hash, org_id, session_id, team_id)
  values
    (p_idempotency_key, p_operation, p_request_hash, p_org_id, p_session_id, p_team_id)
  on conflict (idempotency_key) do nothing;

  select * into v_row from climate_vote.workshop_request_ledger
   where idempotency_key = p_idempotency_key for update;
  if v_row.operation <> p_operation
     or v_row.request_hash <> p_request_hash
     or v_row.org_id <> p_org_id
     or v_row.session_id <> p_session_id
     or v_row.team_id is distinct from p_team_id then
    raise exception 'idempotency key reused with a different request';
  end if;
  return v_row.result;
end $fn$;

create or replace function climate_vote.workshop_request_finish(
  p_idempotency_key uuid, p_result jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
begin
  update climate_vote.workshop_request_ledger
     set result = p_result, completed_at = now()
   where idempotency_key = p_idempotency_key and result is null;
  if not found then
    select result into p_result from climate_vote.workshop_request_ledger
     where idempotency_key = p_idempotency_key;
  end if;
  return p_result;
end $fn$;

create or replace function climate_vote.platform_canvas_round_set_status_v2(
  p_session_id uuid, p_round_id text, p_expected_status text, p_status text,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_round climate_vote.rounds;
  v_hash text; v_prior jsonb; v_result jsonb;
begin
  v_session:=climate_vote.platform_staff_session_for_roles(
    p_session_id,array['org_admin','operator']);
  if p_expected_status is null or p_expected_status not in ('pending','active')
     or p_status is null or p_status not in ('active','closed') then
    raise exception 'invalid canvas round status transition';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  v_hash:=encode(digest(concat_ws('|',p_round_id,p_expected_status,p_status),
    'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'platform_canvas_round_set_status_v2',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;
  if p_expected_status='pending' and p_status='active' then
    perform climate_vote.platform_staff_live_session_row(v_session.id);
  end if;
  select r.* into v_round from climate_vote.rounds r
   where r.id=p_round_id and r.team_id is null
     and r.session_id=v_session.id and r.org_id=v_session.org_id for update;
  if not found then raise exception 'canvas round outside selected staff session'; end if;
  if v_round.status<>p_expected_status then
    v_result:=jsonb_build_object('id',v_round.id,'status','conflict',
      'current_status',v_round.status,'expected_status',p_expected_status);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  if v_round.status=p_status then
    v_result:=jsonb_build_object('id',v_round.id,'status',v_round.status);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  if not ((p_expected_status='pending' and p_status='active')
       or (p_expected_status='active' and p_status='closed')) then
    raise exception 'invalid canvas round status transition';
  end if;
  update climate_vote.rounds set status=p_status,updated_at=now()
   where id=v_round.id returning * into v_round;
  insert into climate_vote.platform_canvas_round_event(
    org_id,session_id,round_id,action,before_status,after_status,actor_user_id,request_id)
  values(v_session.org_id,v_session.id,v_round.id,'status_changed',p_expected_status,
    p_status,auth.uid(),p_idempotency_key);
  v_result:=jsonb_build_object('id',v_round.id,'status',v_round.status);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. Token issue, validation, exchange, and session restore
-- ---------------------------------------------------------------------------

create or replace function climate_vote.attendance_token_row(p_token text)
returns climate_vote.attendance_auth_session
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_row climate_vote.attendance_auth_session;
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'workshop authorization required';
  end if;
  select * into v_row
    from climate_vote.attendance_auth_session s
   where s.token_hash = encode(digest(lower(p_token), 'sha256'), 'hex')
     and s.revoked_at is null
     and s.expires_at > now();
  if not found then raise exception 'workshop authorization expired or revoked'; end if;

  if v_row.last_seen_at is null or v_row.last_seen_at < now() - interval '1 minute' then
    update climate_vote.attendance_auth_session
       set last_seen_at = now()
     where token_hash = v_row.token_hash
     returning * into v_row;
  end if;
  return v_row;
end $fn$;

-- Legacy PIN/HQ unlock callers still use this function. Bind every newly issued token
-- to the canonical org/session so P1b's org_id NOT NULL transition remains safe.
create or replace function climate_vote.attendance_issue_token(
  p_scope text, p_team_id uuid, p_actor_label text)
returns text language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_token text;
  v_session climate_vote.session;
  v_org uuid;
  v_expiry timestamptz;
  v_device uuid := gen_random_uuid();
begin
  if p_scope is null or p_scope not in ('team','hq') then
    raise exception 'invalid authorization scope';
  end if;
  if p_scope = 'team' then
    select s.* into v_session
      from climate_vote.team t
      join climate_vote.session s on s.id = t.session_id
      join climate_vote.assembly a on a.id=s.assembly_id
      join climate_vote.org o on o.id=a.org_id
     where t.id = p_team_id and t.status = 'active'
       and t.org_id is not distinct from s.org_id
       and s.org_id is not distinct from a.org_id
       and o.id=s.org_id and o.status='active' and o.archived_at is null
       and s.status='active' and a.status='active' and a.archived_at is null
       and s.access_expires_at is not null
       and s.access_expires_at>now();
    select a.org_id into v_org from climate_vote.assembly a
     where a.id=v_session.assembly_id;
  else
    if p_team_id is not null then raise exception 'HQ token cannot have a team'; end if;
    select s.* into v_session
      from climate_vote.session s
      join climate_vote.assembly a on a.id=s.assembly_id
      join climate_vote.org o on o.id=a.org_id
     where s.slug='0912-deliberation'
       and s.status='active' and a.status='active'
       and s.org_id=a.org_id
       and o.id=s.org_id and o.status='active' and o.archived_at is null
       and a.archived_at is null
       and s.access_expires_at is not null
       and s.access_expires_at>now();
    v_org := v_session.org_id;
  end if;
  if v_session.id is null or v_org is null then
    raise exception 'authorization session/org is not provisioned';
  end if;
  v_expiry:=v_session.access_expires_at;
  if v_expiry is null or v_expiry<=now() then
    raise exception 'workshop access window is not configured or has ended';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into climate_vote.attendance_auth_session
    (token_hash, scope, team_id, actor_label, expires_at, org_id, session_id,
     device_id, device_label, purpose, last_seen_at)
  values
    (encode(digest(v_token, 'sha256'), 'hex'), p_scope, p_team_id,
     left(trim(p_actor_label), 80), v_expiry, v_org, v_session.id,
     v_device, case when p_scope='hq' then 'HQ' else 'legacy' end,
     case when p_scope='hq' then 'hq' else 'attendance' end, now());
  return v_token;
end $fn$;

-- The API edge must overwrite these forwarding headers. When one is present,
-- retain only a one-way hash so public credential attempts cannot be grouped
-- by an attacker-controlled operator name and no raw address is persisted.
create or replace function climate_vote.workshop_request_source_hash()
returns text language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_headers jsonb; v_source text;
begin
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  exception when others then
    return null;
  end;
  v_source:=coalesce(
    nullif(trim(v_headers->>'cf-connecting-ip'),''),
    nullif(trim(v_headers->>'x-real-ip'),''),
    nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for',''),',',1)),'')
  );
  if v_source is null then return null; end if;
  return encode(digest('workshop-source-v1|'||lower(left(v_source,256)),
    'sha256'),'hex');
end $fn$;

-- Preserve the legacy bootstrap call shapes while closing SQL NULL's
-- three-valued comparison bypass. These functions remain the only supported
-- password/PIN gateways before token-scoped reads and mutations are used.
create or replace function climate_vote.attendance_team_unlock(
  p_join_code text, p_pin text)
returns text language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_failures int;
begin
  if p_join_code is null or p_pin is null then
    raise exception 'team attendance credentials required';
  end if;
  select count(*) into v_failures from climate_vote.attendance_auth_attempt
   where scope='team' and subject=p_join_code and not succeeded
     and attempted_at>now()-interval '15 minutes';
  if v_failures>=5 then return null; end if;
  select * into v_team from climate_vote.team
   where join_code=p_join_code and status='active';
  if not found or v_team.attendance_pin_hash is null
     or crypt(p_pin,v_team.attendance_pin_hash)<>v_team.attendance_pin_hash then
    insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded)
    values('team',p_join_code,false);
    return null;
  end if;
  insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded)
  values('team',p_join_code,true);
  return climate_vote.attendance_issue_token(
    'team',v_team.id,'조 모더레이터 · '||v_team.name);
end $fn$;

create or replace function climate_vote.attendance_hq_unlock(
  p_password text, p_actor_label text)
returns text language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_hash text; v_failures int; v_actor text;
begin
  if p_password is null or p_actor_label is null then
    raise exception 'HQ credentials required';
  end if;
  v_actor:=trim(p_actor_label);
  if length(v_actor)<2 or length(v_actor)>80 then
    raise exception 'operator name required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-auth:hq',0));
  select count(*) into v_failures from climate_vote.attendance_auth_attempt
   where scope='hq' and subject='hq' and not succeeded
     and attempted_at>now()-interval '15 minutes';
  if v_failures>=5 then return null; end if;
  select secret_hash into v_hash from climate_vote.attendance_secret
   where secret_key='hq_password';
  if v_hash is null or crypt(p_password,v_hash)<>v_hash then
    insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded)
    values('hq','hq',false);
    return null;
  end if;
  insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded)
  values('hq','hq',true);
  return climate_vote.attendance_issue_token('hq',null,v_actor);
end $fn$;

create or replace function climate_vote.attendance_hq_unlock_named(
  p_operator text, p_password text)
returns text language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_name text; v_hash text; v_active boolean:=false;
  v_source_hash text; v_source_failures int; v_global_failures int;
  v_password_matches boolean;
begin
  if p_operator is null or p_password is null then
    raise exception 'HQ credentials required';
  end if;
  v_name:=trim(p_operator);
  if length(v_name)<2 or length(v_name)>80 then
    raise exception 'operator name required';
  end if;
  v_source_hash:=coalesce(
    climate_vote.workshop_request_source_hash(),
    encode(digest('attendance-hq-source-missing','sha256'),'hex'));
  -- The global lock makes the aggregate bcrypt budget exact even when an
  -- attacker rotates source addresses. The more specific source bucket stops
  -- one address without letting a forged operator name lock that account.
  perform pg_advisory_xact_lock(hashtextextended('attendance-auth:hq-named-global',0));
  perform pg_advisory_xact_lock(hashtextextended(
    'attendance-auth:hq-named-source:'||v_source_hash,0));
  select count(*) into v_source_failures
    from climate_vote.attendance_auth_attempt
   where scope='hq' and source_hash=v_source_hash and not succeeded
     and attempted_at>now()-interval '15 minutes';
  select count(*) into v_global_failures
    from climate_vote.attendance_auth_attempt
   where scope='hq' and source_hash is not null and not succeeded
     and attempted_at>now()-interval '15 minutes';
  if v_source_failures>=20 or v_global_failures>=120 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-auth:'||v_name,0));
  select o.active,s.secret_hash into v_active,v_hash
    from climate_vote.hq_operator o
    left join climate_vote.attendance_secret s on s.secret_key='hq:'||o.name
   where o.name=v_name;
  -- Always execute one bcrypt verification for syntactically valid credentials.
  -- A fixed dummy hash prevents missing/inactive account names from becoming a
  -- cheap timing oracle while the explicit active flag still fails closed.
  v_hash:=coalesce(v_hash,
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
  v_password_matches:=crypt(p_password,v_hash)=v_hash;
  if not coalesce(v_password_matches,false) or not coalesce(v_active,false) then
    insert into climate_vote.attendance_auth_attempt(
      scope,subject,succeeded,source_hash)
    values('hq',v_name,false,v_source_hash);
    return null;
  end if;
  insert into climate_vote.attendance_auth_attempt(
    scope,subject,succeeded,source_hash)
  values('hq',v_name,true,v_source_hash);
  return climate_vote.attendance_issue_token('hq',null,v_name);
end $fn$;

create or replace function climate_vote.hq_change_password(
  p_token text, p_current_password text, p_new_password text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_name text; v_hash text;
  v_revoked int;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  if p_current_password is null or p_new_password is null then
    raise exception 'current and new passwords are required';
  end if;
  v_name:=trim(v_auth.actor_label);
  if not exists(select 1 from climate_vote.hq_operator o
    where o.name=v_name and o.active) then
    raise exception '등록된 운영자만 비밀번호를 바꿀 수 있습니다';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-auth:'||v_name,0));
  select secret_hash into v_hash from climate_vote.attendance_secret
   where secret_key='hq:'||v_name;
  if v_hash is null or crypt(p_current_password,v_hash)<>v_hash then
    insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded)
    values('hq',v_name,false);
    -- Return a typed failure instead of raising: an exception would roll back
    -- the attempt row and silently disable the rate limit.
    return jsonb_build_object(
      'name',v_name,'changed',false,'error','current_password_incorrect');
  end if;
  if length(p_new_password)<8 then
    raise exception '새 비밀번호는 8자 이상이어야 합니다';
  end if;
  if p_new_password=p_current_password then
    raise exception '지금과 다른 비밀번호를 정해 주세요';
  end if;
  update climate_vote.attendance_secret
     set secret_hash=crypt(p_new_password,gen_salt('bf',10)),updated_at=now()
   where secret_key='hq:'||v_name;
  update climate_vote.hq_operator set must_change_password=false where name=v_name;
  insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded)
  values('hq',v_name,true);
  -- The credential is global for this named operator. A successful password
  -- change therefore invalidates every outstanding HQ bearer for that actor,
  -- including the token used for this request and tokens on other devices.
  update climate_vote.attendance_auth_session
     set revoked_at=now()
   where scope='hq' and actor_label=v_name and revoked_at is null;
  get diagnostics v_revoked = row_count;
  perform climate_vote.workshop_audit(
    v_auth.org_id,v_auth.session_id,null,v_auth.id,null,
    'hq_password_changed','hq',v_name,
    jsonb_build_object('credential_version','previous'),
    jsonb_build_object('credential_version','rotated','sessions_revoked',v_revoked));
  return jsonb_build_object(
    'name',v_name,'changed',true,'sessions_revoked',v_revoked);
end $fn$;

create or replace function climate_vote.workshop_hq_logout_v2(p_token text)
returns boolean language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_revoked int;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;

  update climate_vote.attendance_auth_session
     set revoked_at=now()
   where token_hash=encode(digest(lower(p_token),'sha256'),'hex')
     and scope='hq' and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return v_revoked=1;
end $fn$;

-- Team logout is a server-side revocation, not a local-storage hint. Lock the
-- exact live bearer after full team/session validation so a second token for
-- the same team remains usable and a replay fails through attendance_token_row.
create or replace function climate_vote.workshop_team_logout_v2(p_token text)
returns boolean language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_team climate_vote.team;
  v_revoked int;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_team:=climate_vote.team_token_row(p_token);
  if v_auth.scope<>'team' or v_auth.purpose<>'workshop'
     or v_auth.team_id is distinct from v_team.id then
    raise exception 'team workshop authorization required';
  end if;
  select s.* into v_auth from climate_vote.attendance_auth_session s
   where s.id=v_auth.id
     and s.token_hash=encode(extensions.digest(lower(p_token),'sha256'),'hex')
     and s.scope='team' and s.purpose='workshop'
     and s.team_id=v_team.id and s.session_id=v_team.session_id
     and s.org_id=v_team.org_id and s.revoked_at is null and s.expires_at>now()
   for update;
  if not found then raise exception 'workshop authorization expired or revoked'; end if;
  update climate_vote.attendance_auth_session
     set revoked_at=now()
   where id=v_auth.id and revoked_at is null;
  get diagnostics v_revoked=row_count;
  if v_revoked<>1 then raise exception 'workshop authorization expired or revoked'; end if;
  perform climate_vote.workshop_audit(
    v_team.org_id,v_team.session_id,v_team.id,v_auth.id,null,
    'device_logged_out','team',v_auth.actor_label,
    jsonb_build_object('device_id',v_auth.device_id,'status','active'),
    jsonb_build_object('device_id',v_auth.device_id,'status','revoked'));
  return true;
end $fn$;

-- PIN remains closed by the production revoke migration. HQ bootstrap and
-- password-change entry points are explicit PostgREST calls, never PUBLIC.
revoke execute on function climate_vote.attendance_team_unlock(text,text)
from public, anon, authenticated;
revoke execute on function
  climate_vote.attendance_hq_unlock(text,text),
  climate_vote.attendance_hq_unlock_named(text,text),
  climate_vote.hq_change_password(text,text,text),
  climate_vote.workshop_hq_logout_v2(text)
from public;
grant execute on function
  climate_vote.attendance_hq_unlock(text,text),
  climate_vote.attendance_hq_unlock_named(text,text),
  climate_vote.hq_change_password(text,text,text),
  climate_vote.workshop_hq_logout_v2(text)
to anon, authenticated;

create or replace function climate_vote.workshop_random_join_code(p_excluded text[])
returns text language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_bytes bytea; v_number bigint; v_code text; i int;
begin
  for i in 1..100 loop
    v_bytes:=gen_random_bytes(4);
    v_number:=get_byte(v_bytes,0)::bigint*16777216
      +get_byte(v_bytes,1)::bigint*65536
      +get_byte(v_bytes,2)::bigint*256
      +get_byte(v_bytes,3)::bigint;
    v_code:=lpad((v_number%1000000)::text,6,'0');
    if v_code !~ '^0912(0[1-9]|1[0-5])$'
       and not (v_code=any(coalesce(p_excluded,array[]::text[])))
       and not exists(select 1 from climate_vote.team where join_code=v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'could not allocate a unique join code';
end $fn$;

create or replace function climate_vote.workshop_random_join_code()
returns text language sql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
  select climate_vote.workshop_random_join_code(array[]::text[]);
$fn$;

alter table climate_vote.team
  alter column join_code set default climate_vote.workshop_random_join_code();

create or replace function climate_vote.team_token_row(p_token text)
returns climate_vote.team language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_team climate_vote.team;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'team' or v_auth.purpose <> 'workshop'
     or v_auth.team_id is null or v_auth.session_id is null
     or v_auth.org_id is null or v_auth.device_id is null then
    raise exception 'team authorization required';
  end if;
  select t.* into v_team from climate_vote.team t
    join climate_vote.session s on s.id = t.session_id
    join climate_vote.assembly a on a.id=s.assembly_id
    join climate_vote.org o on o.id=a.org_id
   where t.id = v_auth.team_id and t.status = 'active'
     and t.session_id = v_auth.session_id
     and t.org_id = v_auth.org_id and s.org_id = v_auth.org_id
     and a.org_id = v_auth.org_id and o.id=v_auth.org_id
     and o.status='active' and o.archived_at is null
     and a.status='active' and a.archived_at is null and s.status='active'
     and s.access_expires_at is not null and s.access_expires_at>now();
  if not found then raise exception 'team authorization scope mismatch'; end if;
  return v_team;
end $fn$;

create or replace function climate_vote.workshop_hq_session_row(
  p_token text, p_session_slug text)
returns climate_vote.session language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' or v_auth.purpose <> 'hq'
     or v_auth.session_id is null or v_auth.org_id is null then
    raise exception 'HQ authorization required';
  end if;
  select s.* into v_session from climate_vote.session s
    join climate_vote.assembly a on a.id=s.assembly_id
    join climate_vote.org o on o.id=a.org_id
   where s.slug = p_session_slug and s.id = v_auth.session_id
     and s.org_id = v_auth.org_id and a.org_id=v_auth.org_id
     and o.id=v_auth.org_id and o.status='active' and o.archived_at is null
     and a.status='active' and a.archived_at is null and s.status='active'
     and s.access_expires_at is not null and s.access_expires_at>now();
  if not found then raise exception 'HQ authorization session mismatch'; end if;
  return v_session;
end $fn$;

create or replace function climate_vote.mod_exchange_join_code(
  p_join_code text, p_device_id uuid, p_device_label text default null)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_team climate_vote.team; v_session climate_vote.session;
  v_device_failures int; v_source_failures int; v_source_hour_failures int;
  v_devices int; v_token text; v_expiry timestamptz;
  v_source_hash text:=climate_vote.workshop_request_source_hash();
  v_label text := left(coalesce(nullif(trim(p_device_label),''),'기기'), 80);
begin
  if p_device_id is null then raise exception 'device id required'; end if;
  -- Count, decision, and failure recording must be one serialized bucket
  -- operation. Otherwise parallel invalid requests can all observe a count
  -- below the limit before any of them records its failure.
  perform pg_advisory_xact_lock(hashtextextended(
    'workshop-join:'||coalesce(v_source_hash,'device:'||p_device_id::text),0));
  select count(*) into v_device_failures
    from climate_vote.workshop_join_exchange_attempt
   where device_id=p_device_id and not succeeded
     and attempted_at > now() - interval '15 minutes';
  if v_device_failures >= 5 then return null; end if;
  if v_source_hash is not null then
    select count(*) into v_source_failures
      from climate_vote.workshop_join_exchange_attempt
     where source_hash=v_source_hash and not succeeded
       and attempted_at > now() - interval '15 minutes';
    select count(*) into v_source_hour_failures
      from climate_vote.workshop_join_exchange_attempt
     where source_hash=v_source_hash and not succeeded
       and attempted_at > now() - interval '1 hour';
    -- Venue NATs may legitimately bootstrap 15 teams x two devices. Successful
    -- exchanges never consume these failure budgets; five global failures would
    -- let one typo-prone device deny the whole room.
    if v_source_failures >= 60 or v_source_hour_failures >= 180 then return null; end if;
  end if;

  if p_join_code is null or p_join_code !~ '^[0-9]{6}$' then
    insert into climate_vote.workshop_join_exchange_attempt
      (device_id,source_hash,succeeded)
    values (p_device_id,v_source_hash,false);
    return null;
  end if;

  -- The team row lock serializes device revoke/count/insert across concurrent
  -- source and device buckets until this transaction ends.
  select t.* into v_team from climate_vote.team t
    join climate_vote.session s on s.id=t.session_id
    join climate_vote.assembly a on a.id=s.assembly_id
    join climate_vote.org o on o.id=a.org_id
   where t.join_code=p_join_code and t.status='active'
     and t.org_id=s.org_id and s.org_id=a.org_id and a.org_id=o.id
     and o.status='active' and o.archived_at is null
     and a.status='active' and a.archived_at is null and s.status='active'
     and s.access_expires_at is not null and s.access_expires_at>now()
   for update of t;
  if not found then
    insert into climate_vote.workshop_join_exchange_attempt
      (device_id,source_hash,succeeded)
    values (p_device_id,v_source_hash,false);
    return null;
  end if;
  select * into v_session from climate_vote.session s where s.id=v_team.session_id;
  if v_team.org_id is null or v_session.org_id is null or v_team.org_id <> v_session.org_id then
    raise exception 'team session/org is not provisioned';
  end if;
  perform 1 from climate_vote.assembly a
   where a.id=v_session.assembly_id and a.org_id=v_team.org_id;
  if not found then raise exception 'team assembly/org is not provisioned'; end if;
  v_expiry:=v_session.access_expires_at;
  if v_expiry is null or v_expiry<=now() then
    raise exception 'workshop access window is not configured or has ended';
  end if;
  if v_session.held_on is not null
     and p_join_code ~ ('^'||to_char(v_session.held_on,'MMDD')||'(0[1-9]|1[0-5])$') then
    raise exception 'workshop join codes must be rotated before token exchange';
  end if;

  -- Reissuing on the same browser rotates its token without consuming another slot.
  update climate_vote.attendance_auth_session
     set revoked_at=now()
   where scope='team' and purpose='workshop'
     and team_id=v_team.id and session_id=v_session.id
     and device_id=p_device_id and revoked_at is null;
  select count(distinct device_id) into v_devices
    from climate_vote.attendance_auth_session
   where scope='team' and purpose='workshop'
     and team_id=v_team.id and session_id=v_session.id
     and revoked_at is null and expires_at > now() and device_id is not null;
  if v_devices >= 2 then raise exception 'this team already has two active devices'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into climate_vote.attendance_auth_session
    (token_hash, scope, team_id, actor_label, expires_at, org_id, session_id,
     device_id, device_label, purpose, last_seen_at)
  values
    (encode(digest(v_token,'sha256'),'hex'), 'team', v_team.id,
     '조 모더레이터 · '||v_team.name, v_expiry, v_team.org_id, v_session.id,
     p_device_id, v_label, 'workshop', now());
  insert into climate_vote.workshop_join_exchange_attempt
    (device_id,source_hash,succeeded,org_id,session_id,team_id)
  values (p_device_id,v_source_hash,true,v_team.org_id,v_session.id,v_team.id);

  perform climate_vote.workshop_audit(
    v_team.org_id, v_session.id, v_team.id,
    (select id from climate_vote.attendance_auth_session
      where token_hash=encode(digest(v_token,'sha256'),'hex')),
    null, 'device_authorized', 'team', '조 모더레이터 · '||v_team.name,
    null, jsonb_build_object('device_label',v_label,'expires_at',v_expiry));

  return jsonb_build_object(
    'v',1, 'accessToken',v_token, 'expiresAt',v_expiry,
    'deviceId',p_device_id, 'deviceLabel',v_label,
    'sessionId',v_session.id, 'sessionSlug',v_session.slug,
    'team',jsonb_build_object('id',v_team.id,'name',v_team.name,
      'subgroup',v_team.subgroup,'capacity',v_team.capacity,'table_no',v_team.table_no));
end $fn$;

create or replace function climate_vote.mod_session_get(p_token text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_team climate_vote.team;
  v_session climate_vote.session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  v_team := climate_vote.team_token_row(p_token);
  select * into v_session from climate_vote.session
   where id=v_auth.session_id and org_id=v_auth.org_id;
  if not found then raise exception 'team authorization scope mismatch'; end if;
  return jsonb_build_object(
    'v',1, 'accessToken',p_token, 'expiresAt',v_auth.expires_at,
    'deviceId',v_auth.device_id, 'deviceLabel',v_auth.device_label,
    'deviceStatus','active', 'sessionId',v_session.id, 'sessionSlug',v_session.slug,
    'team',jsonb_build_object('id',v_team.id,'name',v_team.name,
      'subgroup',v_team.subgroup,'capacity',v_team.capacity,'table_no',v_team.table_no));
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. Session-scoped attendance and HQ compatibility surface
--
-- The historical attendance_* and hq_* functions checked only the token's
-- broad scope. An HQ token could therefore supply another session slug or a
-- foreign assignment/submission id. These v2 adapters keep the field UX and
-- response shapes but bind every query and mutation to the token's canonical
-- org/session (and, for team tokens, its team).
-- ---------------------------------------------------------------------------

create or replace function climate_vote.attendance_scope_session_row(
  p_token text, p_session_slug text)
returns climate_vote.session language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  if v_auth.session_id is null or v_auth.org_id is null then
    raise exception 'attendance authorization is not session scoped';
  end if;
  if v_auth.scope='hq' then
    return climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  end if;
  if v_auth.scope<>'team' or v_auth.purpose not in ('attendance','workshop')
     or v_auth.team_id is null then
    raise exception 'attendance authorization required';
  end if;
  select s.* into v_session from climate_vote.session s
    join climate_vote.assembly a on a.id=s.assembly_id
    join climate_vote.org o on o.id=a.org_id
   where s.id=v_auth.session_id and s.slug=p_session_slug
     and s.org_id=v_auth.org_id and a.org_id=v_auth.org_id and o.id=v_auth.org_id
     and o.status='active' and o.archived_at is null
     and a.status='active' and a.archived_at is null and s.status='active'
     and s.access_expires_at is not null and s.access_expires_at>now();
  if not found then raise exception 'attendance authorization session mismatch'; end if;
  perform 1 from climate_vote.team t
   where t.id=v_auth.team_id and t.session_id=v_session.id
     and t.org_id=v_session.org_id and t.status='active';
  if not found then raise exception 'attendance authorization team mismatch'; end if;
  return v_session;
end $fn$;

create or replace function climate_vote.attendance_round_eligible_count_v2(
  p_token text, p_round_id text)
returns int language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  if p_round_id is null or length(trim(p_round_id))=0 then
    raise exception 'round id required';
  end if;
  v_team:=climate_vote.team_token_row(p_token);
  perform 1 from climate_vote.rounds r
   where r.id=p_round_id and r.team_id=v_team.id
     and r.session_id=v_team.session_id and r.org_id=v_team.org_id;
  if not found then raise exception 'round not in token team/session scope'; end if;
  return climate_vote.attendance_round_eligible_count(p_round_id);
end $fn$;

create or replace function climate_vote.attendance_roster_v2(
  p_token text, p_session_slug text)
returns table(
  assignment_id uuid, member_id uuid, official_id text, member_name text,
  team_id uuid, team_name text, active boolean, base_status text,
  checked_in_at timestamptz, is_late boolean, checked_out_at timestamptz,
  is_early_leave boolean, updated_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.attendance_scope_session_row(p_token,p_session_slug);
  return query
  select ta.id,m.id,m.official_id,m.name,t.id,t.name,
    (ta.active and m.active),a.base_status,a.checked_in_at,a.is_late,
    a.checked_out_at,a.is_early_leave,greatest(a.updated_at,ta.updated_at,m.updated_at)
  from climate_vote.team_assignment ta
  join climate_vote.assembly_member m on m.id=ta.member_id
    and m.org_id=v_session.org_id
  join climate_vote.team t on t.id=ta.team_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
  join climate_vote.attendance a on a.assignment_id=ta.id
    and a.org_id=v_session.org_id
  where ta.session_id=v_session.id and ta.org_id=v_session.org_id
    and (v_auth.scope='hq' or ta.team_id=v_auth.team_id)
  order by t.name,
    nullif(regexp_replace(m.official_id,'\D','','g'),'')::int nulls last,
    m.official_id;
end $fn$;

create or replace function climate_vote.attendance_hq_summary_v2(
  p_token text, p_session_slug text)
returns table(team_id uuid,roster_total int,current_present int,late int,
  absent int,early_leave int,unconfirmed int)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select t.id,
    count(ta.id) filter(where ta.active and m.active)::int,
    count(a.id) filter(where ta.active and m.active and a.base_status='present'
      and a.checked_out_at is null)::int,
    count(a.id) filter(where ta.active and m.active and a.is_late)::int,
    count(a.id) filter(where ta.active and m.active and a.base_status='absent')::int,
    count(a.id) filter(where ta.active and m.active and a.is_early_leave)::int,
    count(a.id) filter(where ta.active and m.active and a.base_status='unconfirmed')::int
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id=t.id
    and ta.session_id=v_session.id and ta.org_id=v_session.org_id
  left join climate_vote.assembly_member m on m.id=ta.member_id
    and m.org_id=v_session.org_id
  left join climate_vote.attendance a on a.assignment_id=ta.id
    and a.org_id=v_session.org_id
  where t.session_id=v_session.id and t.org_id=v_session.org_id and t.status='active'
  group by t.id;
end $fn$;

create or replace function climate_vote.attendance_set_v2(
  p_token text, p_session_slug text, p_assignment_id uuid,
  p_action text, p_occurred_at timestamptz default now())
returns void language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_assignment climate_vote.team_assignment; v_before jsonb; v_after jsonb;
begin
  if p_action is null or p_action not in ('unconfirmed','present','late','absent','early_leave') then
    raise exception 'invalid attendance action';
  end if;
  if p_action in ('present','late','early_leave') and p_occurred_at is null then
    raise exception 'attendance occurrence time required';
  end if;
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.attendance_scope_session_row(p_token,p_session_slug);
  select ta.* into v_assignment from climate_vote.team_assignment ta
    join climate_vote.team t on t.id=ta.team_id
   where ta.id=p_assignment_id and ta.active
     and ta.session_id=v_session.id and ta.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
     and (v_auth.scope='hq' or ta.team_id=v_auth.team_id)
   for update of ta;
  if not found then raise exception 'assignment outside attendance scope'; end if;
  select to_jsonb(a) into v_before from climate_vote.attendance a
   where a.assignment_id=p_assignment_id and a.org_id=v_session.org_id for update;
  if not found then raise exception 'attendance row outside attendance scope'; end if;

  if p_action='unconfirmed' then
    update climate_vote.attendance set base_status='unconfirmed',checked_in_at=null,
      is_late=false,checked_out_at=null,is_early_leave=false,updated_at=now()
     where assignment_id=p_assignment_id and org_id=v_session.org_id;
  elsif p_action='absent' then
    update climate_vote.attendance set base_status='absent',checked_in_at=null,
      is_late=false,checked_out_at=null,is_early_leave=false,updated_at=now()
     where assignment_id=p_assignment_id and org_id=v_session.org_id;
  elsif p_action='early_leave' then
    update climate_vote.attendance set base_status='present',
      checked_in_at=coalesce(checked_in_at,p_occurred_at),checked_out_at=p_occurred_at,
      is_early_leave=true,updated_at=now()
     where assignment_id=p_assignment_id and org_id=v_session.org_id;
  else
    update climate_vote.attendance set base_status='present',checked_in_at=p_occurred_at,
      is_late=(p_action='late'),checked_out_at=null,is_early_leave=false,updated_at=now()
     where assignment_id=p_assignment_id and org_id=v_session.org_id;
  end if;
  select to_jsonb(a) into v_after from climate_vote.attendance a
   where a.assignment_id=p_assignment_id and a.org_id=v_session.org_id;
  insert into climate_vote.attendance_audit_log
    (org_id,session_id,team_id,assignment_id,action,before_value,after_value,
     actor_scope,actor_label)
  values(v_session.org_id,v_session.id,v_assignment.team_id,p_assignment_id,
    'attendance.'||p_action,v_before,v_after,v_auth.scope,v_auth.actor_label);
end $fn$;

create or replace function climate_vote.attendance_bulk_present_v2(
  p_token text, p_session_slug text, p_assignment_ids uuid[])
returns int language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_id uuid; v_count int:=0;
begin
  perform climate_vote.attendance_scope_session_row(p_token,p_session_slug);
  if coalesce(array_length(p_assignment_ids,1),0)>200 then
    raise exception 'bulk attendance limit exceeded';
  end if;
  foreach v_id in array coalesce(p_assignment_ids,array[]::uuid[]) loop
    perform climate_vote.attendance_set_v2(p_token,p_session_slug,v_id,'present',now());
    v_count:=v_count+1;
  end loop;
  return v_count;
end $fn$;

create or replace function climate_vote.attendance_finalize_absent_v2(
  p_token text, p_session_slug text)
returns int language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_id uuid; v_count int:=0;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.attendance_scope_session_row(p_token,p_session_slug);
  for v_id in
    select a.assignment_id from climate_vote.attendance a
    join climate_vote.team_assignment ta on ta.id=a.assignment_id
    join climate_vote.team t on t.id=ta.team_id
    where a.base_status='unconfirmed' and a.org_id=v_session.org_id
      and ta.active and ta.session_id=v_session.id and ta.org_id=v_session.org_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
      and (v_auth.scope='hq' or ta.team_id=v_auth.team_id)
  loop
    perform climate_vote.attendance_set_v2(p_token,p_session_slug,v_id,'absent',now());
    v_count:=v_count+1;
  end loop;
  return v_count;
end $fn$;

create or replace function climate_vote.attendance_member_save_v2(
  p_token text, p_session_slug text, p_assignment_id uuid,
  p_official_id text, p_name text, p_team_id uuid default null,
  p_active boolean default true)
returns uuid language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_assignment climate_vote.team_assignment; v_member climate_vote.assembly_member;
  v_target_team uuid; v_before jsonb; v_after jsonb;
begin
  if p_official_id is null or p_name is null
     or length(trim(p_official_id)) not between 1 and 40
     or length(trim(p_name)) not between 1 and 100 then
    raise exception 'invalid member fields';
  end if;
  if p_active is null then raise exception 'member active flag required'; end if;
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.attendance_scope_session_row(p_token,p_session_slug);
  if p_assignment_id is null then
    v_target_team:=case when v_auth.scope='team' then v_auth.team_id else p_team_id end;
    perform 1 from climate_vote.team t
     where t.id=v_target_team and t.session_id=v_session.id
       and t.org_id=v_session.org_id and t.status='active';
    if not found then raise exception 'target team outside attendance scope'; end if;
    insert into climate_vote.assembly_member(official_id,name,active,source_hash,org_id)
    values(trim(p_official_id),trim(p_name),p_active,'manual',v_session.org_id)
    returning * into v_member;
    insert into climate_vote.team_assignment
      (session_id,team_id,member_id,active,org_id)
    values(v_session.id,v_target_team,v_member.id,p_active,v_session.org_id)
    returning * into v_assignment;
    insert into climate_vote.attendance(assignment_id,base_status,org_id)
    values(v_assignment.id,'unconfirmed',v_session.org_id);
    v_before:=null;
  else
    select ta.* into v_assignment from climate_vote.team_assignment ta
      join climate_vote.team t on t.id=ta.team_id
     where ta.id=p_assignment_id and ta.session_id=v_session.id
       and ta.org_id=v_session.org_id and t.session_id=v_session.id
       and t.org_id=v_session.org_id
       and (v_auth.scope='hq' or ta.team_id=v_auth.team_id)
     for update of ta;
    if not found then raise exception 'assignment outside attendance scope'; end if;
    select * into v_member from climate_vote.assembly_member m
     where m.id=v_assignment.member_id and m.org_id=v_session.org_id for update;
    if not found then raise exception 'member outside attendance scope'; end if;
    v_before:=jsonb_build_object('member',to_jsonb(v_member),'assignment',to_jsonb(v_assignment));
    v_target_team:=case when v_auth.scope='hq' then coalesce(p_team_id,v_assignment.team_id)
                        else v_assignment.team_id end;
    perform 1 from climate_vote.team t
     where t.id=v_target_team and t.session_id=v_session.id
       and t.org_id=v_session.org_id and t.status='active';
    if not found then raise exception 'target team outside attendance scope'; end if;
    update climate_vote.assembly_member set official_id=trim(p_official_id),
      name=trim(p_name),active=case when v_auth.scope='hq' then p_active else active end,
      updated_at=now()
     where id=v_member.id and org_id=v_session.org_id returning * into v_member;
    update climate_vote.team_assignment set team_id=v_target_team,active=p_active,
      updated_at=now()
     where id=v_assignment.id and session_id=v_session.id and org_id=v_session.org_id
     returning * into v_assignment;
  end if;
  v_after:=jsonb_build_object('member',to_jsonb(v_member),'assignment',to_jsonb(v_assignment));
  insert into climate_vote.attendance_audit_log
    (org_id,session_id,team_id,assignment_id,action,before_value,after_value,
     actor_scope,actor_label)
  values(v_session.org_id,v_session.id,v_assignment.team_id,v_assignment.id,
    case when p_assignment_id is null then 'member.add' else 'member.update' end,
    v_before,v_after,v_auth.scope,v_auth.actor_label);
  return v_assignment.id;
end $fn$;

create or replace function climate_vote.attendance_hq_audit_v2(
  p_token text, p_session_slug text, p_limit int default 200)
returns table(id bigint,team_id uuid,team_name text,assignment_id uuid,action text,
  before_value jsonb,after_value jsonb,actor_label text,created_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select l.id,l.team_id,t.name,l.assignment_id,l.action,l.before_value,l.after_value,
    l.actor_label,l.created_at
  from climate_vote.attendance_audit_log l
  left join climate_vote.team t on t.id=l.team_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
  where l.session_id=v_session.id and l.org_id=v_session.org_id
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit,200),1),500);
end $fn$;

create or replace function climate_vote.attendance_hq_set_team_pin_v2(
  p_token text, p_session_slug text, p_team_id uuid, p_pin text)
returns void language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_pin is null or p_pin !~ '^[0-9]{6,10}$' then
    raise exception 'PIN must be 6 to 10 digits';
  end if;
  update climate_vote.team set attendance_pin_hash=crypt(p_pin,gen_salt('bf',10))
   where id=p_team_id and session_id=v_session.id and org_id=v_session.org_id
     and status='active';
  if not found then raise exception 'team outside HQ session scope'; end if;
  insert into climate_vote.attendance_audit_log
    (org_id,session_id,team_id,action,before_value,after_value,actor_scope,actor_label)
  values(v_session.org_id,v_session.id,p_team_id,'team.pin.rotate',null,null,
    'hq',v_auth.actor_label);
end $fn$;

create or replace function climate_vote.attendance_hq_set_table_no_v2(
  p_token text, p_session_slug text, p_team_id uuid, p_table_no text)
returns void language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_team climate_vote.team; v_value text:=nullif(btrim(coalesce(p_table_no,'')),'');
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if v_value is not null and length(v_value)>20 then raise exception 'table number too long'; end if;
  select * into v_team from climate_vote.team t
   where t.id=p_team_id and t.session_id=v_session.id and t.org_id=v_session.org_id
     and t.status='active' for update;
  if not found then raise exception 'team outside HQ session scope'; end if;
  update climate_vote.team set table_no=v_value
   where id=v_team.id and session_id=v_session.id and org_id=v_session.org_id;
  insert into climate_vote.attendance_audit_log
    (org_id,session_id,team_id,assignment_id,action,before_value,after_value,
     actor_scope,actor_label)
  values(v_session.org_id,v_session.id,v_team.id,null,'team.table_no',
    jsonb_build_object('table_no',v_team.table_no),jsonb_build_object('table_no',v_value),
    'hq',v_auth.actor_label);
end $fn$;

-- The legacy HQ grid mixed an unscoped hq_teams() call with direct anonymous
-- reads from rounds/votes. Keep the same response shapes, but make HQ reads
-- prove the token-bound session and make team reads prove the token-bound team.
create or replace function climate_vote.hq_teams_v2(
  p_token text, p_session_slug text)
returns table(id uuid,name text,subgroup text,capacity int,status text,table_no text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select t.id,t.name,t.subgroup,
    coalesce(nullif(count(ta.id) filter(where ta.active and m.active),0),t.capacity)::int,
    t.status,t.table_no
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id=t.id
    and ta.session_id=v_session.id and ta.org_id=v_session.org_id
  left join climate_vote.assembly_member m on m.id=ta.member_id
    and m.org_id=v_session.org_id
  where t.session_id=v_session.id and t.org_id=v_session.org_id
  group by t.id,t.name,t.subgroup,t.capacity,t.status,t.table_no;
end $fn$;

create or replace function climate_vote.hq_rounds_v2(
  p_token text, p_session_slug text)
returns setof climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select r.* from climate_vote.rounds r
  join climate_vote.team t on t.id=r.team_id
   and t.session_id=v_session.id and t.org_id=v_session.org_id
  order by r.created_at desc;
end $fn$;

create or replace function climate_vote.hq_vote_counts_v2(
  p_token text, p_session_slug text, p_round_ids text[])
returns table(round_id text,vote_count int) language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if coalesce(cardinality(p_round_ids),0)>200 then raise exception 'round read limit exceeded'; end if;
  if exists(
    select 1 from (select distinct unnest(p_round_ids) as id) requested
    where requested.id is null or not exists(
      select 1 from climate_vote.rounds r join climate_vote.team t on t.id=r.team_id
       where r.id=requested.id and t.session_id=v_session.id and t.org_id=v_session.org_id
    )
  ) then raise exception 'round outside HQ session scope'; end if;
  return query
  with requested as(select distinct unnest(coalesce(p_round_ids,array[]::text[])) as id)
  select requested.id,count(v.id) filter(where v.archived_at is null)::int
  from requested
  join climate_vote.rounds r on r.id=requested.id
  join climate_vote.team t on t.id=r.team_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
  left join climate_vote.votes v on v.round_id=r.id and v.org_id=v_session.org_id
  group by requested.id;
end $fn$;

create or replace function climate_vote.hq_votes_v2(
  p_token text, p_session_slug text, p_round_ids text[])
returns table(id bigint,round_id text,choice jsonb,archived_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if coalesce(cardinality(p_round_ids),0)>200 then raise exception 'round read limit exceeded'; end if;
  if exists(
    select 1 from (select distinct unnest(p_round_ids) as id) requested
    where requested.id is null or not exists(
      select 1 from climate_vote.rounds r join climate_vote.team t on t.id=r.team_id
       where r.id=requested.id and t.session_id=v_session.id and t.org_id=v_session.org_id
    )
  ) then raise exception 'round outside HQ session scope'; end if;
  return query
  select v.id,v.round_id,v.choice,v.archived_at
  from climate_vote.votes v
  join climate_vote.rounds r on r.id=v.round_id
  join climate_vote.team t on t.id=r.team_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
  where v.round_id=any(coalesce(p_round_ids,array[]::text[]))
    and v.org_id=v_session.org_id and v.archived_at is null;
end $fn$;

create or replace function climate_vote.mod_rounds_v2(p_token text)
returns setof climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  v_team:=climate_vote.team_token_row(p_token);
  return query select r.* from climate_vote.rounds r
   where r.team_id=v_team.id order by r.created_at desc;
end $fn$;

create or replace function climate_vote.mod_session_teams_v2(p_token text)
returns table(id uuid,name text,subgroup text,capacity int,status text,table_no text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  v_team:=climate_vote.team_token_row(p_token);
  return query select t.id,t.name,t.subgroup,t.capacity,t.status,t.table_no
    from climate_vote.team t
   where t.session_id=v_team.session_id and t.org_id=v_team.org_id and t.status='active';
end $fn$;

create or replace function climate_vote.mod_vote_counts_v2(
  p_token text, p_round_ids text[])
returns table(round_id text,vote_count int) language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  v_team:=climate_vote.team_token_row(p_token);
  if coalesce(cardinality(p_round_ids),0)>200 then raise exception 'round read limit exceeded'; end if;
  if exists(
    select 1 from (select distinct unnest(p_round_ids) as id) requested
    where requested.id is null or not exists(
      select 1 from climate_vote.rounds r where r.id=requested.id and r.team_id=v_team.id
    )
  ) then raise exception 'round outside team scope'; end if;
  return query
  with requested as(select distinct unnest(coalesce(p_round_ids,array[]::text[])) as id)
  select requested.id,count(v.id) filter(where v.archived_at is null)::int
  from requested join climate_vote.rounds r on r.id=requested.id and r.team_id=v_team.id
  left join climate_vote.votes v on v.round_id=r.id and v.org_id=v_team.org_id
  group by requested.id;
end $fn$;

create or replace function climate_vote.mod_votes_v2(
  p_token text, p_round_id text)
returns table(id bigint,round_id text,choice jsonb,archived_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team;
begin
  v_team:=climate_vote.team_token_row(p_token);
  perform 1 from climate_vote.rounds r where r.id=p_round_id and r.team_id=v_team.id;
  if not found then raise exception 'round outside team scope'; end if;
  return query select v.id,v.round_id,v.choice,v.archived_at
    from climate_vote.votes v
   where v.round_id=p_round_id and v.org_id=v_team.org_id;
end $fn$;

-- A public vote link is a narrow round-id capability. These wrappers replace
-- broad anonymous table SELECT/INSERT while preserving the voter experience.
create or replace function climate_vote.public_round_get_v2(p_round_id text)
returns table(id text,title text,description text,type text,options jsonb,status text,
  scale_low int,scale_high int,scale_low_label text,scale_high_label text,
  created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
begin
  return query select r.id,r.title,r.description,r.type,r.options,r.status,
    r.scale_low,r.scale_high,r.scale_low_label,r.scale_high_label,r.created_at,r.updated_at
    from climate_vote.rounds r
    left join climate_vote.team t on t.id=r.team_id
    left join climate_vote.session s on s.id=r.session_id
    left join climate_vote.org o on o.id=r.org_id
   where r.id=p_round_id and (
     (o.status='active' and r.team_id is not null and t.id=r.team_id and t.status='active'
       and t.session_id=r.session_id and t.org_id=r.org_id)
     or (o.status='active' and r.team_id is null and r.session_id is not null
       and s.id=r.session_id and s.org_id=r.org_id and s.status<>'archived')
     or (r.team_id is null and r.session_id is null and r.org_id is null)
   ) limit 1;
end $fn$;

create or replace function climate_vote.public_round_votes_v2(p_round_id text)
returns table(choice jsonb,vote_count int,total_votes int,average_score numeric)
language plpgsql stable security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_round climate_vote.rounds;
begin
  select r.* into v_round from climate_vote.rounds r
    left join climate_vote.team t on t.id=r.team_id
    left join climate_vote.session s on s.id=r.session_id
    left join climate_vote.org o on o.id=r.org_id
   where r.id=p_round_id and r.status='closed' and (
     (o.status='active' and r.team_id is not null and t.id=r.team_id and t.status='active'
       and t.session_id=r.session_id and t.org_id=r.org_id)
     or (o.status='active' and r.team_id is null and r.session_id is not null
       and s.id=r.session_id and s.org_id=r.org_id and s.status<>'archived')
     or (r.team_id is null and r.session_id is null and r.org_id is null)
   );
  if not found then raise exception 'closed public round required'; end if;
  if v_round.type='TEXT' then
    return query
    select to_jsonb('응답'::text),count(*)::int,count(*)::int,null::numeric
      from climate_vote.votes v
     where v.round_id=v_round.id
       and (v_round.org_id is null or v.org_id=v_round.org_id)
       and v.archived_at is null;
    return;
  end if;
  if v_round.type='SCALE_MULTI' then
    return query
    with live as(
      select v.choice as raw_choice from climate_vote.votes v
       where v.round_id=v_round.id
         and (v_round.org_id is null or v.org_id=v_round.org_id)
         and v.archived_at is null
    ), scores as(
      select item.key,item.value from live l
      cross join lateral jsonb_each(l.raw_choice) item
    )
    select to_jsonb(scores.key),count(*)::int,(select count(*)::int from live),
      round(avg((scores.value#>>'{}')::numeric),2)
    from scores group by scores.key order by scores.key;
    return;
  end if;
  return query
  with live as(
    select v.choice as raw_choice from climate_vote.votes v
    where v.round_id=v_round.id
      and (v_round.org_id is null or v.org_id=v_round.org_id)
      and v.archived_at is null
  ), expanded as(
    select l.raw_choice from live l where v_round.type<>'CHECKBOX'
    union all
    select selected from live l
    cross join lateral jsonb_array_elements(l.raw_choice) selected
    where v_round.type='CHECKBOX'
  )
  select e.raw_choice,count(*)::int,(select count(*)::int from live),null::numeric
  from expanded e group by e.raw_choice order by e.raw_choice::text;
end $fn$;

-- Read-only round metadata and already-closed aggregate results remain separate
-- historical capabilities. A write is stricter: every scoped round must still
-- belong to an active org/assembly/session with an explicit future hard expiry.
create or replace function climate_vote.public_round_cast_v2(
  p_round_id text, p_choice jsonb, p_client_id text)
returns text language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_round climate_vote.rounds;
begin
  if p_choice is null then raise exception 'public vote choice required'; end if;
  if length(trim(coalesce(p_client_id,''))) not between 1 and 200 then
    raise exception 'client id required';
  end if;
  select r.* into v_round from climate_vote.rounds r
    left join climate_vote.team t on t.id=r.team_id
    left join climate_vote.session s on s.id=r.session_id
    left join climate_vote.assembly a on a.id=s.assembly_id
    left join climate_vote.org o on o.id=r.org_id
   where r.id=p_round_id and (
      (o.status='active' and o.archived_at is null
        and r.team_id is not null and t.id=r.team_id and t.status='active'
        and t.session_id=r.session_id and t.org_id=r.org_id
        and s.id=r.session_id and s.org_id=r.org_id and s.status='active'
        and s.access_expires_at is not null and s.access_expires_at>now()
        and a.id=s.assembly_id and a.org_id=r.org_id
        and a.status='active' and a.archived_at is null)
      or (o.status='active' and o.archived_at is null
        and r.team_id is null and r.session_id is not null
        and s.id=r.session_id and s.org_id=r.org_id and s.status='active'
        and s.access_expires_at is not null and s.access_expires_at>now()
        and a.id=s.assembly_id and a.org_id=r.org_id
        and a.status='active' and a.archived_at is null)
   ) for share of r;
  if not found then raise exception 'public round not found'; end if;
  if v_round.status<>'active' then return 'closed'; end if;
  if v_round.type<>'TEXT' and (
     jsonb_typeof(v_round.options)<>'array' or jsonb_array_length(v_round.options)=0) then
    raise exception 'round has no allowed choices';
  end if;
  if v_round.type='CHECKBOX' then
    if jsonb_typeof(p_choice)<>'array' or jsonb_array_length(p_choice)=0
       or exists(
         select 1 from jsonb_array_elements(p_choice) selected
          where not exists(
            select 1 from jsonb_array_elements(v_round.options) allowed
             where allowed=selected
          )
       )
       or (select count(*)<>count(distinct selected)
             from jsonb_array_elements(p_choice) selected) then
      raise exception 'invalid public vote choice';
    end if;
  elsif v_round.type in ('RADIO','SCALE') then
    if jsonb_typeof(p_choice)='array' or not exists(
      select 1 from jsonb_array_elements(v_round.options) allowed where allowed=p_choice
    ) then raise exception 'invalid public vote choice'; end if;
  elsif v_round.type='SCALE_MULTI' then
    if jsonb_typeof(p_choice)<>'object'
       or (select count(*) from jsonb_object_keys(p_choice))
          <>jsonb_array_length(v_round.options)
       or exists(
         select 1 from jsonb_array_elements_text(v_round.options) allowed(label)
          where not (p_choice ? allowed.label)
       )
       or exists(
         select 1 from jsonb_each(p_choice) selected(label,value)
          where not exists(
            select 1 from jsonb_array_elements_text(v_round.options) allowed(label)
             where allowed.label=selected.label
          )
             or jsonb_typeof(selected.value)<>'number'
             or (selected.value#>>'{}')::numeric<>trunc((selected.value#>>'{}')::numeric)
             or (selected.value#>>'{}')::numeric
                not between coalesce(v_round.scale_low,1) and coalesce(v_round.scale_high,5)
       ) then raise exception 'invalid public vote choice'; end if;
  elsif v_round.type='TEXT' then
    if jsonb_typeof(p_choice)<>'string'
       or length(trim(p_choice#>>'{}')) not between 1 and 2000 then
      raise exception 'invalid public vote choice';
    end if;
  else
    raise exception 'unsupported public round type';
  end if;
  if exists(select 1 from climate_vote.votes v where v.round_id=v_round.id
    and v.client_id=p_client_id and v.archived_at is null) then return 'duplicate'; end if;
  begin
    insert into climate_vote.votes(round_id,choice,voter_role,client_id,org_id)
    values(v_round.id,p_choice,'citizen',p_client_id,v_round.org_id);
  exception when unique_violation then
    return 'duplicate';
  end;
  return 'ok';
end $fn$;

create or replace function climate_vote.hq_submissions_v2(
  p_token text, p_session_slug text)
returns table(
  topic_id uuid,topic_ordinal int,topic_prompt text,topic_status text,
  team_id uuid,team_name text,team_subgroup text,table_no text,
  submission_id uuid,submission_status text,submission_updated_at timestamptz,
  submission_finalized_at timestamptz,item_ordinal int,item_kind text,
  item_content text,item_rationale text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select dt.id,dt.ordinal,dt.prompt,dt.status,t.id,t.name,t.subgroup,t.table_no,
    s.id,s.status,s.updated_at,s.finalized_at,si.ordinal,si.kind,si.content,si.rationale
  from climate_vote.discussion_topic dt
  join climate_vote.team t on t.session_id=v_session.id
    and t.org_id=v_session.org_id and t.status='active'
  left join climate_vote.submission s on s.topic_id=dt.id and s.team_id=t.id
    and s.org_id=v_session.org_id
  left join climate_vote.submission_item si on si.submission_id=s.id
  where dt.session_id=v_session.id and dt.org_id=v_session.org_id
    and dt.status in ('open','closed')
  order by dt.ordinal,t.name,si.ordinal nulls first;
end $fn$;

-- v3 adds the submission generation required to build an exact-set clear CAS.
-- The source rows themselves remain unchanged and retain their stable UUIDs.
create or replace function climate_vote.hq_submissions_v3(
  p_token text, p_session_slug text)
returns table(
  topic_id uuid,topic_ordinal int,topic_prompt text,topic_status text,
  team_id uuid,team_name text,team_subgroup text,table_no text,
  submission_id uuid,submission_status text,submission_version bigint,
  submission_updated_at timestamptz,submission_finalized_at timestamptz,
  item_id uuid,item_ordinal int,item_kind text,item_content text,item_rationale text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select dt.id,dt.ordinal,dt.prompt,dt.status,t.id,t.name,t.subgroup,t.table_no,
    s.id,s.status,s.version,s.updated_at,s.finalized_at,
    si.id,si.ordinal,si.kind,si.content,si.rationale
  from climate_vote.discussion_topic dt
  join climate_vote.team t on t.session_id=v_session.id
    and t.org_id=v_session.org_id and t.status='active'
  left join climate_vote.submission s on s.topic_id=dt.id and s.team_id=t.id
    and s.org_id=v_session.org_id and s.archived_at is null
  left join climate_vote.submission_item si on si.submission_id=s.id
  where dt.session_id=v_session.id and dt.org_id=v_session.org_id
    and dt.status in ('open','closed')
  order by dt.ordinal,t.name,si.ordinal nulls first;
end $fn$;

create or replace function climate_vote.submission_reopen_v2(
  p_token text, p_session_slug text, p_submission_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_sub climate_vote.submission;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if length(trim(coalesce(p_reason,'')))<2 then raise exception 'reason required'; end if;
  select s.* into v_sub from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.id=p_submission_id and s.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
   for update of s;
  if not found then raise exception 'submission outside HQ session scope'; end if;
  if v_sub.status<>'final' then raise exception 'only finalized submission can be reopened'; end if;
  -- Reopening is a new editable generation. Advancing the CAS version prevents
  -- a tab that only observed the finalized generation from replacing the
  -- reopened submission without first loading the HQ action.
  update climate_vote.submission
     set status='reopened',version=version+1,updated_at=now()
   where id=v_sub.id
   returning * into v_sub;
  insert into climate_vote.submission_lock_event
    (submission_id,action,actor_scope,actor_label,reason)
  values(v_sub.id,'reopen','hq',v_auth.actor_label,trim(p_reason));
  return jsonb_build_object(
    'id',v_sub.id,'status','reopened','version',v_sub.version,
    'updated_at',v_sub.updated_at);
end $fn$;

create or replace function climate_vote.hq_submission_history_v2(
  p_token text, p_session_slug text)
returns table(team_name text,topic_ordinal int,topic_prompt text,
  event_at timestamptz,kind text,actor_label text,detail text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select t.name,dt.ordinal,dt.prompt,e.created_at,e.action,e.actor_label,e.reason
  from climate_vote.submission_lock_event e
  join climate_vote.submission s on s.id=e.submission_id and s.org_id=v_session.org_id
  join climate_vote.discussion_topic dt on dt.id=s.topic_id
    and dt.session_id=v_session.id and dt.org_id=v_session.org_id
  join climate_vote.team t on t.id=s.team_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
  union all
  select t.name,dt.ordinal,dt.prompt,a.archived_at,'replaced',
    '조 저장으로 교체됨',a.content
  from climate_vote.submission_item_archive a
  join climate_vote.submission s on s.id=a.submission_id and s.org_id=v_session.org_id
  join climate_vote.discussion_topic dt on dt.id=s.topic_id
    and dt.session_id=v_session.id and dt.org_id=v_session.org_id
  join climate_vote.team t on t.id=s.team_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
  order by 4 desc;
end $fn$;

create or replace function climate_vote.hq_submission_category_assign_v2(
  p_token text, p_session_slug text, p_submission_id uuid,
  p_item_ordinal int, p_category text)
returns void language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_source_item_id uuid;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_item_ordinal is null or p_item_ordinal<1 then raise exception 'invalid item ordinal'; end if;
  if p_category is not null and p_category not in
    ('common','difference','conflict','question') then
    raise exception 'unknown category: %',p_category;
  end if;
  perform 1 from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.id=p_submission_id and s.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
   for update of s;
  if not found then raise exception 'submission outside HQ session scope'; end if;
  select si.id into v_source_item_id from climate_vote.submission_item si
   where si.submission_id=p_submission_id and si.ordinal=p_item_ordinal
   for update;
  if not found then raise exception 'submission item no longer exists'; end if;
  insert into climate_vote.submission_category_event
    (submission_id,item_ordinal,category,actor_scope,actor_label,source_item_id)
  values(p_submission_id,p_item_ordinal,p_category,'hq',v_auth.actor_label,
    v_source_item_id);
end $fn$;

create or replace function climate_vote.hq_submission_categories_v2(
  p_token text, p_session_slug text)
returns table(topic_id uuid,team_id uuid,submission_id uuid,item_ordinal int,
  category text,actor_label text,assigned_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  with latest as(
    select distinct on(e.submission_id,e.item_ordinal)
      e.submission_id,e.item_ordinal,e.category,e.actor_label,e.created_at
    from climate_vote.submission_category_event e
    join climate_vote.submission s on s.id=e.submission_id and s.org_id=v_session.org_id
    join climate_vote.submission_item si on si.submission_id=e.submission_id
      and si.ordinal=e.item_ordinal
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id
    join climate_vote.team t on t.id=s.team_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
    where e.source_item_id=si.id or (
      e.source_item_id is null
      and e.created_at>=coalesce(si.created_at,'-infinity'::timestamptz)
      and not exists(select 1 from climate_vote.submission_item_archive a
        where a.submission_id=e.submission_id and a.ordinal=e.item_ordinal
          and a.archived_at>=e.created_at))
    order by e.submission_id,e.item_ordinal,e.id desc
  )
  select s.topic_id,s.team_id,l.submission_id,l.item_ordinal,
    l.category,l.actor_label,l.created_at
  from latest l join climate_vote.submission s on s.id=l.submission_id
  order by s.topic_id,s.team_id,l.item_ordinal;
end $fn$;

-- v3 reads expose the event and source identities needed by the assignment
-- compare-and-set. Legacy rows are accepted only when archive history proves
-- that no later replacement reused their ordinal.
create or replace function climate_vote.hq_submission_categories_v3(
  p_token text, p_session_slug text)
returns table(topic_id uuid,team_id uuid,submission_id uuid,item_ordinal int,
  category text,actor_label text,assigned_at timestamptz,
  event_id bigint,source_item_id uuid)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  with latest as(
    select distinct on(e.submission_id,e.item_ordinal)
      e.submission_id,e.item_ordinal,e.category,e.actor_label,e.created_at,
      e.id,si.id as live_source_item_id
    from climate_vote.submission_category_event e
    join climate_vote.submission s on s.id=e.submission_id
      and s.org_id=v_session.org_id
    join climate_vote.submission_item si on si.submission_id=e.submission_id
      and si.ordinal=e.item_ordinal
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id
    join climate_vote.team t on t.id=s.team_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
    where e.source_item_id=si.id or (
      e.source_item_id is null
      and e.created_at>=coalesce(si.created_at,'-infinity'::timestamptz)
      and not exists(select 1 from climate_vote.submission_item_archive a
        where a.submission_id=e.submission_id and a.ordinal=e.item_ordinal
          and a.archived_at>=e.created_at))
    order by e.submission_id,e.item_ordinal,e.id desc
  )
  select s.topic_id,s.team_id,l.submission_id,l.item_ordinal,
    l.category,l.actor_label,l.created_at,l.id,l.live_source_item_id
  from latest l join climate_vote.submission s on s.id=l.submission_id
  order by s.topic_id,s.team_id,l.item_ordinal;
end $fn$;

create or replace function climate_vote.hq_submission_category_assign_v3(
  p_token text, p_session_slug text, p_submission_id uuid,
  p_item_ordinal int, p_category text,
  p_expected_submission_updated_at timestamptz, p_expected_event_id bigint,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_submission climate_vote.submission; v_source_item_id uuid;
  v_current_event_id bigint; v_event_id bigint; v_hash text;
  v_prior jsonb; v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_item_ordinal is null or p_item_ordinal<1 then
    raise exception 'invalid item ordinal';
  end if;
  if p_category is not null and p_category not in
    ('common','difference','conflict','question') then
    raise exception 'unknown category: %',p_category;
  end if;
  if p_expected_submission_updated_at is null then
    raise exception 'expected submission updated_at required';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  select s.* into v_submission from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.id=p_submission_id and s.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
   for update of s;
  if not found then raise exception 'submission outside HQ session scope'; end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'session_slug',p_session_slug,'submission_id',p_submission_id,
    'item_ordinal',p_item_ordinal,'category',p_category,
    'expected_submission_updated_at',p_expected_submission_updated_at,
    'expected_event_id',p_expected_event_id)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'hq_submission_category_assign_v3',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  select si.id into v_source_item_id from climate_vote.submission_item si
   where si.submission_id=p_submission_id and si.ordinal=p_item_ordinal
   for update;
  select e.id into v_current_event_id
    from climate_vote.submission_category_event e
    join climate_vote.submission_item si on si.id=v_source_item_id
   where e.submission_id=p_submission_id and e.item_ordinal=p_item_ordinal
     and (e.source_item_id=v_source_item_id or (
       e.source_item_id is null
       and e.created_at>=coalesce(si.created_at,'-infinity'::timestamptz)
       and not exists(select 1 from climate_vote.submission_item_archive a
         where a.submission_id=e.submission_id and a.ordinal=e.item_ordinal
           and a.archived_at>=e.created_at)))
   order by e.id desc limit 1;
  if v_submission.updated_at is distinct from p_expected_submission_updated_at
     or v_current_event_id is distinct from p_expected_event_id then
    v_result:=jsonb_build_object(
      'status','conflict','submission_id',p_submission_id,
      'current_submission_updated_at',v_submission.updated_at,
      'current_event_id',v_current_event_id);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  if v_source_item_id is null then
    raise exception 'submission item no longer exists';
  end if;
  insert into climate_vote.submission_category_event
    (submission_id,item_ordinal,category,actor_scope,actor_label,source_item_id)
  values(p_submission_id,p_item_ordinal,p_category,'hq',v_auth.actor_label,
    v_source_item_id)
  returning id into v_event_id;
  v_result:=jsonb_build_object(
    'status','applied','submission_id',p_submission_id,
    'item_ordinal',p_item_ordinal,'source_item_id',v_source_item_id,
    'submission_updated_at',v_submission.updated_at,
    'event_id',v_event_id,'category',p_category);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.hq_submission_kind_assign_v2(
  p_token text, p_session_slug text, p_submission_id uuid,
  p_item_ordinal int, p_kind text)
returns void language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_source_item_id uuid;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_item_ordinal is null or p_item_ordinal<1 then raise exception 'invalid item ordinal'; end if;
  if p_kind is not null and p_kind not in
    ('Issue','Claim','Proposal','Concern','Condition','Value','Evidence') then
    raise exception 'unknown kind: %',p_kind;
  end if;
  perform 1 from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.id=p_submission_id and s.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
   for update of s;
  if not found then raise exception 'submission outside HQ session scope'; end if;
  select si.id into v_source_item_id from climate_vote.submission_item si
   where si.submission_id=p_submission_id and si.ordinal=p_item_ordinal
   for update;
  if not found then raise exception 'submission item no longer exists'; end if;
  insert into climate_vote.submission_kind_event
    (submission_id,item_ordinal,kind,actor_scope,actor_label,source_item_id)
  values(p_submission_id,p_item_ordinal,p_kind,'hq',v_auth.actor_label,
    v_source_item_id);
end $fn$;

create or replace function climate_vote.hq_submission_kinds_v2(
  p_token text, p_session_slug text)
returns table(topic_id uuid,team_id uuid,submission_id uuid,item_ordinal int,
  kind text,actor_label text,assigned_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  with latest as(
    select distinct on(e.submission_id,e.item_ordinal)
      e.submission_id,e.item_ordinal,e.kind,e.actor_label,e.created_at
    from climate_vote.submission_kind_event e
    join climate_vote.submission s on s.id=e.submission_id and s.org_id=v_session.org_id
    join climate_vote.submission_item si on si.submission_id=e.submission_id
      and si.ordinal=e.item_ordinal
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id
    join climate_vote.team t on t.id=s.team_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
    where e.source_item_id=si.id or (
      e.source_item_id is null
      and e.created_at>=coalesce(si.created_at,'-infinity'::timestamptz)
      and not exists(select 1 from climate_vote.submission_item_archive a
        where a.submission_id=e.submission_id and a.ordinal=e.item_ordinal
          and a.archived_at>=e.created_at))
    order by e.submission_id,e.item_ordinal,e.id desc
  )
  select s.topic_id,s.team_id,l.submission_id,l.item_ordinal,
    l.kind,l.actor_label,l.created_at
  from latest l join climate_vote.submission s on s.id=l.submission_id
  order by s.topic_id,s.team_id,l.item_ordinal;
end $fn$;

create or replace function climate_vote.hq_submission_kinds_v3(
  p_token text, p_session_slug text)
returns table(topic_id uuid,team_id uuid,submission_id uuid,item_ordinal int,
  kind text,actor_label text,assigned_at timestamptz,
  event_id bigint,source_item_id uuid)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  with latest as(
    select distinct on(e.submission_id,e.item_ordinal)
      e.submission_id,e.item_ordinal,e.kind,e.actor_label,e.created_at,
      e.id,si.id as live_source_item_id
    from climate_vote.submission_kind_event e
    join climate_vote.submission s on s.id=e.submission_id
      and s.org_id=v_session.org_id
    join climate_vote.submission_item si on si.submission_id=e.submission_id
      and si.ordinal=e.item_ordinal
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id
    join climate_vote.team t on t.id=s.team_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
    where e.source_item_id=si.id or (
      e.source_item_id is null
      and e.created_at>=coalesce(si.created_at,'-infinity'::timestamptz)
      and not exists(select 1 from climate_vote.submission_item_archive a
        where a.submission_id=e.submission_id and a.ordinal=e.item_ordinal
          and a.archived_at>=e.created_at))
    order by e.submission_id,e.item_ordinal,e.id desc
  )
  select s.topic_id,s.team_id,l.submission_id,l.item_ordinal,
    l.kind,l.actor_label,l.created_at,l.id,l.live_source_item_id
  from latest l join climate_vote.submission s on s.id=l.submission_id
  order by s.topic_id,s.team_id,l.item_ordinal;
end $fn$;

create or replace function climate_vote.hq_submission_kind_assign_v3(
  p_token text, p_session_slug text, p_submission_id uuid,
  p_item_ordinal int, p_kind text,
  p_expected_submission_updated_at timestamptz, p_expected_event_id bigint,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_submission climate_vote.submission; v_source_item_id uuid;
  v_current_event_id bigint; v_event_id bigint; v_hash text;
  v_prior jsonb; v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_item_ordinal is null or p_item_ordinal<1 then
    raise exception 'invalid item ordinal';
  end if;
  if p_kind is not null and p_kind not in
    ('Issue','Claim','Proposal','Concern','Condition','Value','Evidence') then
    raise exception 'unknown kind: %',p_kind;
  end if;
  if p_expected_submission_updated_at is null then
    raise exception 'expected submission updated_at required';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  select s.* into v_submission from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.id=p_submission_id and s.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
   for update of s;
  if not found then raise exception 'submission outside HQ session scope'; end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'session_slug',p_session_slug,'submission_id',p_submission_id,
    'item_ordinal',p_item_ordinal,'kind',p_kind,
    'expected_submission_updated_at',p_expected_submission_updated_at,
    'expected_event_id',p_expected_event_id)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'hq_submission_kind_assign_v3',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  select si.id into v_source_item_id from climate_vote.submission_item si
   where si.submission_id=p_submission_id and si.ordinal=p_item_ordinal
   for update;
  select e.id into v_current_event_id
    from climate_vote.submission_kind_event e
    join climate_vote.submission_item si on si.id=v_source_item_id
   where e.submission_id=p_submission_id and e.item_ordinal=p_item_ordinal
     and (e.source_item_id=v_source_item_id or (
       e.source_item_id is null
       and e.created_at>=coalesce(si.created_at,'-infinity'::timestamptz)
       and not exists(select 1 from climate_vote.submission_item_archive a
         where a.submission_id=e.submission_id and a.ordinal=e.item_ordinal
           and a.archived_at>=e.created_at)))
   order by e.id desc limit 1;
  if v_submission.updated_at is distinct from p_expected_submission_updated_at
     or v_current_event_id is distinct from p_expected_event_id then
    v_result:=jsonb_build_object(
      'status','conflict','submission_id',p_submission_id,
      'current_submission_updated_at',v_submission.updated_at,
      'current_event_id',v_current_event_id);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  if v_source_item_id is null then
    raise exception 'submission item no longer exists';
  end if;
  insert into climate_vote.submission_kind_event
    (submission_id,item_ordinal,kind,actor_scope,actor_label,source_item_id)
  values(p_submission_id,p_item_ordinal,p_kind,'hq',v_auth.actor_label,
    v_source_item_id)
  returning id into v_event_id;
  v_result:=jsonb_build_object(
    'status','applied','submission_id',p_submission_id,
    'item_ordinal',p_item_ordinal,'source_item_id',v_source_item_id,
    'submission_updated_at',v_submission.updated_at,
    'event_id',v_event_id,'kind',p_kind);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.hq_topic_deadlines_v2(
  p_token text, p_session_slug text)
returns table(topic_id uuid,topic_ordinal int,deadline_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query
  select dt.id,dt.ordinal,dt.deadline_at from climate_vote.discussion_topic dt
   where dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and dt.status in ('open','closed')
   order by dt.ordinal;
end $fn$;

create or replace function climate_vote.hq_clear_submissions_v2(
  p_token text, p_session_slug text, p_confirm text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_items int; v_subs int; v_linked_items int:=0;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if coalesce(trim(p_confirm),'')<>'전체 비우기' then
    raise exception '확인 문구가 맞지 않습니다';
  end if;
  -- Lock every scoped submission before the clear. The version increment below
  -- is the CAS tombstone that prevents an offline pre-clear draft from restoring
  -- removed content. P2-linked source rows make the whole clear fail closed so
  -- the UI can never claim a partial clear succeeded.
  perform 1 from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.org_id=v_session.org_id and dt.session_id=v_session.id
     and dt.org_id=v_session.org_id and t.session_id=v_session.id
     and t.org_id=v_session.org_id
   for update of s;
  select count(*) into v_subs from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id
    join climate_vote.team t on t.id=s.team_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
   where s.org_id=v_session.org_id;
  if to_regclass('climate_vote.issue_link') is not null then
    execute 'select count(*) from climate_vote.submission_item i
      join climate_vote.submission s on s.id=i.submission_id
      join climate_vote.discussion_topic dt on dt.id=s.topic_id
      join climate_vote.team t on t.id=s.team_id
      where s.org_id=$1 and dt.session_id=$2 and dt.org_id=$1
        and t.session_id=$2 and t.org_id=$1
        and exists(select 1 from climate_vote.issue_link il where il.item_id=i.id)'
      into v_linked_items using v_session.org_id,v_session.id;
    if v_linked_items>0 then
      raise exception '분석에 연결된 원문 %개가 있어 비울 수 없습니다. 연결을 해제한 뒤 다시 시도해 주세요.',
        v_linked_items;
    end if;
  end if;
  delete from climate_vote.submission_item i
    using climate_vote.submission s,climate_vote.discussion_topic dt,climate_vote.team t
   where s.id=i.submission_id and dt.id=s.topic_id and t.id=s.team_id
     and s.org_id=v_session.org_id and dt.session_id=v_session.id
     and dt.org_id=v_session.org_id and t.session_id=v_session.id
     and t.org_id=v_session.org_id;
  get diagnostics v_items=row_count;
  update climate_vote.submission s set status='draft',finalized_at=null,
    finalized_by=null,version=version+1,updated_at=now(),last_saved_by=v_auth.actor_label
    from climate_vote.discussion_topic dt,climate_vote.team t
   where dt.id=s.topic_id and t.id=s.team_id and s.org_id=v_session.org_id
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
     and t.org_id=v_session.org_id;
  insert into climate_vote.submission_clear_event
    (session_slug,cleared_items,cleared_submissions,actor_label)
  values(v_session.slug,v_items,v_subs,v_auth.actor_label);
  return jsonb_build_object('cleared_items',v_items,'cleared_submissions',v_subs);
end $fn$;

-- Destructive clear requires the exact session-wide submission generation set
-- observed by the HQ board. submission_save_v3 takes the same advisory lock,
-- preventing an unobserved new submission from appearing between CAS and delete.
create or replace function climate_vote.hq_clear_submissions_v3(
  p_token text, p_session_slug text, p_confirm text,
  p_expected_submissions jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_expected jsonb; v_current jsonb; v_hash text; v_prior jsonb; v_result jsonb;
  v_items int; v_subs int; v_linked_items int:=0;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if coalesce(trim(p_confirm),'')<>'전체 비우기' then
    raise exception '확인 문구가 맞지 않습니다';
  end if;
  if p_expected_submissions is null
     or jsonb_typeof(p_expected_submissions)<>'array'
     or jsonb_array_length(p_expected_submissions)>5000
     or exists(select 1 from jsonb_array_elements(p_expected_submissions) item
       where jsonb_typeof(item)<>'object'
          or coalesce(item->>'id','')!~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          or coalesce(item->>'version','')!~'^[0-9]+$') then
    raise exception 'expected submissions must be an array of id/version objects';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version)
      order by x.id),'[]'::jsonb) into v_expected
    from (
      select (item->>'id')::uuid id,(item->>'version')::bigint version
      from jsonb_array_elements(p_expected_submissions) item
    ) x;
  exception when numeric_value_out_of_range then
    raise exception 'expected submission version is out of range';
  end;
  if (select count(*) from jsonb_array_elements(v_expected))
     <> (select count(distinct item->>'id')
           from jsonb_array_elements(p_expected_submissions) item) then
    raise exception 'expected submissions contain duplicate ids';
  end if;

  v_hash:=encode(extensions.digest(jsonb_build_object(
    'session_slug',p_session_slug,'confirm',trim(p_confirm),
    'expected_submissions',v_expected)::text,'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'hq_clear_submissions_v3',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'workshop-submissions|'||v_session.id::text,0));
  perform s.id from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
    join climate_vote.team t on t.id=s.team_id
   where s.org_id=v_session.org_id and s.archived_at is null
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id
   order by s.id for update of s;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version)
      order by x.id),'[]'::jsonb),count(*)::int
    into v_current,v_subs
  from (
    select s.id,s.version from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
      and dt.session_id=v_session.id and dt.org_id=v_session.org_id
    join climate_vote.team t on t.id=s.team_id
      and t.session_id=v_session.id and t.org_id=v_session.org_id
    where s.org_id=v_session.org_id and s.archived_at is null
  ) x;
  if v_current<>v_expected then
    v_result:=jsonb_build_object(
      'status','conflict','current_submissions',v_current,
      'expected_submissions',v_expected);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;

  if to_regclass('climate_vote.issue_link') is not null then
    execute 'select count(*) from climate_vote.submission_item i
      join climate_vote.submission s on s.id=i.submission_id
      join climate_vote.discussion_topic dt on dt.id=s.topic_id
      join climate_vote.team t on t.id=s.team_id
      where s.org_id=$1 and s.archived_at is null
        and dt.session_id=$2 and dt.org_id=$1
        and t.session_id=$2 and t.org_id=$1
        and exists(select 1 from climate_vote.issue_link il where il.item_id=i.id)'
      into v_linked_items using v_session.org_id,v_session.id;
    if v_linked_items>0 then
      raise exception '분석에 연결된 원문 %개가 있어 비울 수 없습니다. 연결을 해제한 뒤 다시 시도해 주세요.',
        v_linked_items;
    end if;
  end if;
  delete from climate_vote.submission_item i
    using climate_vote.submission s,climate_vote.discussion_topic dt,climate_vote.team t
   where s.id=i.submission_id and dt.id=s.topic_id and t.id=s.team_id
     and s.org_id=v_session.org_id and s.archived_at is null
     and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and t.session_id=v_session.id and t.org_id=v_session.org_id;
  get diagnostics v_items=row_count;
  update climate_vote.submission s set status='draft',finalized_at=null,
    finalized_by=null,version=version+1,updated_at=now(),last_saved_by=v_auth.actor_label
    from climate_vote.discussion_topic dt,climate_vote.team t
   where dt.id=s.topic_id and t.id=s.team_id and s.org_id=v_session.org_id
     and s.archived_at is null and dt.session_id=v_session.id
     and dt.org_id=v_session.org_id and t.session_id=v_session.id
     and t.org_id=v_session.org_id;
  insert into climate_vote.submission_clear_event
    (session_slug,cleared_items,cleared_submissions,actor_label)
  values(v_session.slug,v_items,v_subs,v_auth.actor_label);
  perform climate_vote.workshop_audit(
    v_session.org_id,v_session.id,null,v_auth.id,p_idempotency_key,
    'submissions_cleared','hq',v_auth.actor_label,
    jsonb_build_object('submissions',v_expected),
    jsonb_build_object('cleared_items',v_items,'cleared_submissions',v_subs));
  v_result:=jsonb_build_object(
    'status','applied','cleared_items',v_items,'cleared_submissions',v_subs);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

-- ---------------------------------------------------------------------------
-- 7. Strictly session-scoped HQ control plane
-- ---------------------------------------------------------------------------

create or replace function climate_vote.workshop_hq_status(
  p_token text, p_session_slug text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session; v_org_name text; v_topics jsonb;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  select o.name into v_org_name from climate_vote.org o where o.id=v_session.org_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',dt.id,'ordinal',dt.ordinal,
    'prompt',dt.prompt,'status',dt.status,'deadline_at',dt.deadline_at)
    order by dt.ordinal),'[]'::jsonb) into v_topics
  from climate_vote.discussion_topic dt
  where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status<>'archived';
  return jsonb_build_object(
    'session_id',v_session.id,'session_slug',v_session.slug,'session_title',v_session.title,
    'org_name',v_org_name,'topics',v_topics,
    'topic_total',(select count(*) from climate_vote.discussion_topic dt
      where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status<>'archived'),
    'topic_open',(select count(*) from climate_vote.discussion_topic dt
      where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status='open'),
    'topic_closed',(select count(*) from climate_vote.discussion_topic dt
      where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status='closed'),
    'next_topic_id',(select dt.id from climate_vote.discussion_topic dt
      where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status='draft'
      order by dt.ordinal limit 1),
    'next_topic_ordinal',(select dt.ordinal from climate_vote.discussion_topic dt
      where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status='draft'
      order by dt.ordinal limit 1),
    'next_topic_prompt',(select dt.prompt from climate_vote.discussion_topic dt
      where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status='draft'
      order by dt.ordinal limit 1),
    'teams_total',(select count(*) from climate_vote.team t
      where t.session_id=v_session.id and t.org_id=v_session.org_id and t.status='active'),
    'active_devices',(select count(*) from climate_vote.attendance_auth_session a
      where a.session_id=v_session.id and a.org_id=v_session.org_id and a.scope='team'
        and a.purpose='workshop'
        and a.revoked_at is null and a.expires_at>now()),
    'teams_online',(select count(distinct a.team_id) from climate_vote.attendance_auth_session a
      where a.session_id=v_session.id and a.org_id=v_session.org_id and a.scope='team'
        and a.purpose='workshop'
        and a.revoked_at is null and a.expires_at>now()
        and a.last_seen_at>now()-interval '10 minutes'),
    'submissions_draft',(select count(*) from climate_vote.submission su
      join climate_vote.discussion_topic dt on dt.id=su.topic_id
      where dt.session_id=v_session.id and su.org_id=v_session.org_id
        and su.status in ('draft','reopened')),
    'submissions_final',(select count(*) from climate_vote.submission su
      join climate_vote.discussion_topic dt on dt.id=su.topic_id
      where dt.session_id=v_session.id and su.org_id=v_session.org_id and su.status='final'),
    'last_activity_at',(select max(a.created_at) from climate_vote.workshop_audit_event a
      where a.session_id=v_session.id and a.org_id=v_session.org_id));
end $fn$;

create or replace function climate_vote.workshop_hq_open_next_topic(
  p_token text, p_session_slug text, p_expected_ordinal int,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_topic climate_vote.discussion_topic; v_hash text; v_prior jsonb;
  v_result jsonb; v_audit bigint;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_expected_ordinal is null then raise exception 'expected topic ordinal required'; end if;
  v_hash:=encode(digest(concat_ws('|',p_session_slug,p_expected_ordinal::text),'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'workshop_hq_open_next_topic',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;
  perform 1 from climate_vote.session where id=v_session.id for update;
  select * into v_topic from climate_vote.discussion_topic dt
   where dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and dt.ordinal=p_expected_ordinal and dt.status='open';
  if found then
    v_result:=jsonb_build_object('status','already_open','topic_id',v_topic.id,
      'ordinal',v_topic.ordinal,'prompt',v_topic.prompt,'audit_id',coalesce((
        select a.id from climate_vote.workshop_audit_event a
         where a.session_id=v_session.id and a.action='topic_opened'
           and a.after_value->>'topic_id'=v_topic.id::text
         order by a.id desc limit 1),0));
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  select * into v_topic from climate_vote.discussion_topic dt
   where dt.session_id=v_session.id and dt.org_id=v_session.org_id and dt.status='draft'
   order by dt.ordinal limit 1 for update;
  if not found then raise exception 'no draft topic remains'; end if;
  if v_topic.ordinal<>p_expected_ordinal then
    raise exception 'next topic ordinal conflict: expected %, current %',p_expected_ordinal,v_topic.ordinal;
  end if;
  update climate_vote.discussion_topic set status='open' where id=v_topic.id;
  v_audit:=climate_vote.workshop_audit(v_session.org_id,v_session.id,null,v_auth.id,
    p_idempotency_key,'topic_opened','hq',v_auth.actor_label,
    jsonb_build_object('topic_id',v_topic.id,'status','draft'),
    jsonb_build_object('topic_id',v_topic.id,'status','open','ordinal',v_topic.ordinal));
  v_result:=jsonb_build_object('status','opened','topic_id',v_topic.id,
    'ordinal',v_topic.ordinal,'prompt',v_topic.prompt,'audit_id',v_audit);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.workshop_hq_set_topic_status(
  p_token text, p_session_slug text, p_topic_id uuid, p_expected_status text,
  p_status text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_topic climate_vote.discussion_topic; v_hash text; v_prior jsonb;
  v_result jsonb; v_audit bigint;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_expected_status is null or p_expected_status not in ('draft','open','closed')
     or p_status is null or p_status not in ('draft','open','closed') then
    raise exception 'invalid topic status';
  end if;
  v_hash:=encode(digest(concat_ws('|',p_topic_id::text,p_expected_status,p_status),'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'workshop_hq_set_topic_status',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;
  select * into v_topic from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id and dt.org_id=v_session.org_id
   for update;
  if not found then raise exception 'topic not in HQ session scope'; end if;
  if v_topic.status<>p_expected_status then
    v_result:=jsonb_build_object('status','conflict','topic_id',v_topic.id,
      'current_status',v_topic.status,'expected_status',p_expected_status);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  if v_topic.status=p_status then
    v_result:=jsonb_build_object('status','already_set','topic_id',v_topic.id,
      'previous_status',v_topic.status,'current_status',v_topic.status,
      'audit_id',null);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  update climate_vote.discussion_topic set status=p_status where id=v_topic.id;
  v_audit:=climate_vote.workshop_audit(v_session.org_id,v_session.id,null,v_auth.id,
    p_idempotency_key,'topic_status_changed','hq',v_auth.actor_label,
    jsonb_build_object('topic_id',v_topic.id,'status',v_topic.status),
    jsonb_build_object('topic_id',v_topic.id,'status',p_status));
  v_result:=jsonb_build_object('status','updated','topic_id',v_topic.id,
    'previous_status',v_topic.status,'current_status',p_status,'audit_id',v_audit);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.workshop_hq_devices(
  p_token text, p_session_slug text)
returns table(token_hash text,team_id uuid,team_name text,device_id uuid,
  device_label text,last_seen_at timestamptz,expires_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_session climate_vote.session;
begin
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  return query select a.token_hash,t.id,t.name,a.device_id,a.device_label,
    a.last_seen_at,a.expires_at
  from climate_vote.attendance_auth_session a
  join climate_vote.team t on t.id=a.team_id
  where a.scope='team' and a.purpose='workshop'
    and a.session_id=v_session.id and a.org_id=v_session.org_id
    and t.session_id=v_session.id and t.org_id=v_session.org_id
    and a.revoked_at is null and a.expires_at>now()
  order by t.table_no nulls last,t.name,a.created_at;
end $fn$;

create or replace function climate_vote.workshop_hq_revoke_device(
  p_token text, p_session_slug text, p_token_hash text, p_reason text,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_target climate_vote.attendance_auth_session; v_hash text; v_prior jsonb;
  v_result jsonb; v_audit bigint;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash';
  end if;
  if length(trim(coalesce(p_reason,'')))<2 then raise exception 'reason required'; end if;
  v_hash:=encode(digest(concat_ws('|',p_token_hash,trim(p_reason)),'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'workshop_hq_revoke_device',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;
  select * into v_target from climate_vote.attendance_auth_session a
   where a.token_hash=p_token_hash and a.scope='team' and a.purpose='workshop'
     and a.session_id=v_session.id and a.org_id=v_session.org_id for update;
  if not found then raise exception 'device not in HQ session scope'; end if;
  if v_target.revoked_at is null then
    update climate_vote.attendance_auth_session set revoked_at=now()
     where token_hash=p_token_hash returning * into v_target;
    v_audit:=climate_vote.workshop_audit(v_session.org_id,v_session.id,v_target.team_id,
      v_auth.id,p_idempotency_key,'device_revoked','hq',v_auth.actor_label,
      jsonb_build_object('auth_session_id',v_target.id,'status','active'),
      jsonb_build_object('auth_session_id',v_target.id,'status','revoked',
                         'reason',trim(p_reason)));
  end if;
  v_result:=jsonb_build_object('status','revoked','token_hash',p_token_hash,
    'team_id',v_target.team_id,'revoked_at',v_target.revoked_at,'audit_id',v_audit);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

create or replace function climate_vote.workshop_hq_set_deadline(
  p_token text, p_session_slug text, p_topic_id uuid,
  p_expected_deadline_at timestamptz, p_deadline_at timestamptz,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_topic climate_vote.discussion_topic; v_hash text; v_prior jsonb;
  v_result jsonb; v_audit bigint;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  v_hash:=encode(digest(concat_ws('|',p_topic_id::text,
    coalesce(p_expected_deadline_at::text,'null'),coalesce(p_deadline_at::text,'null')),
    'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'workshop_hq_set_deadline',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;
  select * into v_topic from climate_vote.discussion_topic dt
   where dt.id=p_topic_id and dt.session_id=v_session.id and dt.org_id=v_session.org_id
     and dt.status<>'archived' for update;
  if not found then raise exception 'topic not in HQ session scope'; end if;
  if v_topic.deadline_at is distinct from p_expected_deadline_at then
    v_result:=jsonb_build_object('status','conflict','topic_id',v_topic.id,
      'deadline_at',v_topic.deadline_at,'expected_deadline_at',p_expected_deadline_at);
    return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
  end if;
  update climate_vote.discussion_topic set deadline_at=p_deadline_at where id=v_topic.id;
  v_audit:=climate_vote.workshop_audit(v_session.org_id,v_session.id,null,v_auth.id,
    p_idempotency_key,'topic_deadline_changed','hq',v_auth.actor_label,
    jsonb_build_object('topic_id',v_topic.id,'deadline_at',v_topic.deadline_at),
    jsonb_build_object('topic_id',v_topic.id,'deadline_at',p_deadline_at));
  v_result:=jsonb_build_object('status','updated','topic_id',v_topic.id,
    'previous_deadline_at',v_topic.deadline_at,'deadline_at',p_deadline_at,
    'audit_id',v_audit);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

-- No three-argument compatibility overload: retries must carry the same key so
-- they receive the original code set instead of rotating a second time.
drop function if exists climate_vote.workshop_hq_rotate_join_codes(text,text,text);
create or replace function climate_vote.workshop_hq_rotate_join_codes(
  p_token text, p_session_slug text, p_confirmation text,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
  v_team climate_vote.team; v_codes jsonb:='[]'::jsonb; v_code text;
  v_excluded_codes text[];
  v_audit bigint; v_revoked int; v_hash text; v_prior jsonb; v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  v_session:=climate_vote.workshop_hq_session_row(p_token,p_session_slug);
  if p_confirmation is null or p_confirmation <> 'ROTATE '||p_session_slug then
    raise exception 'rotation confirmation mismatch';
  end if;
  v_hash:=encode(digest(concat_ws('|',p_session_slug,p_confirmation),
    'sha256'),'hex');
  v_prior:=climate_vote.workshop_request_claim(p_idempotency_key,
    'workshop_hq_rotate_join_codes',v_hash,v_session.org_id,v_session.id,null);
  if v_prior is not null then return v_prior; end if;
  perform 1 from climate_vote.session where id=v_session.id for update;
  -- Snapshot every pre-rotation code before changing the first team, then keep
  -- each newly assigned code in the same exclusion set. A code released by an
  -- earlier row can therefore never be reassigned to a later row.
  select coalesce(array_agg(t.join_code),array[]::text[]) into v_excluded_codes
    from climate_vote.team t;
  for v_team in select * from climate_vote.team t
    where t.session_id=v_session.id and t.org_id=v_session.org_id and t.status='active'
    order by t.table_no nulls last,t.name for update
  loop
    v_code:=climate_vote.workshop_random_join_code(v_excluded_codes);
    update climate_vote.team set join_code=v_code where id=v_team.id;
    v_excluded_codes:=array_append(v_excluded_codes,v_code);
    v_codes:=v_codes||jsonb_build_array(jsonb_build_object(
      'team_id',v_team.id,'team_name',v_team.name,'table_no',v_team.table_no,'join_code',v_code));
  end loop;
  update climate_vote.attendance_auth_session
     set revoked_at=now()
   where session_id=v_session.id and org_id=v_session.org_id
     and scope='team' and purpose in ('attendance','workshop')
     and revoked_at is null;
  get diagnostics v_revoked=row_count;
  v_audit:=climate_vote.workshop_audit(v_session.org_id,v_session.id,null,v_auth.id,
    p_idempotency_key,'join_codes_rotated','hq',v_auth.actor_label,null,
    jsonb_build_object('team_count',jsonb_array_length(v_codes),
                       'revoked_team_tokens',v_revoked));
  v_result:=jsonb_build_object('status','rotated','session_id',v_session.id,
    'codes',v_codes,'audit_id',v_audit);
  return climate_vote.workshop_request_finish(p_idempotency_key,v_result);
end $fn$;

-- Mutation overloads that manufacture missing CAS/idempotency inputs are
-- intentionally absent. Every caller must supply the observed topic status and
-- a stable request UUID.
drop function if exists climate_vote.workshop_hq_set_topic_status(
  text,text,uuid,text,uuid);
drop function if exists climate_vote.workshop_hq_revoke_device(
  text,text,text,text);

-- ---------------------------------------------------------------------------
-- 8. Privilege boundary. Internal helpers are owner-only. Before P2a, the
-- scoped attendance/HQ compatibility surface, narrow HQ pre-cutover pair, and
-- authenticated staff functions are callable.
-- Staged activation: legacy join-code RPCs and topic_set_deadline remain callable
-- until every field client has moved to these token RPCs. A later, separately
-- approved activation migration must revoke them; this migration does not.
-- ---------------------------------------------------------------------------

revoke execute on function
  climate_vote.workshop_audit_append_only_guard(),
  climate_vote.result_implementation_append_only_guard(),
  climate_vote.workshop_audit(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb),
  climate_vote.workshop_request_claim(uuid,text,text,uuid,uuid,uuid),
  climate_vote.workshop_request_finish(uuid,jsonb),
  climate_vote.attendance_token_row(text),
  climate_vote.attendance_issue_token(text,uuid,text),
  climate_vote.team_token_row(text),
  climate_vote.workshop_hq_session_row(text,text),
  climate_vote.attendance_scope_session_row(text,text),
  climate_vote.workshop_random_join_code(),
  climate_vote.workshop_random_join_code(text[]),
  climate_vote.workshop_request_source_hash(),
  climate_vote.platform_issue_snapshot_hash(uuid),
  climate_vote.platform_result_implementation_snapshot_hash(jsonb),
  climate_vote.round_scope_binding_guard(),
  climate_vote.platform_staff_session_row(uuid),
  climate_vote.platform_staff_live_session_row(uuid),
  climate_vote.platform_staff_session_for_roles(uuid,text[]),
  climate_vote.submission_payload(uuid,text,bigint,timestamptz,timestamptz)
from public, anon, authenticated;

revoke execute on function climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid)
from public, anon, authenticated;
revoke execute on function climate_vote.platform_canvas_round_current_v2(uuid)
from public, anon, authenticated;
revoke execute on function climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)
from public, anon, authenticated;
revoke execute on function climate_vote.platform_readiness_check_v2(uuid)
from public, anon, authenticated;
grant execute on function
  climate_vote.platform_readiness_check_v2(uuid),
  climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid),
  climate_vote.platform_canvas_round_current_v2(uuid),
  climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)
to authenticated;

-- Token-scoped functions below validate the token-bound org/session (and the
-- supplied target). public_round_* is a separate, least-data round-id capability:
-- it exposes only safe round fields, closed aggregate results, and validated cast.
revoke execute on function
  climate_vote.attendance_roster_v2(text,text),
  climate_vote.attendance_hq_summary_v2(text,text),
  climate_vote.attendance_set_v2(text,text,uuid,text,timestamptz),
  climate_vote.attendance_bulk_present_v2(text,text,uuid[]),
  climate_vote.attendance_finalize_absent_v2(text,text),
  climate_vote.attendance_member_save_v2(text,text,uuid,text,text,uuid,boolean),
  climate_vote.attendance_hq_audit_v2(text,text,int),
  climate_vote.attendance_hq_set_team_pin_v2(text,text,uuid,text),
  climate_vote.attendance_hq_set_table_no_v2(text,text,uuid,text),
  climate_vote.hq_teams_v2(text,text),
  climate_vote.hq_rounds_v2(text,text),
  climate_vote.hq_vote_counts_v2(text,text,text[]),
  climate_vote.hq_votes_v2(text,text,text[]),
  climate_vote.mod_rounds_v2(text),
  climate_vote.mod_session_teams_v2(text),
  climate_vote.mod_vote_counts_v2(text,text[]),
  climate_vote.mod_votes_v2(text,text),
  climate_vote.public_round_get_v2(text),
  climate_vote.public_round_votes_v2(text),
  climate_vote.public_round_cast_v2(text,jsonb,text),
  climate_vote.hq_submissions_v2(text,text),
  climate_vote.submission_reopen_v2(text,text,uuid,text),
  climate_vote.hq_submission_history_v2(text,text),
  climate_vote.hq_submission_category_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_categories_v2(text,text),
  climate_vote.hq_submission_kind_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_kinds_v2(text,text),
  climate_vote.hq_topic_deadlines_v2(text,text),
  climate_vote.hq_clear_submissions_v2(text,text,text)
from public, anon, authenticated;

-- OCC/idempotent HQ mutations and their identity-bearing reads activate only
-- in P2a together with the matching field clients.
revoke execute on function
  climate_vote.hq_submissions_v3(text,text),
  climate_vote.hq_submission_category_assign_v3(
    text,text,uuid,int,text,timestamptz,bigint,uuid),
  climate_vote.hq_submission_categories_v3(text,text),
  climate_vote.hq_submission_kind_assign_v3(
    text,text,uuid,int,text,timestamptz,bigint,uuid),
  climate_vote.hq_submission_kinds_v3(text,text),
  climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid)
from public, anon, authenticated;
grant execute on function
  climate_vote.attendance_roster_v2(text,text),
  climate_vote.attendance_hq_summary_v2(text,text),
  climate_vote.attendance_set_v2(text,text,uuid,text,timestamptz),
  climate_vote.attendance_bulk_present_v2(text,text,uuid[]),
  climate_vote.attendance_finalize_absent_v2(text,text),
  climate_vote.attendance_member_save_v2(text,text,uuid,text,text,uuid,boolean),
  climate_vote.attendance_hq_audit_v2(text,text,int),
  climate_vote.attendance_hq_set_team_pin_v2(text,text,uuid,text),
  climate_vote.attendance_hq_set_table_no_v2(text,text,uuid,text),
  climate_vote.hq_teams_v2(text,text),
  climate_vote.hq_rounds_v2(text,text),
  climate_vote.hq_vote_counts_v2(text,text,text[]),
  climate_vote.hq_votes_v2(text,text,text[]),
  climate_vote.mod_rounds_v2(text),
  climate_vote.mod_session_teams_v2(text),
  climate_vote.mod_vote_counts_v2(text,text[]),
  climate_vote.mod_votes_v2(text,text),
  climate_vote.public_round_get_v2(text),
  climate_vote.public_round_votes_v2(text),
  climate_vote.public_round_cast_v2(text,jsonb,text),
  climate_vote.hq_submissions_v2(text,text),
  climate_vote.submission_reopen_v2(text,text,uuid,text),
  climate_vote.hq_submission_history_v2(text,text),
  climate_vote.hq_submission_category_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_categories_v2(text,text),
  climate_vote.hq_submission_kind_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_kinds_v2(text,text),
  climate_vote.hq_topic_deadlines_v2(text,text),
  climate_vote.hq_clear_submissions_v2(text,text,text)
to anon, authenticated;

revoke execute on function
  climate_vote.mod_exchange_join_code(text,uuid,text),
  climate_vote.mod_session_get(text),
  climate_vote.topic_list_v2(text),
  climate_vote.attendance_round_eligible_count_v2(text,text),
  climate_vote.submission_get_v2(text,uuid),
  climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean),
  climate_vote.submission_finalize_v2(text,uuid,bigint),
  climate_vote.submission_reopen_by_team_v2(text,uuid),
  climate_vote.mod_create_round_v2(text,text,text,jsonb),
  climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid),
  climate_vote.mod_set_round_status_v2(text,text,text),
  climate_vote.mod_set_round_status_v3(text,text,text,text,uuid),
  climate_vote.mod_proxy_vote_v2(text,text,jsonb,int),
  climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid),
  climate_vote.mod_log_timer_v2(text,text,int,timestamptz,timestamptz),
  climate_vote.ballot_create_v2(text,text,text,jsonb,text),
  climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid),
  climate_vote.ballot_set_status_v2(text,uuid,text),
  climate_vote.ballot_list_v2(text),
  climate_vote.ballot_results_v2(text,text),
  climate_vote.workshop_hq_status(text,text),
  climate_vote.workshop_hq_open_next_topic(text,text,int,uuid),
  climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid),
  climate_vote.workshop_hq_devices(text,text),
  climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid),
  climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamptz,timestamptz,uuid),
  climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid),
  climate_vote.workshop_team_logout_v2(text)
from public, anon, authenticated;

-- Pre-cutover only the two HQ functions required to inspect the event and
-- perform the explicit random-code rotation are callable. The team-token
-- surface is granted atomically by P2a while legacy join-code RPCs are revoked.
grant execute on function
  climate_vote.workshop_hq_status(text,text),
  climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid)
to anon, authenticated;

revoke execute on function
  climate_vote.platform_ballot_list_v2(uuid),
  climate_vote.platform_ballot_results_v2(text,uuid),
  climate_vote.platform_issue_list_v2(uuid,uuid),
  climate_vote.platform_issue_items_v2(uuid,uuid),
  climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb),
  climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid),
  climate_vote.platform_issue_merge_v2(uuid,uuid,uuid),
  climate_vote.platform_issue_review_v2(uuid,uuid),
  climate_vote.platform_result_publish_v2(uuid,text,uuid,text),
  climate_vote.platform_result_unpublish_v2(uuid,uuid),
  climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb)
from public, anon, authenticated;

-- The OCC review/merge endpoints become callable only in the atomic P2a
-- cutover. Their v2 predecessors remain the pre-cutover emergency surface.
revoke execute on function
  climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid),
  climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid),
  climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid),
  climate_vote.platform_result_implementation_upsert_v3(
    uuid,text,uuid,jsonb,text,uuid)
from public, anon, authenticated;
grant execute on function
  climate_vote.platform_ballot_list_v2(uuid),
  climate_vote.platform_ballot_results_v2(text,uuid),
  climate_vote.platform_issue_list_v2(uuid,uuid),
  climate_vote.platform_issue_items_v2(uuid,uuid),
  climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb),
  climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid),
  climate_vote.platform_issue_merge_v2(uuid,uuid,uuid),
  climate_vote.platform_issue_review_v2(uuid,uuid),
  climate_vote.platform_result_publish_v2(uuid,text,uuid,text),
  climate_vote.platform_result_unpublish_v2(uuid,uuid),
  climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb)
to authenticated;

-- The review client switches to this all-or-nothing mutation at the P2a
-- cutover. Keep it owner-only while legacy clients are still deployed.
revoke execute on function
  climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)
from public, anon, authenticated;

grant execute on function climate_vote.workshop_random_join_code() to service_role;

drop trigger if exists workshop_audit_no_truncate on climate_vote.workshop_audit_event;
create trigger workshop_audit_no_truncate
  before truncate on climate_vote.workshop_audit_event
  for each statement execute function climate_vote.workshop_audit_append_only_guard();
drop trigger if exists platform_canvas_round_event_no_truncate
  on climate_vote.platform_canvas_round_event;
create trigger platform_canvas_round_event_no_truncate
  before truncate on climate_vote.platform_canvas_round_event
  for each statement execute function climate_vote.workshop_audit_append_only_guard();

drop trigger if exists result_implementation_no_update_delete
  on climate_vote.result_implementation_event;
create trigger result_implementation_no_update_delete
  before update or delete on climate_vote.result_implementation_event
  for each row execute function climate_vote.result_implementation_append_only_guard();
drop trigger if exists result_implementation_no_truncate
  on climate_vote.result_implementation_event;
create trigger result_implementation_no_truncate
  before truncate on climate_vote.result_implementation_event
  for each statement execute function climate_vote.result_implementation_append_only_guard();

commit;
