-- Draft only. Do not apply to production without a separate activation approval.
-- Adds tab-scoped organization selection without granting staff table access.
-- The client sends an opaque context token; the database revalidates the
-- authenticated user, Auth session, active membership, and active organization.

create table if not exists climate_vote.org_context (
  token_hash bytea primary key,
  session_id uuid not null,
  user_id uuid not null,
  org_id uuid not null references climate_vote.org(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  constraint org_context_expiry_order check (expires_at > created_at)
);

create index if not exists org_context_session_idx
  on climate_vote.org_context(session_id, user_id);
create index if not exists org_context_expiry_idx
  on climate_vote.org_context(expires_at);

alter table climate_vote.org_context enable row level security;
revoke all on climate_vote.org_context from public, anon, authenticated;

-- Reassert RLS before any future staff table grants. The legacy session table
-- had tenant policies but no RLS enable statement in the P1 chain.
alter table climate_vote.assembly enable row level security;
alter table climate_vote.session enable row level security;
alter table climate_vote.discussion_topic enable row level security;
alter table climate_vote.submission enable row level security;
alter table climate_vote.ballot enable row level security;

create or replace function climate_vote.request_org_context_token()
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, climate_vote, extensions as $fn$
declare
  v_headers jsonb;
  v_token_text text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_token_text := nullif(v_headers ->> 'x-platform-org-context', '');
    if v_token_text is null then return null; end if;
    return v_token_text::uuid;
  exception
    when invalid_text_representation then return null;
  end;
end $fn$;

create or replace function climate_vote.auth_session_id()
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, climate_vote as $fn$
declare
  v_session_text text;
begin
  v_session_text := nullif(auth.jwt() ->> 'session_id', '');
  if v_session_text is null then return null; end if;
  begin
    return v_session_text::uuid;
  exception
    when invalid_text_representation then return null;
  end;
end $fn$;

create or replace function climate_vote.selected_org_for_request()
returns uuid language sql stable security definer
set search_path = pg_catalog, climate_vote, extensions as $fn$
  select c.org_id
  from climate_vote.org_context c
  join climate_vote.membership m
    on m.org_id = c.org_id
   and m.user_id = c.user_id
   and m.status = 'active'
  join climate_vote.org o
    on o.id = c.org_id
   and o.status = 'active'
  where c.token_hash = extensions.digest(climate_vote.request_org_context_token()::text, 'sha256')
    and c.user_id = auth.uid()
    and c.session_id = climate_vote.auth_session_id()
    and c.expires_at > current_timestamp
  limit 1;
$fn$;

create or replace function climate_vote.my_orgs()
returns table(id uuid, name text, slug text, selected boolean)
language plpgsql stable security definer
set search_path = pg_catalog, climate_vote as $fn$
declare
  v_user_id uuid := auth.uid();
  v_selected uuid;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'authenticated user required';
  end if;

  select count(distinct m.org_id), climate_vote.selected_org_for_request()
    into v_count, v_selected
  from climate_vote.membership m
  join climate_vote.org o on o.id = m.org_id and o.status = 'active'
  where m.user_id = v_user_id and m.status = 'active';

  return query
    select o.id, o.name, o.slug,
      case when v_count = 1 then true else o.id = v_selected end
    from climate_vote.membership m
    join climate_vote.org o on o.id = m.org_id and o.status = 'active'
    where m.user_id = v_user_id and m.status = 'active'
    group by o.id, o.name, o.slug
    order by o.name, o.id;
end $fn$;

create or replace function climate_vote.org_select(p_org uuid)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, climate_vote, extensions as $fn$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid := climate_vote.auth_session_id();
  v_previous_token uuid := climate_vote.request_org_context_token();
  v_token uuid := gen_random_uuid();
begin
  if v_user_id is null or v_session_id is null then
    raise exception 'authenticated Supabase session required';
  end if;

  delete from climate_vote.org_context c
  where c.expires_at <= clock_timestamp();

  if not exists (
    select 1
    from climate_vote.membership m
    join climate_vote.org o on o.id = m.org_id and o.status = 'active'
    where m.user_id = v_user_id
      and m.org_id = p_org
      and m.status = 'active'
  ) then
    raise exception 'organization selection is not allowed';
  end if;

  if v_previous_token is not null then
    delete from climate_vote.org_context c
    where c.token_hash = extensions.digest(v_previous_token::text, 'sha256')
      and c.user_id = v_user_id
      and c.session_id = v_session_id;
  end if;

  insert into climate_vote.org_context(token_hash, session_id, user_id, org_id)
  values (extensions.digest(v_token::text, 'sha256'), v_session_id, v_user_id, p_org);

  return jsonb_build_object('org_id', p_org, 'context_token', v_token);
end $fn$;

create or replace function climate_vote.org_of_uid()
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, climate_vote as $fn$
declare
  v_ids uuid[];
  v_selected uuid;
begin
  select array_agg(distinct m.org_id order by m.org_id) into v_ids
  from climate_vote.membership m
  join climate_vote.org o on o.id = m.org_id and o.status = 'active'
  where m.user_id = auth.uid() and m.status = 'active';

  if v_ids is null or array_length(v_ids, 1) is null then
    return null;
  end if;
  if array_length(v_ids, 1) = 1 then
    return v_ids[1];
  end if;

  v_selected := climate_vote.selected_org_for_request();
  if v_selected is null then
    raise exception 'organization selection required';
  end if;
  return v_selected;
end $fn$;

drop policy if exists assembly_tenant_read on climate_vote.assembly;
drop policy if exists assembly_tenant_write on climate_vote.assembly;
drop policy if exists session_tenant_read on climate_vote.session;
drop policy if exists session_tenant_write on climate_vote.session;
drop policy if exists topic_tenant_read on climate_vote.discussion_topic;
drop policy if exists topic_tenant_write on climate_vote.discussion_topic;
drop policy if exists submission_tenant_read on climate_vote.submission;
drop policy if exists submission_tenant_write on climate_vote.submission;
drop policy if exists ballot_tenant_read on climate_vote.ballot;
drop policy if exists ballot_tenant_write on climate_vote.ballot;

create policy assembly_tenant_read on climate_vote.assembly for select to authenticated
  using (org_id = climate_vote.org_of_uid());
create policy assembly_tenant_write on climate_vote.assembly for all to authenticated
  using (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = assembly.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'))
  with check (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = assembly.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'));

create policy session_tenant_read on climate_vote.session for select to authenticated
  using (org_id = climate_vote.org_of_uid());
create policy session_tenant_write on climate_vote.session for all to authenticated
  using (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = session.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'))
  with check (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = session.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'));

create policy topic_tenant_read on climate_vote.discussion_topic for select to authenticated
  using (org_id = climate_vote.org_of_uid());
create policy topic_tenant_write on climate_vote.discussion_topic for all to authenticated
  using (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = discussion_topic.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'))
  with check (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = discussion_topic.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'));

create policy submission_tenant_read on climate_vote.submission for select to authenticated
  using (org_id = climate_vote.org_of_uid());
create policy submission_tenant_write on climate_vote.submission for all to authenticated
  using (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = submission.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'))
  with check (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = submission.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'));

create policy ballot_tenant_read on climate_vote.ballot for select to authenticated
  using (org_id = climate_vote.org_of_uid());
create policy ballot_tenant_write on climate_vote.ballot for all to authenticated
  using (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = ballot.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'))
  with check (org_id = climate_vote.org_of_uid() and exists (
    select 1 from climate_vote.membership m where m.user_id = auth.uid() and m.org_id = ballot.org_id
      and m.role in ('operator', 'org_admin') and m.status = 'active'));

revoke execute on function
  climate_vote.request_org_context_token(),
  climate_vote.auth_session_id(),
  climate_vote.selected_org_for_request(),
  climate_vote.my_orgs(),
  climate_vote.org_select(uuid)
from public;

grant execute on function climate_vote.my_orgs(), climate_vote.org_select(uuid) to authenticated;

-- Activation grants remain intentionally disabled in this draft.
-- grant select on climate_vote.membership, climate_vote.assembly, climate_vote.session,
--   climate_vote.discussion_topic, climate_vote.submission, climate_vote.ballot to authenticated;
