\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- Read-only A4 structural and privilege verification.
do $verify$
declare
  v_count integer;
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

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'climate_vote' and (
    (table_name = 'session' and column_name in ('slug', 'title', 'status', 'assembly_id', 'ordinal', 'held_on', 'org_id'))
    or (table_name = 'team' and column_name = 'ordinal')
    or (table_name = 'design_provisioning_operation' and column_name in (
      'org_id', 'operation_id', 'plan_checksum', 'operation_type', 'request_hash', 'resource_id', 'applied_at'
    ))
  );
  if v_count <> 15 then
    raise exception 'A4 post-apply verification failed: column contract is unsafe';
  end if;

  select count(*) into v_count
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'climate_vote' and c.conname in (
    'platform_session_slug_shape', 'platform_session_title_shape',
    'platform_session_ordinal_positive', 'platform_session_assembly_ordinal_key',
    'platform_team_ordinal_positive', 'platform_team_capacity_positive',
    'platform_team_session_ordinal_key', 'design_provisioning_operation_pkey'
  );
  if v_count <> 8 then
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
