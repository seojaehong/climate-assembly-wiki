\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

create or replace function pg_temp.a4_operation(
  p_type text, p_ref text, p_parent_ref text, p_ordinal integer, p_payload jsonb
) returns jsonb language plpgsql as $function$
declare
  v_body jsonb;
begin
  v_body := jsonb_build_object(
    'type', p_type, 'ref', p_ref, 'parentRef', p_parent_ref,
    'ordinal', p_ordinal, 'payload', p_payload
  );
  return jsonb_build_object(
    'operationId', climate_vote.platform_sha256_hex(climate_vote.platform_json_canonical(v_body))
  ) || v_body;
end
$function$;

create or replace function pg_temp.a4_plan(
  p_operations jsonb,
  p_summary jsonb,
  p_assembly_slug text default 'a4-test-assembly'
) returns jsonb language plpgsql as $function$
declare
  v_unsigned jsonb;
begin
  v_unsigned := jsonb_build_object(
    'schemaVersion', 2,
    'planKind', 'platform_design_provisioning_plan',
    'sourceBlueprint', jsonb_build_object(
      'sha256', climate_vote.platform_sha256_hex(repeat('s', 100)),
      'bytes', 100,
      'schemaVersion', 4
    ),
    'assembly', jsonb_build_object(
      'title', p_operations #>> '{0,payload,title}',
      'slug', p_assembly_slug
    ),
    'operations', p_operations,
    'summary', p_summary,
    'executionPolicy', jsonb_build_object(
      'stableOperationIdsRequired', true,
      'parentBeforeChildRequired', true,
      'lookupBeforeMutationRequired', true,
      'idempotentServerContractRequired', true,
      'stopOnFailure', true,
      'auditReceiptRequired', true
    ),
    'blockers', '[]'::jsonb,
    'readyForExecution', true,
    'serverContractImplemented', true,
    'dryRun', false,
    'databaseMutationExecuted', false,
    'requiresApproval', false
  );
  return v_unsigned || jsonb_build_object(
    'checksum', climate_vote.platform_sha256_hex(climate_vote.platform_json_canonical(v_unsigned))
  );
end
$function$;

create or replace function pg_temp.a4_reseal_plan_operation(p_plan jsonb, p_index integer)
returns jsonb language plpgsql as $function$
declare
  v_operation jsonb;
  v_result jsonb;
begin
  v_operation := p_plan #> array['operations', p_index::text];
  v_result := jsonb_set(
    p_plan,
    array['operations', p_index::text, 'operationId'],
    to_jsonb(climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_operation - 'operationId')
    ))
  );
  return jsonb_set(
    v_result,
    '{checksum}',
    to_jsonb(climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_result - 'checksum')
    ))
  );
end
$function$;

