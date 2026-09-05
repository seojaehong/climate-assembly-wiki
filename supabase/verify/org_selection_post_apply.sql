\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

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
  v_policy record;
  v_qual text;
  v_with_check text;
  v_expected_qual text;
  v_function_spec record;
  v_security_definer boolean;
  v_volatility "char";
  v_language name;
  v_config text[];
  v_column record;
  v_type text;
  v_not_null boolean;
  v_default text;
  v_constraint record;
  v_constraint_type "char";
  v_definition text;
  v_index record;
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

  for v_column in
    select * from (values
      ('token_hash', 'bytea', true, null::text),
      ('session_id', 'uuid', true, null::text),
      ('user_id', 'uuid', true, null::text),
      ('org_id', 'uuid', true, null::text),
      ('created_at', 'timestamp with time zone', true, 'now()'),
      ('expires_at', 'timestamp with time zone', true, '(now() + ''12:00:00''::interval)')
    ) as expected(column_name, data_type, required, default_expression)
  loop
    select format_type(a.atttypid, a.atttypmod), a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid)
      into strict v_type, v_not_null, v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'climate_vote.org_context'::regclass
      and a.attname = v_column.column_name
      and a.attnum > 0
      and not a.attisdropped;

    if v_type <> v_column.data_type
       or v_not_null <> v_column.required
       or v_default is distinct from v_column.default_expression then
      raise exception 'P1C verification failed: org_context column contract is unsafe';
    end if;
  end loop;

  for v_constraint in
    select * from (values
      ('org_context_pkey', 'p'::"char", 'PRIMARY KEY (token_hash)'),
      ('org_context_org_id_fkey', 'f'::"char", 'FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE'),
      ('org_context_token_hash_length', 'c'::"char", 'CHECK ((octet_length(token_hash) = 32))'),
      ('org_context_expiry_order', 'c'::"char", 'CHECK ((expires_at > created_at))')
    ) as expected(constraint_name, constraint_type, constraint_definition)
  loop
    select c.contype, pg_get_constraintdef(c.oid, false)
      into strict v_constraint_type, v_definition
    from pg_constraint c
    where c.conrelid = 'climate_vote.org_context'::regclass
      and c.conname = v_constraint.constraint_name;

    if v_constraint_type <> v_constraint.constraint_type
       or v_definition <> v_constraint.constraint_definition then
      raise exception 'P1C verification failed: org_context constraint contract is unsafe';
    end if;
  end loop;

  for v_index in
    select * from (values
      ('org_context_session_idx', 'CREATE INDEX org_context_session_idx ON climate_vote.org_context USING btree (session_id, user_id)'),
      ('org_context_expiry_idx', 'CREATE INDEX org_context_expiry_idx ON climate_vote.org_context USING btree (expires_at)')
    ) as expected(index_name, index_definition)
  loop
    select pg_get_indexdef(i.indexrelid)
      into strict v_definition
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where i.indrelid = 'climate_vote.org_context'::regclass
      and c.relname = v_index.index_name
      and not i.indisunique
      and not i.indisprimary;

    if v_definition <> v_index.index_definition then
      raise exception 'P1C verification failed: org_context index contract is unsafe';
    end if;
  end loop;

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

  for v_policy in
    select * from (values
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
  loop
    select regexp_replace(p.qual, E'\\s+', '', 'g'),
           regexp_replace(p.with_check, E'\\s+', '', 'g')
      into strict v_qual, v_with_check
    from pg_policies p
    where p.schemaname = 'climate_vote'
      and p.tablename = v_policy.tablename
      and p.policyname = v_policy.policyname
      and p.cmd = v_policy.command
      and p.roles = array['authenticated'::name];

    if v_policy.command = 'SELECT' then
      v_expected_qual := '(org_id=org_of_uid())';
      if v_qual <> v_expected_qual or v_with_check is not null then
        raise exception 'P1C verification failed: tenant policy definition is unsafe';
      end if;
    else
      v_expected_qual := format(
        '((org_id=org_of_uid())AND(EXISTS(SELECT1FROMmembershipmWHERE((m.user_id=auth.uid())AND(m.org_id=%I.org_id)AND(m.role=ANY(ARRAY[''operator''::text,''org_admin''::text]))AND(m.status=''active''::text)))))',
        v_policy.tablename
      );
      if v_qual <> v_expected_qual or v_with_check <> v_expected_qual then
        raise exception 'P1C verification failed: tenant policy definition is unsafe';
      end if;
    end if;
  end loop;

  foreach v_function in array array[
    'climate_vote.request_org_context_token()',
    'climate_vote.auth_session_id()',
    'climate_vote.selected_org_for_request()',
    'climate_vote.my_orgs()',
    'climate_vote.org_select(uuid)',
    'climate_vote.org_of_uid()'
  ] loop
    if to_regprocedure(v_function) is null then
      raise exception 'P1C verification failed: required function is missing';
    end if;
  end loop;

  for v_function_spec in
    select * from (values
      ('climate_vote.request_org_context_token()', 's'::"char", 'plpgsql'::name, 'search_path=pg_catalog, climate_vote, extensions'),
      ('climate_vote.auth_session_id()', 's'::"char", 'plpgsql'::name, 'search_path=pg_catalog, climate_vote'),
      ('climate_vote.selected_org_for_request()', 's'::"char", 'sql'::name, 'search_path=pg_catalog, climate_vote, extensions'),
      ('climate_vote.my_orgs()', 's'::"char", 'plpgsql'::name, 'search_path=pg_catalog, climate_vote'),
      ('climate_vote.org_select(uuid)', 'v'::"char", 'plpgsql'::name, 'search_path=pg_catalog, climate_vote, extensions'),
      ('climate_vote.org_of_uid()', 's'::"char", 'plpgsql'::name, 'search_path=pg_catalog, climate_vote')
    ) as expected(signature, volatility, language_name, function_config)
  loop
    select p.prosecdef, p.provolatile, l.lanname, p.proconfig
      into strict v_security_definer, v_volatility, v_language, v_config
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    where p.oid = to_regprocedure(v_function_spec.signature);

    if not v_security_definer
       or v_volatility <> v_function_spec.volatility
       or v_language <> v_function_spec.language_name
       or v_config <> array[v_function_spec.function_config] then
      raise exception 'P1C verification failed: function execution contract is unsafe';
    end if;
  end loop;

  if v_expect_staff_grants
     and not has_schema_privilege('authenticated', 'climate_vote', 'USAGE') then
    raise exception 'P1C verification failed: schema usage state is unexpected';
  end if;

  if not has_function_privilege('authenticated', 'climate_vote.org_of_uid()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'climate_vote.my_orgs()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'climate_vote.org_select(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.org_of_uid()', 'EXECUTE')
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
       <> v_expect_staff_grants then
      raise exception 'P1C verification failed: staff table read grant state is unexpected';
    end if;
    if has_table_privilege('public', format('climate_vote.%I', v_table), 'INSERT')
       or has_table_privilege('anon', format('climate_vote.%I', v_table), 'INSERT')
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'INSERT')
       or has_table_privilege('public', format('climate_vote.%I', v_table), 'UPDATE')
       or has_table_privilege('anon', format('climate_vote.%I', v_table), 'UPDATE')
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'UPDATE')
       or has_table_privilege('public', format('climate_vote.%I', v_table), 'DELETE')
       or has_table_privilege('anon', format('climate_vote.%I', v_table), 'DELETE')
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'DELETE') then
      raise exception 'P1C verification failed: core table mutation grant is present';
    end if;
  end loop;
end $verify$;

select jsonb_build_object(
  'status', 'passed',
  'staff_grants_active', current_setting('platform.verify_expect_staff_grants')::boolean,
  'database_mutation_executed', false
) as org_selection_post_apply;

\echo === P1C ORG SELECTION POST-APPLY VERIFICATION PASSED ===
