-- Draft only. Do not apply without separate production approval.
-- A4 adds stable design identities and a dormant, staff-only atomic provisioning contract.

begin;

alter table climate_vote.session add column if not exists slug text;
alter table climate_vote.session add column if not exists title text;
alter table climate_vote.session add column if not exists status text default 'draft';
alter table climate_vote.session add column if not exists assembly_id uuid references climate_vote.assembly(id);
alter table climate_vote.session add column if not exists ordinal integer;
alter table climate_vote.session add column if not exists held_on date;
alter table climate_vote.session add column if not exists org_id uuid references climate_vote.org(id);

alter table climate_vote.team add column if not exists ordinal integer;

alter table climate_vote.session
  drop constraint if exists platform_session_slug_shape,
  add constraint platform_session_slug_shape
    check (slug is null or slug ~ '^[a-z0-9-]{3,40}$'),
  drop constraint if exists platform_session_title_shape,
  add constraint platform_session_title_shape
    check (title is null or length(trim(title)) between 1 and 200),
  drop constraint if exists platform_session_ordinal_positive,
  add constraint platform_session_ordinal_positive
    check (ordinal is null or ordinal > 0),
  drop constraint if exists platform_session_assembly_ordinal_key,
  add constraint platform_session_assembly_ordinal_key unique (assembly_id, ordinal);

alter table climate_vote.team
  drop constraint if exists platform_team_ordinal_positive,
  add constraint platform_team_ordinal_positive
    check (ordinal is null or ordinal > 0),
  drop constraint if exists platform_team_capacity_positive,
  add constraint platform_team_capacity_positive check (capacity > 0),
  drop constraint if exists platform_team_session_ordinal_key,
  add constraint platform_team_session_ordinal_key unique (session_id, ordinal);

create table climate_vote.design_provisioning_operation (
  org_id uuid not null references climate_vote.org(id),
  operation_id text not null check (operation_id ~ '^[0-9a-f]{64}$'),
  plan_checksum text not null check (plan_checksum ~ '^[0-9a-f]{64}$'),
  operation_type text not null check (
    operation_type in ('create_assembly', 'create_session', 'create_topic', 'create_team')
  ),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  resource_id uuid not null,
  applied_at timestamptz not null default statement_timestamp(),
  primary key (org_id, operation_id)
);

alter table climate_vote.design_provisioning_operation enable row level security;
revoke all on climate_vote.design_provisioning_operation from public, anon, authenticated, service_role;

create or replace function climate_vote.platform_json_canonical(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $function$
declare
  v_result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || climate_vote.platform_json_canonical(value), ',' order by key), '') || '}'
      into v_result
      from jsonb_each(p_value);
    when 'array' then
      select '[' || coalesce(string_agg(climate_vote.platform_json_canonical(value), ',' order by ordinality), '') || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality;
    else
      v_result := p_value::text;
  end case;
  return v_result;
end
$function$;

