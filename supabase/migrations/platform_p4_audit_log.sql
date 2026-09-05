-- Draft only. Do not apply without separate production approval.
-- A6 adds an append-only, tenant-scoped user action audit trail.
-- Operational prerequisite: P1 -> seed/s20 -> P1a -> P2 -> P1b/P1c ->
-- P2a -> P3, with each production approval and verification completed.

begin;

revoke create on schema climate_vote from public, anon, authenticated, authenticator, service_role;

create table climate_vote.platform_audit_event (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  transaction_id bigint not null default txid_current(),
  actor_user_id uuid,
  actor_role text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  resource_id text not null check (length(resource_id) between 1 and 200),
  changed_fields text[] not null default '{}',
  constraint platform_audit_changed_fields_bounded
    check (cardinality(changed_fields) <= 100)
);

create index platform_audit_event_org_page_idx
  on climate_vote.platform_audit_event(org_id, id desc);
create index platform_audit_event_actor_idx
  on climate_vote.platform_audit_event(org_id, actor_user_id, id desc)
  where actor_user_id is not null;

alter table climate_vote.platform_audit_event enable row level security;
revoke all on climate_vote.platform_audit_event from public, anon, authenticated, authenticator, service_role;
revoke all on sequence climate_vote.platform_audit_event_id_seq
from public, anon, authenticated, authenticator, service_role;

create or replace function climate_vote.platform_audit_reject_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception 'platform audit events are append-only';
end
$function$;

revoke all on function climate_vote.platform_audit_reject_change()
from public, anon, authenticated, authenticator, service_role;

create trigger platform_audit_event_immutable
before update or delete on climate_vote.platform_audit_event
for each row execute function climate_vote.platform_audit_reject_change();

create trigger platform_audit_event_no_truncate
before truncate on climate_vote.platform_audit_event
for each statement execute function climate_vote.platform_audit_reject_change();