create or replace function pg_temp.a4_reconciliation_query(p_plan jsonb)
returns jsonb language sql as $function$
  select jsonb_build_object(
    'schemaVersion', 1,
    'kind', 'platform_design_provisioning_reconciliation_query',
    'approvalId', '30000000-0000-4000-8000-000000000001',
    'executionId', '40000000-0000-4000-8000-000000000001',
    'approvedPlanChecksum', repeat('a', 64),
    'executedPlanChecksum', p_plan ->> 'checksum',
    'sourceBlueprintSha256', p_plan #>> '{sourceBlueprint,sha256}',
    'sourceBlueprintBytes', (p_plan #>> '{sourceBlueprint,bytes}')::integer,
    'operationCount', jsonb_array_length(p_plan -> 'operations'),
    'operations', (
      select jsonb_agg(
        jsonb_build_object('operationId', value ->> 'operationId', 'type', value ->> 'type')
        order by ordinality
      )
      from jsonb_array_elements(p_plan -> 'operations') with ordinality
    ),
    'containsSensitiveValues', false
  )
$function$;

do $test$
declare
  v_user uuid := '10000000-0000-0000-0000-000000000001';
  v_org uuid := '20000000-0000-0000-0000-000000000001';
  v_assembly_ref text := 'assembly:a4-test-assembly';
  v_session_ref text := 'assembly:a4-test-assembly/session:a4-session-1';
  v_operations jsonb;
  v_plan jsonb;
  v_query jsonb;
  v_response jsonb;
  v_conflict jsonb;
  v_cross_plan jsonb;
  v_duplicate_plan jsonb;
  v_malformed_plan jsonb;
  v_invalid_plan jsonb;
  v_parent_plan jsonb;
  v_exhaustion_plan jsonb;
  v_rollback_plan jsonb;
  v_session_id uuid;
  v_parent_assembly_id uuid;
  v_ledger_count bigint;
  v_resource_count bigint;
  v_join_code_definition text;
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_user, 'a4@example.invalid', now());
  insert into climate_vote.org (id, slug, name, status) values (v_org, 'a4-test-org', 'A4 test org', 'active');
  insert into climate_vote.membership (org_id, user_id, role, status)
  values (v_org, v_user, 'org_admin', 'active');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  v_operations := jsonb_build_array(
    pg_temp.a4_operation('create_assembly', v_assembly_ref, null, null, jsonb_build_object(
      'title', 'A4 test assembly', 'slug', 'a4-test-assembly', 'purpose', 'Migration rehearsal',
      'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
    )),
    pg_temp.a4_operation('create_session', v_session_ref, v_assembly_ref, 1, jsonb_build_object(
      'title', 'First session', 'slug', 'a4-session-1', 'heldOn', '2026-09-01'
    )),
    pg_temp.a4_operation('create_topic', v_session_ref || '/topic:1', v_session_ref, 1,
      jsonb_build_object('prompt', 'First topic')),
    pg_temp.a4_operation('create_team', v_session_ref || '/team:1', v_session_ref, 1,
      jsonb_build_object('name', '1조', 'plannedCapacity', 12))
  );
  v_plan := pg_temp.a4_plan(v_operations, jsonb_build_object(
    'assemblyCount', 1, 'sessionCount', 1, 'topicCount', 1,
    'teamCount', 1, 'participantCount', 12, 'operationCount', 4
  ));
  v_query := pg_temp.a4_reconciliation_query(v_plan);

  v_invalid_plan := jsonb_set(v_plan, '{operations,1,payload,heldOn}', '"2026-02-31"'::jsonb);
  v_invalid_plan := pg_temp.a4_reseal_plan_operation(v_invalid_plan, 1);
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: invalid calendar date unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := jsonb_set(v_plan, '{operations,1,ordinal}', '2'::jsonb);
  v_invalid_plan := pg_temp.a4_reseal_plan_operation(v_invalid_plan, 1);
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: noncanonical ordinal unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := jsonb_set(v_plan, '{operations,3,payload,name}', '"Alpha"'::jsonb);
  v_invalid_plan := pg_temp.a4_reseal_plan_operation(v_invalid_plan, 3);
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: noncanonical team name unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := jsonb_set(
    v_plan,
    '{operations}',
    jsonb_build_array(
      v_plan #> '{operations,0}', v_plan #> '{operations,1}',
      v_plan #> '{operations,3}', v_plan #> '{operations,2}'
    )
  );
  v_invalid_plan := jsonb_set(
    v_invalid_plan,
    '{checksum}',
    to_jsonb(climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_invalid_plan - 'checksum')
    ))
  );
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: noncanonical operation sequence unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation('create_assembly', v_assembly_ref, null, null, jsonb_build_object(
        'title', 'A4 test assembly', 'slug', 'a4-test-assembly', 'purpose', 'Migration rehearsal',
        'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
      )),
      pg_temp.a4_operation('create_session', v_session_ref, v_assembly_ref, 1, jsonb_build_object(
        'title', 'First session', 'slug', 'a4-session-1', 'heldOn', '2026-09-01'
      )),
      pg_temp.a4_operation('create_topic', v_session_ref || '/topic:1', v_session_ref, 1,
        jsonb_build_object('prompt', 'First topic')),
      pg_temp.a4_operation('create_team', v_session_ref || '/team:1', v_session_ref, 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 60000)),
      pg_temp.a4_operation('create_team', v_session_ref || '/team:2', v_session_ref, 2,
        jsonb_build_object('name', '2조', 'plannedCapacity', 60000))
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 1, 'topicCount', 1,
      'teamCount', 2, 'participantCount', 120000, 'operationCount', 5
    )
  );
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: session capacity overflow unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation('create_assembly', 'assembly:a4-date-order', null, null, jsonb_build_object(
        'title', 'Date order assembly', 'slug', 'a4-date-order', 'purpose', null,
        'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
      )),
      pg_temp.a4_operation('create_session', 'assembly:a4-date-order/session:a4-date-first',
        'assembly:a4-date-order', 1, jsonb_build_object(
          'title', 'First date session', 'slug', 'a4-date-first', 'heldOn', '2026-09-02'
        )),
      pg_temp.a4_operation('create_topic', 'assembly:a4-date-order/session:a4-date-first/topic:1',
        'assembly:a4-date-order/session:a4-date-first', 1, jsonb_build_object('prompt', 'First date topic')),
      pg_temp.a4_operation('create_team', 'assembly:a4-date-order/session:a4-date-first/team:1',
        'assembly:a4-date-order/session:a4-date-first', 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 10)),
      pg_temp.a4_operation('create_session', 'assembly:a4-date-order/session:a4-date-second',
        'assembly:a4-date-order', 2, jsonb_build_object(
          'title', 'Second date session', 'slug', 'a4-date-second', 'heldOn', '2026-09-01'
        )),
      pg_temp.a4_operation('create_topic', 'assembly:a4-date-order/session:a4-date-second/topic:1',
        'assembly:a4-date-order/session:a4-date-second', 1, jsonb_build_object('prompt', 'Second date topic')),
      pg_temp.a4_operation('create_team', 'assembly:a4-date-order/session:a4-date-second/team:1',
        'assembly:a4-date-order/session:a4-date-second', 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 10))
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 2, 'topicCount', 2,
      'teamCount', 2, 'participantCount', 20, 'operationCount', 7
    ),
    'a4-date-order'
  );
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: decreasing session date unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation('create_assembly', 'assembly:a4-duplicate-prompt', null, null, jsonb_build_object(
        'title', 'Duplicate prompt assembly', 'slug', 'a4-duplicate-prompt', 'purpose', null,
        'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
      )),
      pg_temp.a4_operation('create_session', 'assembly:a4-duplicate-prompt/session:a4-prompt-session',
        'assembly:a4-duplicate-prompt', 1, jsonb_build_object(
          'title', 'Prompt session', 'slug', 'a4-prompt-session', 'heldOn', '2026-09-03'
        )),
      pg_temp.a4_operation('create_topic', 'assembly:a4-duplicate-prompt/session:a4-prompt-session/topic:1',
        'assembly:a4-duplicate-prompt/session:a4-prompt-session', 1,
        jsonb_build_object('prompt', 'Repeated prompt')),
      pg_temp.a4_operation('create_topic', 'assembly:a4-duplicate-prompt/session:a4-prompt-session/topic:2',
        'assembly:a4-duplicate-prompt/session:a4-prompt-session', 2,
        jsonb_build_object('prompt', 'Repeated prompt')),
      pg_temp.a4_operation('create_team', 'assembly:a4-duplicate-prompt/session:a4-prompt-session/team:1',
        'assembly:a4-duplicate-prompt/session:a4-prompt-session', 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 10))
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 1, 'topicCount', 2,
      'teamCount', 1, 'participantCount', 10, 'operationCount', 5
    ),
    'a4-duplicate-prompt'
  );
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: duplicate topic prompt unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_invalid_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation('create_assembly', 'assembly:a4-incomplete-session', null, null, jsonb_build_object(
        'title', 'Incomplete session assembly', 'slug', 'a4-incomplete-session', 'purpose', null,
        'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
      )),
      pg_temp.a4_operation('create_session', 'assembly:a4-incomplete-session/session:a4-incomplete',
        'assembly:a4-incomplete-session', 1, jsonb_build_object(
          'title', 'Incomplete session', 'slug', 'a4-incomplete', 'heldOn', '2026-09-03'
        )),
      pg_temp.a4_operation('create_topic', 'assembly:a4-incomplete-session/session:a4-incomplete/topic:1',
        'assembly:a4-incomplete-session/session:a4-incomplete', 1,
        jsonb_build_object('prompt', 'Only topic'))
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 1, 'topicCount', 1,
      'teamCount', 0, 'participantCount', 0, 'operationCount', 3
    ),
    'a4-incomplete-session'
  );
  begin
    perform climate_vote.design_provision(v_invalid_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: incomplete session unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_invalid' then raise; end if;
  end;

  v_malformed_plan := jsonb_set(v_plan, '{readyForExecution}', '"true"'::jsonb);
  v_malformed_plan := jsonb_set(
    v_malformed_plan,
    '{checksum}',
    to_jsonb(climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_malformed_plan - 'checksum')
    ))
  );
  begin
    perform climate_vote.design_provision(v_malformed_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: stringified plan scalar unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_plan_invalid' then raise; end if;
  end;

  v_malformed_plan := jsonb_set(v_plan, '{summary}', '[]'::jsonb);
  v_malformed_plan := jsonb_set(
    v_malformed_plan,
    '{checksum}',
    to_jsonb(climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_malformed_plan - 'checksum')
    ))
  );
  begin
    perform climate_vote.design_provision(v_malformed_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: malformed plan container unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_plan_invalid' then raise; end if;
  end;

  begin
    perform climate_vote.design_provisioning_status(
      jsonb_set(v_query, '{operationCount}', '"4"'::jsonb)
    );
    raise exception 'A4 semantic test failed: stringified reconciliation scalar unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_reconciliation_query_invalid' then raise; end if;
  end;

  select count(*) into v_ledger_count from climate_vote.design_provisioning_operation;
  select count(*) into v_resource_count from climate_vote.assembly;
  v_response := climate_vote.design_provisioning_status(v_query);
  if v_response <> jsonb_build_object('status', 'pending')
     or (select count(*) from climate_vote.design_provisioning_operation) <> v_ledger_count
     or (select count(*) from climate_vote.assembly) <> v_resource_count then
    raise exception 'A4 semantic test failed: pending reconciliation unexpectedly mutated state';
  end if;

  begin
    perform climate_vote.design_provision(v_plan, convert_to(repeat('x', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: source mismatch unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_source_mismatch' then raise; end if;
  end;

  v_response := climate_vote.design_provision(v_plan, convert_to(repeat('s', 100), 'UTF8'));
  if v_response ->> 'operationCount' <> '4'
     or jsonb_path_query_array(v_response, '$.operations[*].status') <> '["applied", "applied", "applied", "applied"]'::jsonb
     or (v_response #>> '{operations,3,joinCode}') !~ '^[0-9]{6}$' then
    raise exception 'A4 semantic test failed: normal provisioning response is unsafe';
  end if;

  select count(*) into v_ledger_count from climate_vote.design_provisioning_operation;
  select count(*) into v_resource_count from climate_vote.team;
  v_response := climate_vote.design_provisioning_status(v_query);
  if v_response ->> 'status' <> 'completed'
     or v_response #>> '{response,schemaVersion}' <> '1'
     or v_response #>> '{response,planChecksum}' <> v_plan ->> 'checksum'
     or v_response #>> '{response,operationCount}' <> '4'
     or jsonb_path_query_array(v_response, '$.response.operations[*].status')
        <> '["replayed", "replayed", "replayed", "replayed"]'::jsonb
     or (v_response #>> '{response,operations,3,joinCode}') !~ '^[0-9]{6}$'
     or (select count(*) from climate_vote.design_provisioning_operation) <> v_ledger_count
     or (select count(*) from climate_vote.team) <> v_resource_count then
    raise exception 'A4 semantic test failed: completed reconciliation response is unsafe';
  end if;

  update climate_vote.team
  set status = 'disabled'
  where session_id = (select id from climate_vote.session where slug = 'a4-session-1')
    and ordinal = 1;
  begin
    perform climate_vote.design_provision(v_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: disabled team replay unexpectedly exposed its join code';
  exception when others then
    if sqlerrm <> 'design_resource_conflict' then raise; end if;
  end;
  begin
    perform climate_vote.design_provisioning_status(v_query);
    raise exception 'A4 semantic test failed: disabled team reconciliation unexpectedly exposed its join code';
  exception when others then
    if sqlerrm <> 'design_reconciliation_conflict' then raise; end if;
  end;
  if (select count(*) from climate_vote.design_provisioning_operation) <> v_ledger_count
     or (select count(*) from climate_vote.team) <> v_resource_count then
    raise exception 'A4 semantic test failed: disabled team checks unexpectedly mutated state';
  end if;
  update climate_vote.team
  set status = 'active'
  where session_id = (select id from climate_vote.session where slug = 'a4-session-1')
    and ordinal = 1;

  begin
    perform climate_vote.design_provisioning_status(
      jsonb_set(v_query, '{executedPlanChecksum}', to_jsonb(repeat('b', 64)))
    );
    raise exception 'A4 semantic test failed: reconciliation checksum conflict unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_reconciliation_conflict' then raise; end if;
  end;

  begin
    perform climate_vote.design_provisioning_status(
      jsonb_set(
        jsonb_set(
          v_query,
          '{operations}',
          jsonb_build_array(jsonb_build_object(
            'operationId', repeat('c', 64),
            'type', 'create_assembly'
          )) || (v_query -> 'operations')
        ),
        '{operationCount}',
        '5'::jsonb
      ) || jsonb_build_object('executedPlanChecksum', repeat('b', 64))
    );
    raise exception 'A4 semantic test failed: partial reconciliation conflict unexpectedly returned pending';
  exception when others then
    if sqlerrm <> 'design_reconciliation_conflict' then raise; end if;
  end;

  update climate_vote.membership
  set role = 'operator'
  where org_id = v_org and user_id = v_user;
  begin
    perform climate_vote.design_provisioning_status(v_query);
    raise exception 'A4 semantic test failed: reconciliation role denial unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_role_forbidden' then raise; end if;
  end;
  update climate_vote.membership
  set role = 'org_admin'
  where org_id = v_org and user_id = v_user;

  v_response := climate_vote.design_provision(v_plan, convert_to(repeat('s', 100), 'UTF8'));
  if jsonb_path_query_array(v_response, '$.operations[*].status') <> '["replayed", "replayed", "replayed", "replayed"]'::jsonb
     or (select count(*) from climate_vote.design_provisioning_operation where org_id = v_org) <> 4 then
    raise exception 'A4 semantic test failed: exact replay is not idempotent';
  end if;

  v_cross_plan := jsonb_set(
    jsonb_set(
      v_plan,
      '{sourceBlueprint,bytes}',
      '101'::jsonb
    ),
    '{sourceBlueprint,sha256}',
    to_jsonb(climate_vote.platform_sha256_hex(repeat('s', 101)))
  );
  v_cross_plan := jsonb_set(
    v_cross_plan,
    '{checksum}',
    to_jsonb(climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_cross_plan - 'checksum')
    ))
  );
  select count(*) into v_ledger_count
  from climate_vote.design_provisioning_operation where org_id = v_org;
  select (
    (select count(*) from climate_vote.assembly where org_id = v_org)
    + (select count(*) from climate_vote.session where org_id = v_org)
    + (select count(*) from climate_vote.discussion_topic where org_id = v_org)
    + (select count(*) from climate_vote.team where org_id = v_org)
  ) into v_resource_count;
  begin
    perform climate_vote.design_provision(v_cross_plan, convert_to(repeat('s', 101), 'UTF8'));
    raise exception 'A4 semantic test failed: cross-plan replay unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_conflict' then raise; end if;
  end;
  if (select count(*) from climate_vote.design_provisioning_operation where org_id = v_org) <> v_ledger_count
     or (
       (select count(*) from climate_vote.assembly where org_id = v_org)
       + (select count(*) from climate_vote.session where org_id = v_org)
       + (select count(*) from climate_vote.discussion_topic where org_id = v_org)
       + (select count(*) from climate_vote.team where org_id = v_org)
     ) <> v_resource_count then
    raise exception 'A4 semantic test failed: cross-plan replay mutated state';
  end if;

  v_duplicate_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation(
        'create_assembly', 'assembly:a4-duplicate-operation', null, null,
        jsonb_build_object(
          'title', 'Duplicate operation assembly', 'slug', 'a4-duplicate-operation', 'purpose', null,
          'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
        )
      ),
      pg_temp.a4_operation(
        'create_session', 'assembly:a4-duplicate-operation/session:a4-duplicate-session',
        'assembly:a4-duplicate-operation', 1,
        jsonb_build_object('title', 'Duplicate session', 'slug', 'a4-duplicate-session', 'heldOn', '2026-09-04')
      ),
      pg_temp.a4_operation(
        'create_session', 'assembly:a4-duplicate-operation/session:a4-duplicate-session',
        'assembly:a4-duplicate-operation', 1,
        jsonb_build_object('title', 'Duplicate session', 'slug', 'a4-duplicate-session', 'heldOn', '2026-09-04')
      )
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 2, 'topicCount', 0,
      'teamCount', 0, 'participantCount', 0, 'operationCount', 3
    ),
    'a4-duplicate-operation'
  );
  select count(*) into v_ledger_count
  from climate_vote.design_provisioning_operation where org_id = v_org;
  begin
    perform climate_vote.design_provision(v_duplicate_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: duplicate operation identity unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_plan_invalid' then raise; end if;
  end;
  if exists (select 1 from climate_vote.assembly where slug = 'a4-duplicate-operation')
     or (select count(*) from climate_vote.design_provisioning_operation where org_id = v_org) <> v_ledger_count then
    raise exception 'A4 semantic test failed: duplicate operation identity mutated state';
  end if;

  v_conflict := jsonb_set(v_plan, '{operations,3,payload,name}', '"renamed team"'::jsonb);
  v_conflict := jsonb_set(
    v_conflict, '{checksum}',
    to_jsonb(climate_vote.platform_sha256_hex(climate_vote.platform_json_canonical(v_conflict - 'checksum')))
  );
  begin
    perform climate_vote.design_provision(v_conflict, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: payload conflict unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_operation_conflict' then raise; end if;
  end;

  insert into climate_vote.assembly (slug, title, purpose, mode, config, status, org_id)
  values (
    'a4-parent-conflict', 'Parent conflict assembly', null, 'consensus',
    jsonb_build_object('readiness', jsonb_build_array('topics_open')), 'draft', v_org
  ) returning id into v_parent_assembly_id;
  insert into climate_vote.session (slug, title, status, assembly_id, ordinal, held_on, org_id)
  values (
    'a4-existing-session', 'Existing conflicting session', 'draft',
    v_parent_assembly_id, 1, '2026-09-01', v_org
  );
  v_parent_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation(
        'create_assembly', 'assembly:a4-parent-conflict', null, null,
        jsonb_build_object(
          'title', 'Parent conflict assembly', 'slug', 'a4-parent-conflict', 'purpose', null,
          'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
        )
      ),
      pg_temp.a4_operation(
        'create_session', 'assembly:a4-parent-conflict/session:a4-session-new',
        'assembly:a4-parent-conflict', 1,
        jsonb_build_object('title', 'New conflicting session', 'slug', 'a4-session-new', 'heldOn', '2026-09-02')
      ),
      pg_temp.a4_operation(
        'create_topic', 'assembly:a4-parent-conflict/session:a4-session-new/topic:1',
        'assembly:a4-parent-conflict/session:a4-session-new', 1,
        jsonb_build_object('prompt', 'Parent conflict topic')
      ),
      pg_temp.a4_operation(
        'create_team', 'assembly:a4-parent-conflict/session:a4-session-new/team:1',
        'assembly:a4-parent-conflict/session:a4-session-new', 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 10)
      )
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 1, 'topicCount', 1,
      'teamCount', 1, 'participantCount', 10, 'operationCount', 4
    ),
    'a4-parent-conflict'
  );
  begin
    perform climate_vote.design_provision(v_parent_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: parent conflict unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_parent_conflict' then raise; end if;
  end;
  delete from climate_vote.session where assembly_id = v_parent_assembly_id;
  delete from climate_vote.assembly where id = v_parent_assembly_id;

  select id into strict v_session_id from climate_vote.session where slug = 'a4-session-1';
  insert into climate_vote.team (session_id, ordinal, name, join_code, capacity, status, org_id)
  values (v_session_id, 99, 'collision fixture', '000000', 1, 'disabled', v_org);
  create or replace function climate_vote.platform_design_join_code()
  returns text language sql volatile set search_path = pg_catalog
  as $constant$ select '000000'::text $constant$;

  v_exhaustion_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation('create_assembly', 'assembly:a4-exhaustion', null, null, jsonb_build_object(
        'title', 'Exhaustion assembly', 'slug', 'a4-exhaustion', 'purpose', null,
        'mode', 'vote', 'config', jsonb_build_object('readiness', jsonb_build_array('teams_active'))
      )),
      pg_temp.a4_operation(
        'create_session', 'assembly:a4-exhaustion/session:a4-exhaustion-session', 'assembly:a4-exhaustion', 1,
        jsonb_build_object('title', 'Exhaustion session', 'slug', 'a4-exhaustion-session', 'heldOn', '2026-09-03')
      ),
      pg_temp.a4_operation(
        'create_topic', 'assembly:a4-exhaustion/session:a4-exhaustion-session/topic:1',
        'assembly:a4-exhaustion/session:a4-exhaustion-session', 1,
        jsonb_build_object('prompt', 'Exhaustion topic')
      ),
      pg_temp.a4_operation(
        'create_team', 'assembly:a4-exhaustion/session:a4-exhaustion-session/team:1',
        'assembly:a4-exhaustion/session:a4-exhaustion-session', 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 10)
      )
    ),
    jsonb_build_object(
      'assemblyCount', 1, 'sessionCount', 1, 'topicCount', 1,
      'teamCount', 1, 'participantCount', 10, 'operationCount', 4
    ),
    'a4-exhaustion'
  );
  begin
    perform climate_vote.design_provision(v_exhaustion_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: join-code exhaustion unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_join_code_exhausted' then raise; end if;
  end;
  if exists (select 1 from climate_vote.assembly where slug = 'a4-exhaustion') then
    raise exception 'A4 semantic test failed: exhaustion did not roll back the plan transaction';
  end if;

  create or replace function climate_vote.platform_design_join_code()
  returns text language plpgsql volatile set search_path = pg_catalog, extensions
  as $secure$
  declare
    v_bytes bytea;
    v_value bigint;
  begin
    loop
      v_bytes := extensions.gen_random_bytes(4);
      v_value := get_byte(v_bytes, 0)::bigint * 16777216
        + get_byte(v_bytes, 1)::bigint * 65536
        + get_byte(v_bytes, 2)::bigint * 256
        + get_byte(v_bytes, 3)::bigint;
      exit when v_value < 4294000000;
    end loop;
    return lpad((v_value % 1000000)::text, 6, '0');
  end
  $secure$;
  select pg_get_functiondef('climate_vote.platform_design_join_code()'::regprocedure)
  into v_join_code_definition;
  if v_join_code_definition not like '%extensions.gen_random_bytes(4)%'
     or v_join_code_definition not like '%v_value < 4294000000%'
     or v_join_code_definition like '%random()%'
     or exists (
       select 1 from generate_series(1, 64)
       where climate_vote.platform_design_join_code() !~ '^[0-9]{6}$'
     ) then
    raise exception 'A4 semantic test failed: secure join-code generator was not restored';
  end if;

  v_rollback_plan := pg_temp.a4_plan(
    jsonb_build_array(
      pg_temp.a4_operation(
        'create_assembly', 'assembly:a4-late-rollback', null, null, jsonb_build_object(
          'title', 'Late rollback', 'slug', 'a4-late-rollback', 'purpose', null,
          'mode', 'consensus', 'config', jsonb_build_object('readiness', jsonb_build_array('topics_open'))
        )
      ),
      pg_temp.a4_operation(
        'create_session', 'assembly:a4-late-rollback/session:a4-late-session',
        'assembly:a4-late-rollback', 1,
        jsonb_build_object('title', 'Late session', 'slug', 'a4-late-session', 'heldOn', '2026-09-05')
      ),
      pg_temp.a4_operation(
        'create_topic', 'assembly:a4-late-rollback/session:a4-late-session/topic:1',
        'assembly:a4-late-rollback/session:a4-late-session', 1,
        jsonb_build_object('prompt', 'Late topic')
      ),
      pg_temp.a4_operation(
        'create_team', 'assembly:a4-late-rollback/session:a4-late-session/team:1',
        'assembly:a4-late-rollback/session:a4-late-session', 1,
        jsonb_build_object('name', '1조', 'plannedCapacity', 10)
      )
    ),
    jsonb_build_object(
      'assemblyCount', 2, 'sessionCount', 1, 'topicCount', 1,
      'teamCount', 1, 'participantCount', 10, 'operationCount', 4
    ),
    'a4-late-rollback'
  );
  begin
    perform climate_vote.design_provision(v_rollback_plan, convert_to(repeat('s', 100), 'UTF8'));
    raise exception 'A4 semantic test failed: summary mismatch unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'design_summary_mismatch' then raise; end if;
  end;
  if exists (select 1 from climate_vote.assembly where slug = 'a4-late-rollback') then
    raise exception 'A4 semantic test failed: late validation did not roll back mutations';
  end if;
end
$test$;

\echo === A4 DESIGN PROVISIONING SEMANTIC TEST PASSED ===
