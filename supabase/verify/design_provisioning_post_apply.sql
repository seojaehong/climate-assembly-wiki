\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- Read-only A4 structural and privilege verification.
do $verify$
declare
  v_definition text;
  v_config text[];
begin
  if to_regclass('climate_vote.design_provisioning_operation') is null
     or to_regprocedure('climate_vote.design_provision(jsonb,bytea)') is null
     or to_regprocedure('climate_vote.design_provisioning_status(jsonb)') is null
     or to_regprocedure('climate_vote.platform_json_canonical(jsonb)') is null
     or to_regprocedure('climate_vote.platform_sha256_hex(text)') is null
     or to_regprocedure('climate_vote.platform_design_join_code()') is null then
    raise exception 'A4 post-apply verification failed: required object is missing';
  end if;

  if exists (
    select 1
    from (values
      ('session', 'slug', 'text', false, null::text),
      ('session', 'title', 'text', false, null::text),
      ('session', 'status', 'text', false, '''draft''::text'),
      ('session', 'assembly_id', 'uuid', false, null::text),
      ('session', 'ordinal', 'integer', false, null::text),
      ('session', 'held_on', 'date', false, null::text),
      ('session', 'org_id', 'uuid', false, null::text),
      ('team', 'ordinal', 'integer', false, null::text),
      ('design_provisioning_operation', 'org_id', 'uuid', true, null::text),
      ('design_provisioning_operation', 'operation_id', 'text', true, null::text),
      ('design_provisioning_operation', 'plan_checksum', 'text', true, null::text),
      ('design_provisioning_operation', 'operation_type', 'text', true, null::text),
      ('design_provisioning_operation', 'request_hash', 'text', true, null::text),
      ('design_provisioning_operation', 'resource_id', 'uuid', true, null::text),
      ('design_provisioning_operation', 'applied_at', 'timestamp with time zone', true,
        'statement_timestamp()')
    ) expected(table_name, column_name, data_type, not_null, default_expression)
    left join pg_class r
      on r.oid = to_regclass('climate_vote.' || expected.table_name)
    left join pg_attribute a
      on a.attrelid = r.oid and a.attname = expected.column_name
      and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum is null
       or format_type(a.atttypid, a.atttypmod) <> expected.data_type
       or a.attnotnull <> expected.not_null
       or pg_get_expr(d.adbin, d.adrelid) is distinct from expected.default_expression
  ) then
    raise exception 'A4 post-apply verification failed: column contract is unsafe';
  end if;

  if exists (
    select 1
    from (values
      ('session', 'FOREIGN KEY (assembly_id) REFERENCES assembly(id)'),
      ('session', 'FOREIGN KEY (org_id) REFERENCES org(id)'),
      ('design_provisioning_operation', 'FOREIGN KEY (org_id) REFERENCES org(id)')
    ) expected(table_name, definition)
    where not exists (
      select 1
      from pg_constraint c
      where c.conrelid = to_regclass('climate_vote.' || expected.table_name)
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid, false) = expected.definition
    )
  ) then
    raise exception 'A4 post-apply verification failed: foreign key contract is unsafe';
  end if;

  if exists (
    select 1
    from (values
      ('session', 'platform_session_slug_shape', 'c',
        'CHECK (((slug IS NULL) OR (slug ~ ''^[a-z0-9-]{3,40}$''::text)))'),
      ('session', 'platform_session_title_shape', 'c',
        'CHECK (((title IS NULL) OR ((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 200))))'),
      ('session', 'platform_session_ordinal_positive', 'c',
        'CHECK (((ordinal IS NULL) OR (ordinal > 0)))'),
      ('session', 'platform_session_assembly_ordinal_key', 'u',
        'UNIQUE (assembly_id, ordinal)'),
      ('team', 'platform_team_ordinal_positive', 'c',
        'CHECK (((ordinal IS NULL) OR (ordinal > 0)))'),
      ('team', 'platform_team_capacity_positive', 'c',
        'CHECK ((capacity > 0))'),
      ('team', 'platform_team_session_ordinal_key', 'u',
        'UNIQUE (session_id, ordinal)'),
      ('design_provisioning_operation', 'design_provisioning_operation_pkey', 'p',
        'PRIMARY KEY (org_id, operation_id)')
    ) expected(table_name, constraint_name, constraint_type, definition)
    left join pg_class r
      on r.oid = to_regclass('climate_vote.' || expected.table_name)
    left join pg_constraint c
      on c.conrelid = r.oid and c.conname = expected.constraint_name
    where c.oid is null
       or c.contype::text <> expected.constraint_type
       or pg_get_constraintdef(c.oid, false) <> expected.definition
  ) then
    raise exception 'A4 post-apply verification failed: constraint contract is unsafe';
  end if;

  select p.prosrc, p.proconfig into strict v_definition, v_config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'climate_vote' and p.proname = 'platform_design_join_code';
  if not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'climate_vote' and p.proname = 'platform_design_join_code'
         and p.provolatile = 'v' and pg_get_function_result(p.oid) = 'text'
         and p.pronargs = 0
     )
     or not ('search_path=pg_catalog, extensions' = any(v_config))
     or v_definition not like '%extensions.gen_random_bytes(4)%'
     or v_definition not like '%v_value < 4294000000%'
     or v_definition like '%random()%' then
    raise exception 'A4 post-apply verification failed: join-code generator is unsafe';
  end if;

  select p.prosrc, p.proconfig into strict v_definition, v_config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'climate_vote' and p.proname = 'design_provision';
  if not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'climate_vote' and p.proname = 'design_provision'
         and p.prosecdef and p.provolatile = 'v' and pg_get_function_result(p.oid) = 'jsonb'
         and p.pronargs = 2
     )
     or not ('search_path=pg_catalog, climate_vote, auth, extensions' = any(v_config))
     or not ('row_security=off' = any(v_config))
     or v_definition not like '%m.role in (''org_admin'', ''hq'')%'
     or v_definition not like '%for share of m, o%'
     or strpos(v_definition, 'v_user_id := auth.uid()') = 0
     or strpos(v_definition, 'v_user_id := auth.uid()')
        >= strpos(v_definition, 'climate_vote.platform_json_canonical(p_plan - ''checksum'')')
     or v_definition not like '%pg_catalog.pg_advisory_xact_lock(%'
     or v_definition not like '%pg_catalog.hashtextextended(''climate_vote.design_provision:'' || v_org_id::text, 0)%'
     or strpos(v_definition, 'pg_catalog.pg_advisory_xact_lock(')
        <= strpos(v_definition, 'encode(extensions.digest(p_source_bytes, ''sha256''), ''hex'')')
     or strpos(v_definition, 'pg_catalog.pg_advisory_xact_lock(')
        >= strpos(v_definition, 'for v_operation in')
     or v_definition not like '%v_existing.plan_checksum <> v_checksum%'
     or v_definition not like '%count(distinct value ->> ''operationId'')%'
     or v_definition not like '%count(distinct value ->> ''ref'')%'
     or v_definition not like '%jsonb_typeof(p_plan -> ''readyForExecution'') <> ''boolean''%'
     or v_definition not like '%jsonb_typeof(p_plan #> ''{sourceBlueprint,bytes}'') <> ''number''%'
     or v_definition not like '%v_current_team_count > 0%'
     or v_definition not like '%to_char(v_session_date, ''YYYY-MM-DD'')%'
     or v_definition not like '%v_current_session_capacity > 100000%'
     or v_definition not like '%v_current_topic_count = 0 or v_current_team_count = 0%'
     or v_definition not like '%and a.status = ''draft''%'
     or v_definition not like '%and s.status = ''draft''%'
     or v_definition not like '%and dt.status = ''draft''%'
     or v_definition not like '%and t.status = ''active''%'
     or v_definition not like '%design_join_code_exhausted%'
     or v_definition not like '%design_operation_conflict%' then
    raise exception 'A4 post-apply verification failed: RPC contract is unsafe';
  end if;

  select p.prosrc, p.proconfig into strict v_definition, v_config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'climate_vote' and p.proname = 'design_provisioning_status';
  if not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'climate_vote' and p.proname = 'design_provisioning_status'
         and p.prosecdef and p.provolatile = 's' and pg_get_function_result(p.oid) = 'jsonb'
         and p.pronargs = 1
     )
     or not ('search_path=pg_catalog, climate_vote, auth' = any(v_config))
     or not ('row_security=off' = any(v_config))
     or v_definition not like '%platform_design_provisioning_reconciliation_query%'
     or strpos(v_definition, 'v_user_id := auth.uid()') = 0
     or strpos(v_definition, 'v_user_id := auth.uid()')
        >= strpos(v_definition, 'jsonb_array_length(p_query -> ''operations'')')
     or v_definition not like '%jsonb_typeof(p_query -> ''operationCount'') <> ''number''%'
     or v_definition not like '%m.role in (''org_admin'', ''hq'')%'
     or v_definition not like '%id = v_existing.resource_id and org_id = v_org_id and status = ''active''%'
     or v_definition not like '%design_reconciliation_conflict%'
     or v_definition not like '%jsonb_build_object(''status'', ''pending'')%' then
    raise exception 'A4 post-apply verification failed: reconciliation RPC contract is unsafe';
  end if;

  if has_function_privilege('public', 'climate_vote.design_provision(jsonb,bytea)', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.design_provision(jsonb,bytea)', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.design_provision(jsonb,bytea)', 'EXECUTE')
     or has_function_privilege('service_role', 'climate_vote.design_provision(jsonb,bytea)', 'EXECUTE')
     or has_function_privilege('public', 'climate_vote.design_provisioning_status(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.design_provisioning_status(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.design_provisioning_status(jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'climate_vote.design_provisioning_status(jsonb)', 'EXECUTE')
     or has_table_privilege('public', 'climate_vote.design_provisioning_operation', 'SELECT')
     or has_table_privilege('anon', 'climate_vote.design_provisioning_operation', 'SELECT')
     or has_table_privilege('authenticated', 'climate_vote.design_provisioning_operation', 'SELECT')
     or has_table_privilege('service_role', 'climate_vote.design_provisioning_operation', 'SELECT') then
    raise exception 'A4 post-apply verification failed: dormant privilege contract is unsafe';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'climate_vote.design_provisioning_operation'::regclass) then
    raise exception 'A4 post-apply verification failed: ledger RLS is disabled';
  end if;
end
$verify$;

select jsonb_build_object(
  'schemaVersion', 1,
  'kind', 'platform_design_provisioning_post_apply',
  'databaseMutationExecuted', false,
  'staffGrantActive', false,
  'reconciliationRpcActive', false,
  'status', 'verified'
) as design_provisioning_post_apply;

\echo === A4 DESIGN PROVISIONING POST-APPLY VERIFICATION PASSED ===