create or replace function climate_vote.platform_audit_org_for_row(
  p_resource_type text,
  p_row jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, climate_vote
set row_security = off
as $function$
declare
  v_org_id uuid;
  v_parent_id text;
begin
  case p_resource_type
    when 'org' then
      return (p_row ->> 'id')::uuid;
    when 'submission_item' then
      v_parent_id := p_row ->> 'submission_id';
      select s.org_id into v_org_id
      from climate_vote.submission s
      where s.id = v_parent_id::uuid;
      return coalesce(
        v_org_id,
        nullif(current_setting(
          'climate_vote.audit_submission_' || replace(v_parent_id, '-', ''), true
        ), '')::uuid
      );
    when 'ballot_item' then
      v_parent_id := p_row ->> 'ballot_id';
      select b.org_id into v_org_id
      from climate_vote.ballot b
      where b.id = v_parent_id::uuid;
      return coalesce(
        v_org_id,
        nullif(current_setting(
          'climate_vote.audit_ballot_' || replace(v_parent_id, '-', ''), true
        ), '')::uuid
      );
    when 'issue_link' then
      v_parent_id := p_row ->> 'issue_id';
      select coalesce(i.org_id, s.org_id) into v_org_id
      from climate_vote.submission_item item
      join climate_vote.submission s on s.id = item.submission_id
      left join climate_vote.issue i on i.id = v_parent_id::uuid
      where item.id = (p_row ->> 'item_id')::uuid;
      return coalesce(
        v_org_id,
        nullif(current_setting(
          'climate_vote.audit_issue_' || replace(v_parent_id, '-', ''), true
        ), '')::uuid
      );
    else
      return nullif(p_row ->> 'org_id', '')::uuid;
  end case;
end
$function$;

revoke all on function climate_vote.platform_audit_org_for_row(text, jsonb)
from public, anon, authenticated, authenticator, service_role;

create or replace function climate_vote.platform_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, climate_vote, auth
set row_security = off
as $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_org_id uuid;
  v_old_org_id uuid;
  v_new_org_id uuid;
  v_resource_id text;
  v_changed_fields text[];
  v_actor_user_id uuid := auth.uid();
  v_actor_role text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_org_id := climate_vote.platform_audit_org_for_row(tg_table_name, v_old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_org_id := climate_vote.platform_audit_org_for_row(tg_table_name, v_new);
  end if;
  if tg_op = 'UPDATE' and v_old_org_id is distinct from v_new_org_id then
    raise exception 'platform audit refuses cross-organization resource move for %.%', tg_table_schema, tg_table_name;
  end if;
  v_org_id := case when tg_op = 'DELETE' then v_old_org_id else v_new_org_id end;

  if v_org_id is null then
    raise exception 'platform audit event org could not be derived for %.%', tg_table_schema, tg_table_name;
  end if;

  if tg_table_name = 'issue_link' then
    v_resource_id := (v_row ->> 'issue_id') || ':' || (v_row ->> 'item_id');
  elsif tg_table_name = 'design_provisioning_operation' then
    v_resource_id := v_row ->> 'operation_id';
  else
    v_resource_id := v_row ->> 'id';
  end if;

  if v_resource_id is null or length(v_resource_id) > 200 then
    raise exception 'platform audit resource identity is invalid for %.%', tg_table_schema, tg_table_name;
  end if;

  if tg_op = 'DELETE' and tg_table_name in ('submission', 'ballot', 'issue') then
    perform set_config(
      'climate_vote.audit_' || tg_table_name || '_' || replace(v_resource_id, '-', ''),
      v_org_id::text,
      true
    );
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields
    from (
      select key from jsonb_object_keys(v_old) as old_keys(key)
      union
      select key from jsonb_object_keys(v_new) as new_keys(key)
    ) fields
    where v_old -> fields.key is distinct from v_new -> fields.key;
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed_fields
    from jsonb_object_keys(v_new) keys(key);
  else
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed_fields
    from jsonb_object_keys(v_old) keys(key);
  end if;

  select m.role into v_actor_role
  from climate_vote.membership m
  where m.user_id = v_actor_user_id
    and m.org_id = v_org_id
    and m.status = 'active'
  order by case m.role
    when 'org_admin' then 1
    when 'operator' then 2
    when 'hq' then 3
    else 4
  end
  limit 1;

  v_actor_role := coalesce(
    v_actor_role,
    nullif(auth.jwt() ->> 'role', ''),
    current_user
  );

  insert into climate_vote.platform_audit_event (
    org_id,
    actor_user_id,
    actor_role,
    operation,
    resource_type,
    resource_id,
    changed_fields
  ) values (
    v_org_id,
    v_actor_user_id,
    v_actor_role,
    lower(tg_op),
    tg_table_name,
    v_resource_id,
    v_changed_fields
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

revoke all on function climate_vote.platform_audit_row_change()
from public, anon, authenticated, authenticator, service_role;

do $preflight$
declare
  v_table text;
  v_missing bigint;
begin
  foreach v_table in array array[
    'membership', 'invitation', 'assembly', 'session', 'discussion_topic',
    'team', 'submission', 'ballot', 'issue', 'result_page',
    'design_provisioning_operation'
  ] loop
    execute format('select count(*) from climate_vote.%I where org_id is null', v_table)
      into v_missing;
    if v_missing > 0 then
      raise exception 'platform audit preflight failed: %.org_id has % unmapped rows', v_table, v_missing;
    end if;
  end loop;
end
$preflight$;

create trigger platform_audit_capture before insert or update or delete on climate_vote.org
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.membership
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.invitation
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.assembly
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.session
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.discussion_topic
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.team
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.submission
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.submission_item
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.ballot
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.ballot_item
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.issue
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.issue_link
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.result_page
for each row execute function climate_vote.platform_audit_row_change();
create trigger platform_audit_capture before insert or update or delete on climate_vote.design_provisioning_operation
for each row execute function climate_vote.platform_audit_row_change();

create or replace function climate_vote.platform_audit_list(
  p_after_id bigint default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, climate_vote, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_events jsonb;
  v_has_more boolean;
  v_next_after_id bigint;
begin
  if v_user_id is null then
    raise exception 'authenticated user required';
  end if;
  if p_after_id is not null and p_after_id <= 0 then
    raise exception 'audit cursor must be positive';
  end if;

  v_org_id := climate_vote.org_of_uid();
  if v_org_id is null or not exists (
    select 1
    from climate_vote.membership m
    where m.user_id = v_user_id
      and m.org_id = v_org_id
      and m.status = 'active'
      and m.role in ('org_admin', 'operator', 'hq')
  ) then
    raise exception 'audit log access is not allowed';
  end if;

  with page as (
    select e.*
    from climate_vote.platform_audit_event e
    where e.org_id = v_org_id
      and (p_after_id is null or e.id < p_after_id)
    order by e.id desc
    limit v_limit + 1
  ), visible as (
    select * from page order by id desc limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', visible.id::text,
      'occurred_at', visible.occurred_at,
      'transaction_id', visible.transaction_id::text,
      'actor_user_id', visible.actor_user_id,
      'actor_role', visible.actor_role,
      'operation', visible.operation,
      'resource_type', visible.resource_type,
      'resource_id', visible.resource_id,
      'changed_fields', visible.changed_fields
    ) order by visible.id desc), '[]'::jsonb),
    (select count(*) > v_limit from page),
    min(visible.id)
  into v_events, v_has_more, v_next_after_id
  from visible;

  return jsonb_build_object(
    'events', v_events,
    'next_after_id', case when v_has_more then v_next_after_id::text else null end
  );
end
$function$;

revoke all on function climate_vote.platform_audit_list(bigint, integer)
from public, anon, authenticator, service_role;
grant execute on function climate_vote.platform_audit_list(bigint, integer) to authenticated;

commit;
