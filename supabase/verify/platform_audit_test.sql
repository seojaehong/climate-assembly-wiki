\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

do $structural$
declare
  v_capture_count integer;
  v_owner_oid oid;
begin
  if to_regclass('climate_vote.platform_audit_event') is null
     or to_regprocedure('climate_vote.platform_audit_row_change()') is null
     or to_regprocedure('climate_vote.platform_audit_list(bigint,integer)') is null then
    raise exception 'A6 audit verification failed: required object is missing';
  end if;

  select c.relowner into strict v_owner_oid
  from pg_class c
  where c.oid = 'climate_vote.platform_audit_event'::regclass;
  if pg_get_userbyid(v_owner_oid) in ('anon', 'authenticated', 'authenticator', 'service_role')
     or not exists (
       select 1 from pg_roles r
       where r.oid = v_owner_oid and (r.rolsuper or r.rolbypassrls)
     )
     or exists (
       select 1
       from (values
         ('climate_vote.platform_audit_reject_change()'),
         ('climate_vote.platform_audit_org_for_row(text,jsonb)'),
         ('climate_vote.platform_audit_row_change()'),
         ('climate_vote.platform_audit_list(bigint,integer)')
       ) expected(signature)
       join pg_proc p on p.oid = to_regprocedure(expected.signature)
       where p.proowner <> v_owner_oid
     ) then
    raise exception 'A6 audit verification failed: owner contract is unsafe';
  end if;

  if exists (
    select 1
    from (values
      ('climate_vote.platform_audit_reject_change()', 'v', array['search_path=pg_catalog']::text[]),
      ('climate_vote.platform_audit_org_for_row(text,jsonb)', 's', array['search_path=pg_catalog, climate_vote', 'row_security=off']::text[]),
      ('climate_vote.platform_audit_row_change()', 'v', array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[]),
      ('climate_vote.platform_audit_list(bigint,integer)', 's', array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[])
    ) expected(signature, volatility, config)
    join pg_proc p on p.oid = to_regprocedure(expected.signature)
    where not p.prosecdef
       or p.provolatile <> expected.volatility::"char"
       or coalesce(p.proconfig, '{}'::text[]) <> expected.config
  ) then
    raise exception 'A6 audit verification failed: function security contract is unsafe';
  end if;

  select count(*) into v_capture_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'climate_vote'
    and t.tgname = 'platform_audit_capture'
    and not t.tgisinternal
    and t.tgenabled = 'O'
    and t.tgtype = 31;
  if v_capture_count <> 15 then
    raise exception 'A6 audit verification failed: expected 15 enabled capture triggers, found %', v_capture_count;
  end if;

  if has_table_privilege('anon', 'climate_vote.platform_audit_event', 'SELECT')
     or has_table_privilege('authenticated', 'climate_vote.platform_audit_event', 'SELECT')
     or has_table_privilege('service_role', 'climate_vote.platform_audit_event', 'SELECT')
     or has_table_privilege('authenticated', 'climate_vote.platform_audit_event', 'INSERT')
     or has_table_privilege('authenticated', 'climate_vote.platform_audit_event', 'UPDATE')
     or has_table_privilege('authenticated', 'climate_vote.platform_audit_event', 'DELETE') then
    raise exception 'A6 audit verification failed: direct table privilege is unsafe';
  end if;

  if exists (
    select 1
    from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      'climate_vote.platform_audit_event',
      privileges.privilege_name
    )
  ) then
    raise exception 'A6 audit verification failed: runtime table privilege is unsafe';
  end if;

  if exists (
       select 1
       from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) privileges(privilege_name)
       where has_any_column_privilege(
         roles.role_name,
         'climate_vote.platform_audit_event',
         privileges.privilege_name
       )
     )
     or exists (
       select 1
       from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
       cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) privileges(privilege_name)
       where has_sequence_privilege(
         roles.role_name,
         'climate_vote.platform_audit_event_id_seq',
         privileges.privilege_name
       )
     ) then
    raise exception 'A6 audit verification failed: column or sequence privilege is unsafe';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'climate_vote.platform_audit_event'::regclass)
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'climate_vote.platform_audit_event'::regclass
         and tgname = 'platform_audit_event_immutable'
         and not tgisinternal and tgenabled = 'O' and tgtype = 27
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'climate_vote.platform_audit_event'::regclass
         and tgname = 'platform_audit_event_no_truncate'
         and not tgisinternal and tgenabled = 'O' and tgtype = 34
     ) then
    raise exception 'A6 audit verification failed: append-only table contract is unsafe';
  end if;

  if not has_function_privilege('authenticated', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE') then
    raise exception 'A6 audit verification failed: RPC privilege is unsafe';
  end if;

  if has_function_privilege('public', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
     or has_function_privilege('authenticator', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
     or exists (
       select 1
       from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
       cross join (values
         ('climate_vote.platform_audit_reject_change()'),
         ('climate_vote.platform_audit_org_for_row(text,jsonb)'),
         ('climate_vote.platform_audit_row_change()')
       ) expected(signature)
       where has_function_privilege(roles.role_name, expected.signature, 'EXECUTE')
     ) then
    raise exception 'A6 audit verification failed: helper privilege is unsafe';
  end if;
end
$structural$;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into climate_vote.org(id, slug, name) values
  ('20000000-0000-4000-8000-000000000001', 'audit-org-one', 'Audit organization one'),
  ('20000000-0000-4000-8000-000000000002', 'audit-org-two', 'Audit organization two'),
  ('20000000-0000-4000-8000-000000000003', 'audit-org-three', 'Audit organization three');

insert into climate_vote.membership(id, org_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'org_admin', 'active'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'operator', 'active'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'facilitator', 'active');

insert into climate_vote.assembly(id, slug, title, org_id) values
  ('40000000-0000-4000-8000-000000000001', 'audit-assembly-one', 'Audit assembly one', '20000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', 'audit-assembly-two', 'Audit assembly two', '20000000-0000-4000-8000-000000000002');

do $cross_org_move_denied$
begin
  update climate_vote.assembly
  set org_id = '20000000-0000-4000-8000-000000000002'
  where id = '40000000-0000-4000-8000-000000000001';
  raise exception 'A6 audit verification failed: cross-organization move unexpectedly succeeded';
exception when raise_exception then
  if sqlerrm <> 'platform audit refuses cross-organization resource move for climate_vote.assembly' then
    raise;
  end if;
end
$cross_org_move_denied$;

update climate_vote.assembly
set title = 'TOP_SECRET_VALUE_MUST_NOT_BE_COPIED'
where id = '40000000-0000-4000-8000-000000000001';

insert into climate_vote.session(id, slug, title, status, assembly_id, ordinal, held_on, org_id) values
  ('50000000-0000-4000-8000-000000000001', 'audit-session-one', 'Audit session one', 'draft', '40000000-0000-4000-8000-000000000001', 1, date '2026-09-03', '20000000-0000-4000-8000-000000000001');
insert into climate_vote.team(id, session_id, name, join_code, ordinal, org_id) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Audit team', '934201', 1, '20000000-0000-4000-8000-000000000001');
insert into climate_vote.discussion_topic(id, session_id, ordinal, prompt, org_id) values
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1, 'Audit prompt', '20000000-0000-4000-8000-000000000001');
insert into climate_vote.submission(id, topic_id, team_id, org_id) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
insert into climate_vote.submission_item(id, submission_id, ordinal, content) values
  ('90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 1, 'Sensitive participant content');
-- Delete the item directly while its parent remains available. The legacy
-- archive intentionally keeps a foreign key to submission, so deleting the
-- parent would test an unsupported history-destruction path rather than P4.
delete from climate_vote.submission_item
where id = '90000000-0000-4000-8000-000000000001';

do $semantics$
declare
  v_page jsonb;
begin
  if not exists (
    select 1 from climate_vote.platform_audit_event e
    where e.resource_type = 'assembly'
      and e.resource_id = '40000000-0000-4000-8000-000000000001'
      and e.operation = 'update'
      and e.changed_fields = array['title']::text[]
      and e.org_id = '20000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'A6 audit verification failed: update metadata was not captured';
  end if;

  if not exists (
    select 1 from climate_vote.platform_audit_event e
    where e.resource_type = 'submission_item'
      and e.resource_id = '90000000-0000-4000-8000-000000000001'
      and e.operation = 'insert'
      and e.org_id = '20000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'A6 audit verification failed: child tenant was not resolved';
  end if;

  if not exists (
    select 1 from climate_vote.platform_audit_event e
    where e.resource_type = 'submission_item'
      and e.resource_id = '90000000-0000-4000-8000-000000000001'
      and e.operation = 'delete'
      and e.org_id = '20000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'A6 audit verification failed: delete tenant context was lost';
  end if;

  if exists (
    select 1 from climate_vote.platform_audit_event e
    where to_jsonb(e)::text like '%TOP_SECRET_VALUE%'
       or to_jsonb(e)::text like '%Sensitive participant content%'
  ) then
    raise exception 'A6 audit verification failed: row values leaked into metadata';
  end if;

  v_page := climate_vote.platform_audit_list(null, 2);
  if jsonb_array_length(v_page -> 'events') <> 2
     or (v_page ->> 'next_after_id') is null
     or exists (
       select 1 from jsonb_array_elements(v_page -> 'events') item
       where item ->> 'resource_id' = '40000000-0000-4000-8000-000000000002'
          or item ? 'org_id'
          or jsonb_typeof(item -> 'id') <> 'string'
          or jsonb_typeof(item -> 'transaction_id') <> 'string'
     ) then
    raise exception 'A6 audit verification failed: pagination or tenant isolation is unsafe';
  end if;

  begin
    update climate_vote.platform_audit_event set actor_role = 'tampered' where id = 1;
    raise exception 'A6 audit verification failed: audit update unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'platform audit events are append-only' then raise; end if;
  end;

  begin
    delete from climate_vote.platform_audit_event where id = 1;
    raise exception 'A6 audit verification failed: audit delete unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'platform audit events are append-only' then raise; end if;
  end;
end
$semantics$;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', false);
do $facilitator_denied$
begin
  perform climate_vote.platform_audit_list(null, 100);
  raise exception 'A6 audit verification failed: facilitator unexpectedly read audit events';
exception when raise_exception then
  if sqlerrm <> 'audit log access is not allowed' then raise; end if;
end
$facilitator_denied$;

select 'A6 platform audit semantic verification passed' as result;
