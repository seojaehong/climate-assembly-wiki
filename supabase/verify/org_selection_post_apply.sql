\set ON_ERROR_STOP on

-- Read-only post-apply verification for the draft P1C organization selection migration.
-- Set expect_staff_grants=on only after the separately approved activation grants run.
\if :{?expect_staff_grants}
\else
  \set expect_staff_grants off
\endif

select set_config('platform.verify_expect_staff_grants', :'expect_staff_grants', false);

do $verify$
declare
  v_expect_staff_grants boolean := current_setting('platform.verify_expect_staff_grants')::boolean;
  v_count integer;
  v_table text;
  v_function text;
begin
  if to_regclass('climate_vote.org_context') is null then
    raise exception 'P1C verification failed: org_context is missing';
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'climate_vote'
    and table_name = 'org_context'
    and column_name in ('token_hash', 'session_id', 'user_id', 'org_id', 'created_at', 'expires_at')
    and is_nullable = 'NO';
  if v_count <> 6 then
    raise exception 'P1C verification failed: org_context columns are incomplete';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'climate_vote.org_context'::regclass
      and conname = 'org_context_expiry_order'
      and contype = 'c'
  ) then
    raise exception 'P1C verification failed: expiry constraint is missing';
  end if;

  if to_regclass('climate_vote.org_context_session_idx') is null
     or to_regclass('climate_vote.org_context_expiry_idx') is null then
    raise exception 'P1C verification failed: context indexes are incomplete';
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'climate_vote'
    and c.relname in ('org_context', 'assembly', 'session', 'discussion_topic', 'submission', 'ballot')
    and c.relrowsecurity;
  if v_count <> 6 then
    raise exception 'P1C verification failed: staff table RLS is incomplete';
  end if;

  select count(*) into v_count
  from (values
    ('assembly', 'assembly_tenant_read', 'SELECT'),
    ('assembly', 'assembly_tenant_write', 'ALL'),
    ('session', 'session_tenant_read', 'SELECT'),
    ('session', 'session_tenant_write', 'ALL'),
    ('discussion_topic', 'topic_tenant_read', 'SELECT'),
    ('discussion_topic', 'topic_tenant_write', 'ALL'),
    ('submission', 'submission_tenant_read', 'SELECT'),
    ('submission', 'submission_tenant_write', 'ALL'),
    ('ballot', 'ballot_tenant_read', 'SELECT'),
    ('ballot', 'ballot_tenant_write', 'ALL')
  ) as expected(tablename, policyname, command)
  join pg_policies p
    on p.schemaname = 'climate_vote'
   and p.tablename = expected.tablename
   and p.policyname = expected.policyname
   and p.cmd = expected.command
  where 'authenticated' = any(p.roles)
    and p.qual is not null
    and (expected.command = 'SELECT' or p.with_check is not null);
  if v_count <> 10 then
    raise exception 'P1C verification failed: tenant policies are incomplete';
  end if;

  foreach v_function in array array[
    'climate_vote.request_org_context_token()',
    'climate_vote.auth_session_id()',
    'climate_vote.selected_org_for_request()',
    'climate_vote.my_orgs()',
    'climate_vote.org_select(uuid)'
  ] loop
    if to_regprocedure(v_function) is null then
      raise exception 'P1C verification failed: required function is missing';
    end if;
  end loop;

  if v_expect_staff_grants
     and not has_schema_privilege('authenticated', 'climate_vote', 'USAGE') then
    raise exception 'P1C verification failed: schema usage state is unexpected';
  end if;

  if not has_function_privilege('authenticated', 'climate_vote.my_orgs()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'climate_vote.org_select(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.my_orgs()', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.org_select(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.request_org_context_token()', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.auth_session_id()', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.selected_org_for_request()', 'EXECUTE') then
    raise exception 'P1C verification failed: function privileges are unsafe';
  end if;

  if has_table_privilege('anon', 'climate_vote.org_context', 'SELECT')
     or has_table_privilege('authenticated', 'climate_vote.org_context', 'SELECT') then
    raise exception 'P1C verification failed: org_context is directly readable';
  end if;

  if has_table_privilege('authenticated', 'climate_vote.membership', 'SELECT')
     <> v_expect_staff_grants then
    raise exception 'P1C verification failed: membership grant state is unexpected';
  end if;
  if has_table_privilege('authenticated', 'climate_vote.membership', 'INSERT')
     or has_table_privilege('authenticated', 'climate_vote.membership', 'UPDATE')
     or has_table_privilege('authenticated', 'climate_vote.membership', 'DELETE') then
    raise exception 'P1C verification failed: membership mutation grant is present';
  end if;

  foreach v_table in array array['assembly', 'session', 'discussion_topic', 'submission', 'ballot'] loop
    if has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'SELECT')
       <> v_expect_staff_grants
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'INSERT')
       <> v_expect_staff_grants
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'UPDATE')
       <> v_expect_staff_grants then
      raise exception 'P1C verification failed: staff table grant state is unexpected';
    end if;
    if has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'DELETE') then
      raise exception 'P1C verification failed: staff table delete grant is present';
    end if;
  end loop;
end $verify$;

select jsonb_build_object(
  'status', 'passed',
  'staff_grants_active', current_setting('platform.verify_expect_staff_grants')::boolean,
  'database_mutation_executed', false
) as org_selection_post_apply;

\echo === P1C ORG SELECTION POST-APPLY VERIFICATION PASSED ===