create or replace function climate_vote.platform_sha256_hex(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, extensions
as $function$
  select encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$function$;

create or replace function climate_vote.platform_design_join_code()
returns text
language sql
volatile
set search_path = pg_catalog
as $function$
  select lpad(floor(random() * 1000000)::integer::text, 6, '0')
$function$;

create or replace function climate_vote.design_provision(p_plan jsonb, p_source_bytes bytea)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, climate_vote, auth, extensions
set row_security = off
as $function$
declare
  v_expected_root_keys text[] := array[
    'assembly', 'blockers', 'checksum', 'databaseMutationExecuted', 'dryRun',
    'executionPolicy', 'operations', 'planKind', 'readyForExecution',
    'requiresApproval', 'schemaVersion', 'serverContractImplemented', 'sourceBlueprint', 'summary'
  ];
  v_actual_keys text[];
  v_user_id uuid;
  v_org_id uuid;
  v_checksum text;
  v_operation jsonb;
  v_payload jsonb;
  v_type text;
  v_ref text;
  v_parent_ref text;
  v_operation_id text;
  v_request_hash text;
  v_resource_id uuid;
  v_parent_id uuid;
  v_existing climate_vote.design_provisioning_operation%rowtype;
  v_refs jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_replayed boolean;
  v_join_code text;
  v_attempt integer;
  v_session_count integer := 0;
  v_topic_count integer := 0;
  v_team_count integer := 0;
  v_participant_count integer := 0;
  v_assembly_count integer := 0;
  v_position integer := 0;
begin
  if p_plan is null or p_source_bytes is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception using message = 'design_plan_invalid';
  end if;

  select array_agg(key order by key) into v_actual_keys from jsonb_object_keys(p_plan) keys(key);
  if v_actual_keys is distinct from v_expected_root_keys
     or p_plan ->> 'schemaVersion' <> '2'
     or p_plan ->> 'planKind' <> 'platform_design_provisioning_plan'
     or p_plan ->> 'readyForExecution' <> 'true'
     or p_plan ->> 'serverContractImplemented' <> 'true'
     or p_plan ->> 'dryRun' <> 'false'
     or p_plan ->> 'databaseMutationExecuted' <> 'false'
     or p_plan ->> 'requiresApproval' <> 'false'
     or p_plan -> 'blockers' <> '[]'::jsonb
     or jsonb_typeof(p_plan -> 'operations') <> 'array'
     or jsonb_array_length(p_plan -> 'operations') < 1
     or jsonb_array_length(p_plan -> 'operations') > 10025
     or (select array_agg(key order by key) from jsonb_object_keys(p_plan -> 'sourceBlueprint') keys(key))
        is distinct from array['bytes', 'schemaVersion', 'sha256']
     or p_plan #>> '{sourceBlueprint,schemaVersion}' <> '4'
     or (p_plan #>> '{sourceBlueprint,sha256}') !~ '^[0-9a-f]{64}$'
     or (p_plan #>> '{sourceBlueprint,bytes}') !~ '^[1-9][0-9]*$'
     or (p_plan #>> '{sourceBlueprint,bytes}')::integer > 1000000
     or (select array_agg(key order by key) from jsonb_object_keys(p_plan -> 'assembly') keys(key))
        is distinct from array['slug', 'title']
     or (p_plan #>> '{assembly,slug}') !~ '^[a-z0-9-]{3,40}$'
     or length(trim(p_plan #>> '{assembly,title}')) not between 1 and 200
     or (select array_agg(key order by key) from jsonb_object_keys(p_plan -> 'summary') keys(key))
        is distinct from array['assemblyCount', 'operationCount', 'participantCount', 'sessionCount', 'teamCount', 'topicCount']
     or exists (
       select 1 from jsonb_each_text(p_plan -> 'summary') where value !~ '^[0-9]+$'
     )
     or (select array_agg(key order by key) from jsonb_object_keys(p_plan -> 'executionPolicy') keys(key))
        is distinct from array[
          'auditReceiptRequired', 'idempotentServerContractRequired', 'lookupBeforeMutationRequired',
          'parentBeforeChildRequired', 'stableOperationIdsRequired', 'stopOnFailure'
        ]
     or exists (
       select 1 from jsonb_each(p_plan -> 'executionPolicy') where value <> 'true'::jsonb
     )
     or (p_plan ->> 'checksum') !~ '^[0-9a-f]{64}$' then
    raise exception using message = 'design_plan_invalid';
  end if;

  v_checksum := climate_vote.platform_sha256_hex(
    climate_vote.platform_json_canonical(p_plan - 'checksum')
  );
  if v_checksum <> p_plan ->> 'checksum' then
    raise exception using message = 'design_plan_checksum_mismatch';
  end if;
  if octet_length(p_source_bytes) <> (p_plan #>> '{sourceBlueprint,bytes}')::integer
     or encode(extensions.digest(p_source_bytes, 'sha256'), 'hex')
        <> p_plan #>> '{sourceBlueprint,sha256}' then
    raise exception using message = 'design_source_mismatch';
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using message = 'design_auth_required';
  end if;
  v_org_id := climate_vote.org_of_uid();
  if v_org_id is null or not exists (
    select 1
    from climate_vote.membership m
    join climate_vote.org o on o.id = m.org_id and o.status = 'active'
    where m.user_id = v_user_id and m.org_id = v_org_id
      and m.status = 'active' and m.role in ('org_admin', 'hq')
  ) then
    raise exception using message = 'design_role_forbidden';
  end if;

  for v_operation in
    select value from jsonb_array_elements(p_plan -> 'operations') with ordinality order by ordinality
  loop
    v_position := v_position + 1;
    select array_agg(key order by key) into v_actual_keys from jsonb_object_keys(v_operation) keys(key);
    if v_actual_keys is distinct from array['operationId', 'ordinal', 'parentRef', 'payload', 'ref', 'type']
       or jsonb_typeof(v_operation -> 'payload') <> 'object' then
      raise exception using message = 'design_operation_invalid';
    end if;

    v_type := v_operation ->> 'type';
    v_ref := v_operation ->> 'ref';
    v_parent_ref := v_operation ->> 'parentRef';
    v_operation_id := v_operation ->> 'operationId';
    v_payload := v_operation -> 'payload';
    v_request_hash := climate_vote.platform_sha256_hex(
      climate_vote.platform_json_canonical(v_operation - 'operationId')
    );
    if v_type not in ('create_assembly', 'create_session', 'create_topic', 'create_team')
       or v_ref is null or length(v_ref) > 300
       or v_operation_id !~ '^[0-9a-f]{64}$' then
      raise exception using message = 'design_operation_invalid';
    end if;

    select * into v_existing
    from climate_vote.design_provisioning_operation
    where org_id = v_org_id and operation_id = v_operation_id;
    v_replayed := found;
    if v_replayed and (
      v_existing.request_hash <> v_request_hash or v_existing.operation_type <> v_type
    ) then
      raise exception using message = 'design_operation_conflict';
    end if;
    if not v_replayed and v_operation_id <> v_request_hash then
      raise exception using message = 'design_operation_invalid';
    end if;

    if v_type = 'create_assembly' then
      if v_position <> 1
         or v_assembly_count <> 0
         or v_parent_ref is not null
         or v_operation -> 'ordinal' <> 'null'::jsonb
         or v_ref <> 'assembly:' || (v_payload ->> 'slug')
         or (select array_agg(key order by key) from jsonb_object_keys(v_payload) keys(key))
            is distinct from array['config', 'mode', 'purpose', 'slug', 'title']
         or (v_payload ->> 'slug') !~ '^[a-z0-9-]{3,40}$'
         or length(trim(v_payload ->> 'title')) not between 1 and 200
         or (v_payload ->> 'title') <> p_plan #>> '{assembly,title}'
         or (v_payload ->> 'slug') <> p_plan #>> '{assembly,slug}'
         or (v_payload ->> 'purpose') is not null and length(v_payload ->> 'purpose') > 1000
         or v_payload ->> 'mode' not in ('consensus', 'vote')
         or jsonb_typeof(v_payload -> 'config') <> 'object'
         or (select array_agg(key order by key) from jsonb_object_keys(v_payload -> 'config') keys(key))
            is distinct from array['readiness']
         or jsonb_typeof(v_payload #> '{config,readiness}') <> 'array'
         or jsonb_array_length(v_payload #> '{config,readiness}') < 1
         or exists (
           select 1 from jsonb_array_elements_text(v_payload #> '{config,readiness}') readiness(value)
           where value not in ('topics_open', 'teams_active', 'roster_loaded')
         )
         or (select count(*) from jsonb_array_elements_text(v_payload #> '{config,readiness}'))
            <> (select count(distinct value) from jsonb_array_elements_text(v_payload #> '{config,readiness}') readiness(value))
         or v_payload #> '{config,readiness}' <> (
           select jsonb_agg(value order by ordinal)
           from (values ('topics_open', 1), ('teams_active', 2), ('roster_loaded', 3)) expected(value, ordinal)
           where (v_payload #> '{config,readiness}') ? value
         ) then
        raise exception using message = 'design_operation_invalid';
      end if;
      if v_replayed then
        select id into v_resource_id from climate_vote.assembly where id = v_existing.resource_id;
      else
        select id into v_resource_id from climate_vote.assembly where slug = v_payload ->> 'slug';
        if not found then
          insert into climate_vote.assembly (slug, title, purpose, mode, config, status, org_id)
          values (v_payload ->> 'slug', v_payload ->> 'title', v_payload ->> 'purpose',
                  v_payload ->> 'mode', v_payload -> 'config', 'draft', v_org_id)
          returning id into v_resource_id;
        end if;
      end if;
      if not exists (
        select 1 from climate_vote.assembly a where a.id = v_resource_id and a.org_id = v_org_id
          and a.slug = v_payload ->> 'slug' and a.title = v_payload ->> 'title'
          and a.purpose is not distinct from (v_payload ->> 'purpose')
          and a.mode = v_payload ->> 'mode' and a.config = v_payload -> 'config'
      ) then raise exception using message = 'design_resource_conflict'; end if;
      v_assembly_count := v_assembly_count + 1;

    elsif v_type = 'create_session' then
      v_parent_id := nullif(v_refs ->> v_parent_ref, '')::uuid;
      if v_parent_id is null
         or (v_operation ->> 'ordinal') !~ '^[1-9][0-9]*$'
         or length(v_operation ->> 'ordinal') > 2
         or (v_operation ->> 'ordinal')::integer > 24
         or v_ref <> v_parent_ref || '/session:' || (v_payload ->> 'slug')
         or (select array_agg(key order by key) from jsonb_object_keys(v_payload) keys(key))
            is distinct from array['heldOn', 'slug', 'title']
         or (v_payload ->> 'slug') !~ '^[a-z0-9-]{3,40}$'
         or length(trim(v_payload ->> 'title')) not between 1 and 200
         or (v_payload ->> 'heldOn') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception using message = 'design_operation_invalid';
      end if;
      if v_replayed then
        select id into v_resource_id from climate_vote.session where id = v_existing.resource_id;
      else
        select id into v_resource_id from climate_vote.session where slug = v_payload ->> 'slug';
        if not found then
          if exists (select 1 from climate_vote.session where assembly_id = v_parent_id and ordinal = (v_operation ->> 'ordinal')::integer) then
            raise exception using message = 'design_parent_conflict';
          end if;
          insert into climate_vote.session (slug, title, status, assembly_id, ordinal, held_on, org_id)
          values (v_payload ->> 'slug', v_payload ->> 'title', 'draft', v_parent_id,
                  (v_operation ->> 'ordinal')::integer, (v_payload ->> 'heldOn')::date, v_org_id)
          returning id into v_resource_id;
        end if;
      end if;
      if not exists (
        select 1 from climate_vote.session s where s.id = v_resource_id and s.org_id = v_org_id
          and s.assembly_id = v_parent_id and s.ordinal = (v_operation ->> 'ordinal')::integer
          and s.slug = v_payload ->> 'slug' and s.title = v_payload ->> 'title'
          and s.held_on = (v_payload ->> 'heldOn')::date
      ) then raise exception using message = 'design_resource_conflict'; end if;
      v_session_count := v_session_count + 1;

    elsif v_type = 'create_topic' then
      v_parent_id := nullif(v_refs ->> v_parent_ref, '')::uuid;
      if v_parent_id is null
         or (v_operation ->> 'ordinal') !~ '^[1-9][0-9]*$'
         or length(v_operation ->> 'ordinal') > 2
         or (v_operation ->> 'ordinal')::integer > 50
         or v_ref <> v_parent_ref || '/topic:' || (v_operation ->> 'ordinal')
         or (select array_agg(key order by key) from jsonb_object_keys(v_payload) keys(key))
            is distinct from array['prompt']
         or length(trim(v_payload ->> 'prompt')) not between 1 and 500 then
        raise exception using message = 'design_operation_invalid';
      end if;
      if v_replayed then
        select id into v_resource_id from climate_vote.discussion_topic where id = v_existing.resource_id;
      else
        select id into v_resource_id from climate_vote.discussion_topic
        where session_id = v_parent_id and ordinal = (v_operation ->> 'ordinal')::integer;
        if not found then
          insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status, org_id)
          values (v_parent_id, (v_operation ->> 'ordinal')::integer,
                  v_payload ->> 'prompt', 'draft', v_org_id)
          returning id into v_resource_id;
        end if;
      end if;
      if not exists (
        select 1 from climate_vote.discussion_topic dt where dt.id = v_resource_id
          and dt.org_id = v_org_id and dt.session_id = v_parent_id
          and dt.ordinal = (v_operation ->> 'ordinal')::integer
          and dt.prompt = v_payload ->> 'prompt'
      ) then raise exception using message = 'design_resource_conflict'; end if;
      v_topic_count := v_topic_count + 1;

    else
      v_parent_id := nullif(v_refs ->> v_parent_ref, '')::uuid;
      if v_parent_id is null
         or (v_operation ->> 'ordinal') !~ '^[1-9][0-9]*$'
         or length(v_operation ->> 'ordinal') > 3
         or (v_operation ->> 'ordinal')::integer > 500
         or v_ref <> v_parent_ref || '/team:' || (v_operation ->> 'ordinal')
         or (select array_agg(key order by key) from jsonb_object_keys(v_payload) keys(key))
            is distinct from array['name', 'plannedCapacity']
         or length(trim(v_payload ->> 'name')) not between 1 and 200
         or (v_payload ->> 'plannedCapacity') !~ '^[1-9][0-9]*$'
         or length(v_payload ->> 'plannedCapacity') > 6
         or (v_payload ->> 'plannedCapacity')::integer > 100000 then
        raise exception using message = 'design_operation_invalid';
      end if;
      if v_replayed then
        select id, join_code into v_resource_id, v_join_code
        from climate_vote.team where id = v_existing.resource_id;
      else
        select id, join_code into v_resource_id, v_join_code from climate_vote.team
        where session_id = v_parent_id and ordinal = (v_operation ->> 'ordinal')::integer;
        if not found then
          for v_attempt in 1..20 loop
            v_join_code := climate_vote.platform_design_join_code();
            begin
              insert into climate_vote.team (session_id, ordinal, name, join_code, capacity, status, org_id)
              values (v_parent_id, (v_operation ->> 'ordinal')::integer, v_payload ->> 'name',
                      v_join_code, (v_payload ->> 'plannedCapacity')::integer, 'active', v_org_id)
              returning id into v_resource_id;
              exit;
            exception when unique_violation then
              if exists (select 1 from climate_vote.team where session_id = v_parent_id and ordinal = (v_operation ->> 'ordinal')::integer) then
                raise exception using message = 'design_parent_conflict';
              end if;
            end;
          end loop;
          if v_resource_id is null then
            raise exception using message = 'design_join_code_exhausted';
          end if;
        end if;
      end if;
      if not exists (
        select 1 from climate_vote.team t where t.id = v_resource_id and t.org_id = v_org_id
          and t.session_id = v_parent_id and t.ordinal = (v_operation ->> 'ordinal')::integer
          and t.name = v_payload ->> 'name'
          and t.capacity = (v_payload ->> 'plannedCapacity')::integer
      ) then raise exception using message = 'design_resource_conflict'; end if;
      v_team_count := v_team_count + 1;
      v_participant_count := v_participant_count + (v_payload ->> 'plannedCapacity')::integer;
    end if;

    if not v_replayed then
      begin
        insert into climate_vote.design_provisioning_operation (
          org_id, operation_id, plan_checksum, operation_type, request_hash, resource_id
        ) values (v_org_id, v_operation_id, v_checksum, v_type, v_request_hash, v_resource_id);
      exception when unique_violation then
        raise exception using message = 'design_operation_conflict';
      end;
    end if;
    v_refs := v_refs || jsonb_build_object(v_ref, v_resource_id::text);
    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'operationId', v_operation_id,
        'resourceId', v_resource_id,
        'status', case when v_replayed then 'replayed' else 'applied' end,
        'joinCode', case when v_type = 'create_team' then v_join_code else null end
      ))
    );
  end loop;

  if p_plan #>> '{summary,assemblyCount}' <> v_assembly_count::text
     or p_plan #>> '{summary,sessionCount}' <> v_session_count::text
     or p_plan #>> '{summary,topicCount}' <> v_topic_count::text
     or p_plan #>> '{summary,teamCount}' <> v_team_count::text
     or p_plan #>> '{summary,participantCount}' <> v_participant_count::text
     or p_plan #>> '{summary,operationCount}' <> jsonb_array_length(p_plan -> 'operations')::text then
    raise exception using message = 'design_summary_mismatch';
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'planChecksum', v_checksum,
    'operationCount', jsonb_array_length(v_results),
    'operations', v_results
  );
exception when others then
  if sqlerrm like 'design_%' then
    raise;
  end if;
  raise exception using message = 'design_provision_failed';
end
$function$;

create or replace function climate_vote.design_provisioning_status(p_query jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, climate_vote, auth
set row_security = off
as $function$
declare
  v_expected_root_keys text[] := array[
    'approvalId', 'approvedPlanChecksum', 'containsSensitiveValues',
    'executedPlanChecksum', 'executionId', 'kind', 'operationCount',
    'operations', 'schemaVersion', 'sourceBlueprintBytes', 'sourceBlueprintSha256'
  ];
  v_actual_keys text[];
  v_user_id uuid;
  v_org_id uuid;
  v_operation jsonb;
  v_operation_id text;
  v_operation_type text;
  v_existing climate_vote.design_provisioning_operation%rowtype;
  v_resource_id uuid;
  v_join_code text;
  v_results jsonb := '[]'::jsonb;
  v_pending boolean := false;
begin
  if p_query is null or jsonb_typeof(p_query) <> 'object' then
    raise exception using message = 'design_reconciliation_query_invalid';
  end if;
  select array_agg(key order by key) into v_actual_keys
  from jsonb_object_keys(p_query) keys(key);
  if v_actual_keys is distinct from v_expected_root_keys
     or p_query ->> 'schemaVersion' <> '1'
     or p_query ->> 'kind' <> 'platform_design_provisioning_reconciliation_query'
     or (p_query ->> 'approvalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or (p_query ->> 'executionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or (p_query ->> 'approvedPlanChecksum') !~ '^[0-9a-f]{64}$'
     or (p_query ->> 'executedPlanChecksum') !~ '^[0-9a-f]{64}$'
     or (p_query ->> 'sourceBlueprintSha256') !~ '^[0-9a-f]{64}$'
     or (p_query ->> 'sourceBlueprintBytes') !~ '^[1-9][0-9]*$'
     or (p_query ->> 'sourceBlueprintBytes')::integer > 1000000
     or p_query -> 'containsSensitiveValues' <> 'false'::jsonb
     or (p_query ->> 'operationCount') !~ '^[1-9][0-9]*$'
     or (p_query ->> 'operationCount')::integer > 10025
     or jsonb_typeof(p_query -> 'operations') <> 'array'
     or jsonb_array_length(p_query -> 'operations')
        <> (p_query ->> 'operationCount')::integer
     or (select count(*) from jsonb_array_elements(p_query -> 'operations'))
        <> (select count(distinct value ->> 'operationId')
            from jsonb_array_elements(p_query -> 'operations')) then
    raise exception using message = 'design_reconciliation_query_invalid';
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using message = 'design_auth_required';
  end if;
  v_org_id := climate_vote.org_of_uid();
  if v_org_id is null or not exists (
    select 1
    from climate_vote.membership m
    join climate_vote.org o on o.id = m.org_id and o.status = 'active'
    where m.user_id = v_user_id and m.org_id = v_org_id
      and m.status = 'active' and m.role in ('org_admin', 'hq')
  ) then
    raise exception using message = 'design_role_forbidden';
  end if;

  for v_operation in
    select value
    from jsonb_array_elements(p_query -> 'operations') with ordinality
    order by ordinality
  loop
    select array_agg(key order by key) into v_actual_keys
    from jsonb_object_keys(v_operation) keys(key);
    v_operation_id := v_operation ->> 'operationId';
    v_operation_type := v_operation ->> 'type';
    if v_actual_keys is distinct from array['operationId', 'type']
       or v_operation_id !~ '^[0-9a-f]{64}$'
       or v_operation_type not in (
         'create_assembly', 'create_session', 'create_topic', 'create_team'
       ) then
      raise exception using message = 'design_reconciliation_query_invalid';
    end if;

    select * into v_existing
    from climate_vote.design_provisioning_operation
    where org_id = v_org_id and operation_id = v_operation_id;
    if not found then
      v_pending := true;
      continue;
    end if;
    if v_existing.plan_checksum <> p_query ->> 'executedPlanChecksum'
       or v_existing.operation_type <> v_operation_type then
      raise exception using message = 'design_reconciliation_conflict';
    end if;

    v_resource_id := null;
    v_join_code := null;
    if v_operation_type = 'create_assembly' then
      select id into v_resource_id
      from climate_vote.assembly
      where id = v_existing.resource_id and org_id = v_org_id;
    elsif v_operation_type = 'create_session' then
      select id into v_resource_id
      from climate_vote.session
      where id = v_existing.resource_id and org_id = v_org_id;
    elsif v_operation_type = 'create_topic' then
      select id into v_resource_id
      from climate_vote.discussion_topic
      where id = v_existing.resource_id and org_id = v_org_id;
    else
      select id, join_code into v_resource_id, v_join_code
      from climate_vote.team
      where id = v_existing.resource_id and org_id = v_org_id;
    end if;
    if v_resource_id is null
       or (v_operation_type = 'create_team' and v_join_code !~ '^[0-9]{6}$') then
      raise exception using message = 'design_reconciliation_conflict';
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'operationId', v_operation_id,
        'resourceId', v_resource_id,
        'status', 'replayed',
        'joinCode', case when v_operation_type = 'create_team' then v_join_code else null end
      ))
    );
  end loop;

  if v_pending then
    return jsonb_build_object('status', 'pending');
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'response', jsonb_build_object(
      'schemaVersion', 1,
      'planChecksum', p_query ->> 'executedPlanChecksum',
      'operationCount', jsonb_array_length(v_results),
      'operations', v_results
    )
  );
exception when others then
  if sqlerrm like 'design_%' then
    raise;
  end if;
  raise exception using message = 'design_reconciliation_failed';
end
$function$;

revoke all on function climate_vote.platform_json_canonical(jsonb) from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_sha256_hex(text) from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_design_join_code() from public, anon, authenticated, service_role;
revoke all on function climate_vote.design_provision(jsonb, bytea) from public, anon, authenticated, service_role;
revoke all on function climate_vote.design_provisioning_status(jsonb) from public, anon, authenticated, service_role;

commit;
