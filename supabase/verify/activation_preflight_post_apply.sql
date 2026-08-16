\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- Read-only post-apply verification for the draft activation preflight RPC.
do $verify_function$
declare
  v_volatility "char";
  v_security_definer boolean;
  v_language name;
  v_owner name;
  v_result_type text;
  v_argument_count smallint;
  v_config text[];
begin
  if to_regprocedure('climate_vote.platform_activation_preflight()') is null then
    raise exception 'Activation preflight verification failed: function is missing';
  end if;

  select
    p.provolatile,
    p.prosecdef,
    l.lanname,
    pg_get_userbyid(p.proowner),
    pg_get_function_result(p.oid),
    p.pronargs,
    p.proconfig
  into strict
    v_volatility,
    v_security_definer,
    v_language,
    v_owner,
    v_result_type,
    v_argument_count,
    v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'climate_vote'
    and p.proname = 'platform_activation_preflight';

  if v_volatility <> 's'
     or not v_security_definer
     or v_language <> 'plpgsql'
     or v_owner in ('anon', 'authenticated', 'service_role')
     or v_result_type <> 'jsonb'
     or v_argument_count <> 0
     or not ('search_path=pg_catalog, climate_vote, auth' = any(v_config))
     or not ('row_security=off' = any(v_config)) then
    raise exception 'Activation preflight verification failed: function contract is unsafe';
  end if;

  if has_function_privilege('public', 'climate_vote.platform_activation_preflight()', 'EXECUTE')
     or has_function_privilege('anon', 'climate_vote.platform_activation_preflight()', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.platform_activation_preflight()', 'EXECUTE')
     or not has_function_privilege('service_role', 'climate_vote.platform_activation_preflight()', 'EXECUTE') then
    raise exception 'Activation preflight verification failed: execution privileges are unsafe';
  end if;
end
$verify_function$;

set role service_role;
select climate_vote.platform_activation_preflight()::text as activation_preflight_report \gset
reset role;
select set_config('platform.verify_activation_preflight_report', :'activation_preflight_report', false) as activation_preflight_report_config \gset

do $verify_report$
declare
  v_report jsonb := current_setting('platform.verify_activation_preflight_report')::jsonb;
  v_root_keys text[];
  v_summary_keys text[];
  v_expected_table_names text[] := array[
    'assembly',
    'session',
    'discussion_topic',
    'submission',
    'ballot',
    'team',
    'assembly_member',
    'team_assignment',
    'issue',
    'result_page',
    'attendance',
    'attendance_auth_session'
  ];
  v_table record;
  v_total_null_org_count bigint := 0;
  v_expected_blockers jsonb := '[]'::jsonb;
  v_code text;
  v_count bigint;
  v_summary_value text;
begin
  select array_agg(key order by key) into v_root_keys
  from jsonb_object_keys(v_report) as root_keys(key);

  if v_root_keys <> array[
       'blockers',
       'checkedAt',
       'databaseMutationExecuted',
       'evidenceComplete',
       'readConsistency',
       'requiresImmediateRecheckBeforeActivation',
       'schemaVersion',
       'status',
       'summary',
       'tables'
     ]
     or v_report ->> 'schemaVersion' <> '1'
     or v_report ->> 'status' not in ('ready', 'not_ready')
     or v_report ->> 'databaseMutationExecuted' <> 'false'
     or v_report ->> 'evidenceComplete' <> 'true'
     or v_report ->> 'readConsistency' <> 'single_statement'
     or v_report ->> 'requiresImmediateRecheckBeforeActivation' <> 'true'
     or v_report ->> 'checkedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
     or to_char((v_report ->> 'checkedAt')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> v_report ->> 'checkedAt'
     or jsonb_typeof(v_report -> 'summary') <> 'object'
     or jsonb_typeof(v_report -> 'tables') <> 'array'
     or jsonb_typeof(v_report -> 'blockers') <> 'array' then
    raise exception 'Activation preflight verification failed: report envelope is unsafe';
  end if;

  select array_agg(key order by key) into v_summary_keys
  from jsonb_object_keys(v_report -> 'summary') as summary_keys(key);

  if v_summary_keys <> array[
       'activeMembershipCount',
       'activeOrganizationCount',
       'hierarchyMismatchCount',
       'missingHierarchyEvidenceCount',
       'missingTableCount',
       'multiOrganizationUserCount',
       'organizationsWithoutAdminCount',
       'organizationsWithoutHqCount',
       'requiredTableCount',
       'totalNullOrgCount',
       'unavailableAuthUserCount',
       'unavailableMembershipOrganizationCount',
       'unboundActiveHqSessionCount'
     ]
     or v_report #>> '{summary,requiredTableCount}' <> '12'
     or v_report #>> '{summary,missingTableCount}' <> '0'
     or v_report #>> '{summary,missingHierarchyEvidenceCount}' <> '0'
     or jsonb_array_length(v_report -> 'tables') <> 12 then
    raise exception 'Activation preflight verification failed: summary contract is unsafe';
  end if;

  for v_summary_value in select value from jsonb_each_text(v_report -> 'summary')
  loop
    if v_summary_value !~ '^\d+$' then
      raise exception 'Activation preflight verification failed: summary count is unsafe';
    end if;
  end loop;

  for v_table in
    select value, ordinality
    from jsonb_array_elements(v_report -> 'tables') with ordinality
  loop
    if (select array_agg(key order by key) from jsonb_object_keys(v_table.value) as table_keys(key))
         <> array['nullOrgCount', 'table', 'totalCount']
       or v_table.value ->> 'table' <> v_expected_table_names[v_table.ordinality]
       or v_table.value ->> 'totalCount' !~ '^\d+$'
       or v_table.value ->> 'nullOrgCount' !~ '^\d+$'
       or (v_table.value ->> 'nullOrgCount')::bigint > (v_table.value ->> 'totalCount')::bigint then
      raise exception 'Activation preflight verification failed: table count contract is unsafe';
    end if;
    v_total_null_org_count := v_total_null_org_count + (v_table.value ->> 'nullOrgCount')::bigint;
  end loop;

  if v_total_null_org_count <> (v_report #>> '{summary,totalNullOrgCount}')::bigint then
    raise exception 'Activation preflight verification failed: null organization total is inconsistent';
  end if;

  for v_code, v_count in
    select * from (values
      ('hierarchy_org_mismatch', (v_report #>> '{summary,hierarchyMismatchCount}')::bigint),
      ('no_active_organization', case when (v_report #>> '{summary,activeOrganizationCount}')::bigint = 0 then 1 else 0 end),
      ('organization_without_admin', (v_report #>> '{summary,organizationsWithoutAdminCount}')::bigint),
      ('organization_without_hq', (v_report #>> '{summary,organizationsWithoutHqCount}')::bigint),
      ('multi_organization_user', (v_report #>> '{summary,multiOrganizationUserCount}')::bigint),
      ('membership_unavailable_organization', (v_report #>> '{summary,unavailableMembershipOrganizationCount}')::bigint),
      ('membership_auth_user_unavailable', (v_report #>> '{summary,unavailableAuthUserCount}')::bigint),
      ('null_org_id', (v_report #>> '{summary,totalNullOrgCount}')::bigint),
      ('unbound_active_hq_session', (v_report #>> '{summary,unboundActiveHqSessionCount}')::bigint)
    ) as blocker_counts(code, count)
  loop
    if v_count < 0 then
      raise exception 'Activation preflight verification failed: summary count is unsafe';
    end if;
    if v_count > 0 then
      v_expected_blockers := v_expected_blockers || jsonb_build_array(jsonb_build_object('code', v_code, 'count', v_count));
    end if;
  end loop;

  if v_report -> 'blockers' <> v_expected_blockers
     or (v_report ->> 'status' = 'ready') <> (jsonb_array_length(v_expected_blockers) = 0)
     or jsonb_path_exists(v_report, '$.**.org_id')
     or jsonb_path_exists(v_report, '$.**.user_id')
     or jsonb_path_exists(v_report, '$.**.token_hash') then
    raise exception 'Activation preflight verification failed: blocker or disclosure contract is unsafe';
  end if;
end
$verify_report$;

select jsonb_build_object(
  'status', 'passed',
  'preflightStatus', current_setting('platform.verify_activation_preflight_report')::jsonb ->> 'status',
  'databaseMutationExecuted', false
) as activation_preflight_post_apply;

\echo === ACTIVATION PREFLIGHT POST-APPLY VERIFICATION PASSED ===
