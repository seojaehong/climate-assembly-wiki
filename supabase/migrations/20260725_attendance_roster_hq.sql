-- feat(attendance): private voter roster, moderator attendance, public HQ aggregates
-- Project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- Additive only. Existing vote rows remain anonymous and unchanged.
-- Secrets are provisioned separately as crypt() hashes after this migration.

create extension if not exists pgcrypto with schema extensions;

create table if not exists climate_vote.assembly_member (
  id uuid primary key default gen_random_uuid(),
  official_id text not null unique check (length(trim(official_id)) between 1 and 40),
  name text not null check (length(trim(name)) between 1 and 100),
  active boolean not null default true,
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists climate_vote.team_assignment (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references climate_vote.session(id),
  team_id uuid not null references climate_vote.team(id),
  member_id uuid not null references climate_vote.assembly_member(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, member_id)
);
create index if not exists team_assignment_team_idx
  on climate_vote.team_assignment(team_id) where active;

create table if not exists climate_vote.attendance (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references climate_vote.team_assignment(id),
  base_status text not null default 'unconfirmed'
    check (base_status in ('unconfirmed','present','absent')),
  checked_in_at timestamptz,
  is_late boolean not null default false,
  checked_out_at timestamptz,
  is_early_leave boolean not null default false,
  updated_at timestamptz not null default now(),
  check (
    (base_status = 'present' and checked_in_at is not null)
    or (base_status <> 'present' and checked_in_at is null and checked_out_at is null
        and not is_late and not is_early_leave)
  ),
  check (checked_out_at is null or checked_out_at >= checked_in_at),
  check (not is_early_leave or checked_out_at is not null)
);

create table if not exists climate_vote.attendance_audit_log (
  id bigint generated always as identity primary key,
  session_id uuid references climate_vote.session(id),
  team_id uuid references climate_vote.team(id),
  assignment_id uuid references climate_vote.team_assignment(id),
  action text not null,
  before_value jsonb,
  after_value jsonb,
  actor_scope text not null check (actor_scope in ('team','hq','import')),
  actor_label text not null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_audit_session_idx
  on climate_vote.attendance_audit_log(session_id, created_at desc);

create table if not exists climate_vote.attendance_secret (
  secret_key text primary key,
  secret_hash text not null,
  updated_at timestamptz not null default now()
);

alter table climate_vote.team
  add column if not exists attendance_pin_hash text;

create table if not exists climate_vote.attendance_auth_session (
  token_hash text primary key check (length(token_hash) = 64),
  scope text not null check (scope in ('team','hq')),
  team_id uuid references climate_vote.team(id),
  actor_label text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((scope = 'team' and team_id is not null) or (scope = 'hq' and team_id is null))
);

create table if not exists climate_vote.attendance_auth_attempt (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('team','hq')),
  subject text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists attendance_auth_attempt_idx
  on climate_vote.attendance_auth_attempt(scope, subject, attempted_at desc);

create table if not exists climate_vote.round_attendance_snapshot (
  round_id text primary key references climate_vote.rounds(id),
  eligible_count int not null check (eligible_count >= 0),
  captured_at timestamptz not null default now()
);

alter table climate_vote.assembly_member enable row level security;
alter table climate_vote.team_assignment enable row level security;
alter table climate_vote.attendance enable row level security;
alter table climate_vote.attendance_audit_log enable row level security;
alter table climate_vote.attendance_secret enable row level security;
alter table climate_vote.attendance_auth_session enable row level security;
alter table climate_vote.attendance_auth_attempt enable row level security;
alter table climate_vote.round_attendance_snapshot enable row level security;

revoke all on climate_vote.assembly_member, climate_vote.team_assignment,
  climate_vote.attendance, climate_vote.attendance_audit_log,
  climate_vote.attendance_secret, climate_vote.attendance_auth_session,
  climate_vote.attendance_auth_attempt, climate_vote.round_attendance_snapshot
from anon, authenticated;

create or replace function climate_vote.attendance_token_row(p_token text)
returns climate_vote.attendance_auth_session
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_row climate_vote.attendance_auth_session;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'attendance authorization required';
  end if;
  select * into v_row
  from climate_vote.attendance_auth_session s
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and s.expires_at > now();
  if not found then
    raise exception 'attendance authorization expired';
  end if;
  return v_row;
end
$$;

create or replace function climate_vote.attendance_issue_token(
  p_scope text, p_team_id uuid, p_actor_label text)
returns text
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_token text;
begin
  v_token := encode(gen_random_bytes(32), 'hex');
  delete from climate_vote.attendance_auth_session where expires_at <= now();
  insert into climate_vote.attendance_auth_session
    (token_hash, scope, team_id, actor_label, expires_at)
  values
    (encode(digest(v_token, 'sha256'), 'hex'), p_scope, p_team_id,
     left(trim(p_actor_label), 80), now() + interval '8 hours');
  return v_token;
end
$$;

create or replace function climate_vote.attendance_team_unlock(
  p_join_code text, p_pin text)
returns text
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_team climate_vote.team;
  v_failures int;
begin
  select count(*) into v_failures
  from climate_vote.attendance_auth_attempt
  where scope = 'team' and subject = p_join_code and not succeeded
    and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then return null; end if;

  select * into v_team from climate_vote.team
  where join_code = p_join_code and status = 'active';
  if not found or v_team.attendance_pin_hash is null
      or crypt(p_pin, v_team.attendance_pin_hash) <> v_team.attendance_pin_hash then
    insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
    values ('team', coalesce(p_join_code, ''), false);
    return null;
  end if;
  insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
  values ('team', p_join_code, true);
  return climate_vote.attendance_issue_token('team', v_team.id, '조 모더레이터 · ' || v_team.name);
end
$$;

create or replace function climate_vote.attendance_hq_unlock(
  p_password text, p_actor_label text)
returns text
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_hash text;
  v_failures int;
  v_actor text := trim(p_actor_label);
begin
  if length(v_actor) < 2 or length(v_actor) > 80 then
    raise exception 'operator name required';
  end if;
  select count(*) into v_failures
  from climate_vote.attendance_auth_attempt
  where scope = 'hq' and subject = 'hq' and not succeeded
    and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then return null; end if;

  select secret_hash into v_hash
  from climate_vote.attendance_secret where secret_key = 'hq_password';
  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
    values ('hq', 'hq', false);
    return null;
  end if;
  insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
  values ('hq', 'hq', true);
  return climate_vote.attendance_issue_token('hq', null, v_actor);
end
$$;

create or replace function climate_vote.attendance_hq_summary()
returns table(
  team_id uuid, roster_total int, current_present int, late int,
  absent int, early_leave int, unconfirmed int)
language sql security definer
set search_path = climate_vote, pg_temp as $$
  select t.id,
    count(ta.id) filter (where ta.active and m.active)::int,
    count(a.id) filter (where ta.active and m.active and a.base_status='present'
      and a.checked_out_at is null)::int,
    count(a.id) filter (where ta.active and m.active and a.is_late)::int,
    count(a.id) filter (where ta.active and m.active and a.base_status='absent')::int,
    count(a.id) filter (where ta.active and m.active and a.is_early_leave)::int,
    count(a.id) filter (where ta.active and m.active and a.base_status='unconfirmed')::int
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id=t.id
  left join climate_vote.assembly_member m on m.id=ta.member_id
  left join climate_vote.attendance a on a.assignment_id=ta.id
  where t.status='active'
  group by t.id;
$$;

create or replace function climate_vote.attendance_roster(p_token text)
returns table(
  assignment_id uuid, member_id uuid, official_id text, member_name text,
  team_id uuid, team_name text, active boolean, base_status text,
  checked_in_at timestamptz, is_late boolean, checked_out_at timestamptz,
  is_early_leave boolean, updated_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  return query
  select ta.id, m.id, m.official_id, m.name, t.id, t.name,
    (ta.active and m.active), a.base_status, a.checked_in_at, a.is_late,
    a.checked_out_at, a.is_early_leave, greatest(a.updated_at, ta.updated_at, m.updated_at)
  from climate_vote.team_assignment ta
  join climate_vote.assembly_member m on m.id=ta.member_id
  join climate_vote.team t on t.id=ta.team_id
  join climate_vote.attendance a on a.assignment_id=ta.id
  where v_auth.scope='hq' or ta.team_id=v_auth.team_id
  order by t.name, nullif(regexp_replace(m.official_id, '\D', '', 'g'), '')::int nulls last,
    m.official_id;
end
$$;

create or replace function climate_vote.attendance_set(
  p_token text, p_assignment_id uuid, p_action text, p_occurred_at timestamptz default now())
returns void
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
  v_assignment climate_vote.team_assignment;
  v_before jsonb;
  v_after jsonb;
begin
  if p_action not in ('unconfirmed','present','late','absent','early_leave') then
    raise exception 'invalid attendance action';
  end if;
  v_auth := climate_vote.attendance_token_row(p_token);
  select * into v_assignment from climate_vote.team_assignment where id=p_assignment_id;
  if not found or not v_assignment.active
      or (v_auth.scope='team' and v_assignment.team_id<>v_auth.team_id) then
    raise exception 'assignment outside attendance scope';
  end if;
  select to_jsonb(a) into v_before from climate_vote.attendance a
  where assignment_id=p_assignment_id for update;

  if p_action='unconfirmed' then
    update climate_vote.attendance set base_status='unconfirmed', checked_in_at=null,
      is_late=false, checked_out_at=null, is_early_leave=false, updated_at=now()
    where assignment_id=p_assignment_id;
  elsif p_action='absent' then
    update climate_vote.attendance set base_status='absent', checked_in_at=null,
      is_late=false, checked_out_at=null, is_early_leave=false, updated_at=now()
    where assignment_id=p_assignment_id;
  elsif p_action='early_leave' then
    update climate_vote.attendance set base_status='present',
      checked_in_at=coalesce(checked_in_at, p_occurred_at),
      checked_out_at=p_occurred_at, is_early_leave=true, updated_at=now()
    where assignment_id=p_assignment_id;
  else
    update climate_vote.attendance set base_status='present', checked_in_at=p_occurred_at,
      is_late=(p_action='late'), checked_out_at=null, is_early_leave=false, updated_at=now()
    where assignment_id=p_assignment_id;
  end if;

  select to_jsonb(a) into v_after from climate_vote.attendance a
  where assignment_id=p_assignment_id;
  insert into climate_vote.attendance_audit_log
    (session_id, team_id, assignment_id, action, before_value, after_value, actor_scope, actor_label)
  values (v_assignment.session_id, v_assignment.team_id, p_assignment_id,
    'attendance.'||p_action, v_before, v_after, v_auth.scope, v_auth.actor_label);
end
$$;

create or replace function climate_vote.attendance_bulk_present(
  p_token text, p_assignment_ids uuid[])
returns int
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  if coalesce(array_length(p_assignment_ids,1),0) > 200 then
    raise exception 'bulk attendance limit exceeded';
  end if;
  foreach v_id in array coalesce(p_assignment_ids, array[]::uuid[]) loop
    perform climate_vote.attendance_set(p_token, v_id, 'present', now());
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

create or replace function climate_vote.attendance_finalize_absent(p_token text)
returns int
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
  v_id uuid;
  v_count int := 0;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  for v_id in
    select a.assignment_id
    from climate_vote.attendance a
    join climate_vote.team_assignment ta on ta.id=a.assignment_id
    where a.base_status='unconfirmed' and ta.active
      and (v_auth.scope='hq' or ta.team_id=v_auth.team_id)
  loop
    perform climate_vote.attendance_set(p_token, v_id, 'absent', now());
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

create or replace function climate_vote.attendance_member_save(
  p_token text, p_assignment_id uuid, p_official_id text, p_name text,
  p_team_id uuid default null, p_active boolean default true)
returns uuid
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
  v_assignment climate_vote.team_assignment;
  v_member climate_vote.assembly_member;
  v_target_team uuid;
  v_session_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if length(trim(p_official_id)) not between 1 and 40
      or length(trim(p_name)) not between 1 and 100 then
    raise exception 'invalid member fields';
  end if;
  v_auth := climate_vote.attendance_token_row(p_token);
  if p_assignment_id is null then
    v_target_team := case when v_auth.scope='team' then v_auth.team_id else p_team_id end;
    select session_id into v_session_id from climate_vote.team where id=v_target_team;
    if v_session_id is null then raise exception 'target team required'; end if;
    insert into climate_vote.assembly_member(official_id,name,active,source_hash)
    values(trim(p_official_id),trim(p_name),p_active,'manual')
    returning * into v_member;
    insert into climate_vote.team_assignment(session_id,team_id,member_id,active)
    values(v_session_id,v_target_team,v_member.id,p_active)
    returning * into v_assignment;
    insert into climate_vote.attendance(assignment_id,base_status)
    values(v_assignment.id,'unconfirmed');
    v_before := null;
  else
    select * into v_assignment from climate_vote.team_assignment where id=p_assignment_id for update;
    if not found or (v_auth.scope='team' and v_assignment.team_id<>v_auth.team_id) then
      raise exception 'assignment outside attendance scope';
    end if;
    select * into v_member from climate_vote.assembly_member where id=v_assignment.member_id for update;
    v_before := jsonb_build_object('member',to_jsonb(v_member),'assignment',to_jsonb(v_assignment));
    v_target_team := case when v_auth.scope='hq' then coalesce(p_team_id,v_assignment.team_id)
                          else v_assignment.team_id end;
    perform 1 from climate_vote.team
    where id=v_target_team and session_id=v_assignment.session_id;
    if not found then raise exception 'target team must belong to the same session'; end if;
    update climate_vote.assembly_member set official_id=trim(p_official_id),
      name=trim(p_name),
      active=case when v_auth.scope='hq' then p_active else active end,
      updated_at=now() where id=v_member.id
    returning * into v_member;
    update climate_vote.team_assignment set team_id=v_target_team, active=p_active,
      updated_at=now() where id=v_assignment.id returning * into v_assignment;
  end if;
  v_after := jsonb_build_object('member',to_jsonb(v_member),'assignment',to_jsonb(v_assignment));
  insert into climate_vote.attendance_audit_log
    (session_id,team_id,assignment_id,action,before_value,after_value,actor_scope,actor_label)
  values(v_assignment.session_id,v_assignment.team_id,v_assignment.id,
    case when p_assignment_id is null then 'member.add' else 'member.update' end,
    v_before,v_after,v_auth.scope,v_auth.actor_label);
  return v_assignment.id;
end
$$;

create or replace function climate_vote.attendance_hq_audit(p_token text, p_limit int default 200)
returns table(
  id bigint, team_id uuid, team_name text, assignment_id uuid, action text,
  before_value jsonb, after_value jsonb, actor_label text, created_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  return query
  select l.id,l.team_id,t.name,l.assignment_id,l.action,l.before_value,l.after_value,
    l.actor_label,l.created_at
  from climate_vote.attendance_audit_log l
  left join climate_vote.team t on t.id=l.team_id
  order by l.created_at desc
  limit least(greatest(p_limit,1),500);
end
$$;

create or replace function climate_vote.attendance_hq_set_team_pin(
  p_token text, p_team_id uuid, p_pin text)
returns void
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  if p_pin !~ '^[0-9]{6,10}$' then raise exception 'PIN must be 6 to 10 digits'; end if;
  update climate_vote.team
  set attendance_pin_hash=crypt(p_pin,gen_salt('bf',10))
  where id=p_team_id;
  if not found then raise exception 'team not found'; end if;
  insert into climate_vote.attendance_audit_log
    (team_id, action, before_value, after_value, actor_scope, actor_label)
  values (p_team_id, 'team.pin.rotate', null, null, 'hq', v_auth.actor_label);
end
$$;

create or replace function climate_vote.attendance_round_eligible_count(p_round_id text)
returns int
language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare
  v_snapshot int;
  v_count int;
begin
  select eligible_count into v_snapshot
  from climate_vote.round_attendance_snapshot where round_id=p_round_id;
  if found then return v_snapshot; end if;
  select count(*)::int into v_count
  from climate_vote.rounds r
  join climate_vote.team_assignment ta on ta.team_id=r.team_id and ta.active
  join climate_vote.assembly_member m on m.id=ta.member_id and m.active
  join climate_vote.attendance a on a.assignment_id=ta.id and a.base_status='present'
  where r.id=p_round_id
    and a.checked_in_at <= case when r.status='closed' then r.updated_at else now() end
    and (a.checked_out_at is null or a.checked_out_at >= r.created_at);
  return coalesce(v_count,0);
end
$$;

create or replace function climate_vote.capture_round_attendance()
returns trigger
language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
begin
  if new.status='closed' and old.status is distinct from 'closed' and new.team_id is not null then
    insert into climate_vote.round_attendance_snapshot(round_id,eligible_count)
    values(new.id,climate_vote.attendance_round_eligible_count(new.id))
    on conflict(round_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists rounds_capture_attendance on climate_vote.rounds;
create trigger rounds_capture_attendance
after update of status on climate_vote.rounds
for each row execute function climate_vote.capture_round_attendance();

-- Direct rows remain private under RLS; registration only supplies a change signal
-- to authorized clients while public HQ continues to read the aggregate RPC.
do $$ begin
  alter publication supabase_realtime add table climate_vote.attendance;
exception when duplicate_object then null; end $$;

create or replace function climate_vote.hq_teams()
returns table(id uuid, name text, subgroup text, capacity int, status text)
language sql security definer set search_path = climate_vote, pg_temp as $$
  select t.id,t.name,t.subgroup,
    coalesce(nullif(count(ta.id) filter(where ta.active and m.active),0),t.capacity)::int,
    t.status
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id=t.id
  left join climate_vote.assembly_member m on m.id=ta.member_id
  group by t.id,t.name,t.subgroup,t.capacity,t.status;
$$;

grant execute on function climate_vote.attendance_team_unlock(text,text),
  climate_vote.attendance_hq_unlock(text,text),
  climate_vote.attendance_hq_summary(),
  climate_vote.attendance_roster(text),
  climate_vote.attendance_set(text,uuid,text,timestamptz),
  climate_vote.attendance_bulk_present(text,uuid[]),
  climate_vote.attendance_finalize_absent(text),
  climate_vote.attendance_member_save(text,uuid,text,text,uuid,boolean),
  climate_vote.attendance_hq_audit(text,int),
  climate_vote.attendance_hq_set_team_pin(text,uuid,text),
  climate_vote.attendance_round_eligible_count(text)
to anon;

revoke execute on function climate_vote.attendance_token_row(text),
  climate_vote.attendance_issue_token(text,uuid,text),
  climate_vote.capture_round_attendance()
from anon, authenticated;
