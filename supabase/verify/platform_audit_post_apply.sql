\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;
set local search_path = pg_catalog, climate_vote;

-- Read-only P4 production verification. The transaction itself rejects any
-- accidental DML or DDL added to this script in a later revision.
do $verify$
declare
  v_owner_oid oid;
  v_owner_name name;
  v_definition text;
  v_config text[];
begin
  if to_regclass('climate_vote.platform_audit_event') is null
     or to_regclass('climate_vote.attendance_audit_log') is null
     or to_regclass('climate_vote.workshop_audit_event') is null
     or to_regprocedure('climate_vote.platform_audit_reject_change()') is null
     or to_regprocedure('climate_vote.platform_audit_org_for_row(text,jsonb)') is null
     or to_regprocedure('climate_vote.platform_audit_row_change()') is null
     or to_regprocedure('climate_vote.platform_audit_list(bigint,integer)') is null then
    raise exception 'P4 post-apply verification failed: required object is missing';
  end if;

  select c.relowner into strict v_owner_oid
  from pg_class c
  where c.oid = 'climate_vote.platform_audit_event'::regclass;
  select pg_get_userbyid(v_owner_oid) into strict v_owner_name;
  if v_owner_name in ('anon', 'authenticated', 'authenticator', 'service_role')
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
    raise exception 'P4 post-apply verification failed: owner contract is unsafe';
  end if;

  if exists (
    select 1
    from (values
      ('climate_vote.platform_audit_reject_change()', 'v',
       array['search_path=pg_catalog']::text[], 'trigger',
       'f7bc34a066efe07202e241e77a106e18f507fb388d1154262019e22d3ace3afe'),
      ('climate_vote.platform_audit_org_for_row(text,jsonb)', 's',
       array['search_path=pg_catalog, climate_vote', 'row_security=off']::text[], 'uuid',
       '6a64ac711243ada6aaa8c57a06710e1a430083202fe5474a03b285e89380303a'),
      ('climate_vote.platform_audit_row_change()', 'v',
       array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[], 'trigger',
       'e179a5a74c48f8d0e4f3bc9a2fd23bdcc4233c82ea8f6ed957a5ea715c6a428b'),
      ('climate_vote.platform_audit_list(bigint,integer)', 's',
       array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[], 'jsonb',
       '9dd1ca71811f9cb2dad13d676e6db6b07496892f974429c0614e2d98fecf6f9e')
    ) expected(signature, volatility, config, result_type, source_sha256)
    join pg_proc p on p.oid = to_regprocedure(expected.signature)
    where p.prokind <> 'f'
       or not p.prosecdef
       or p.provolatile <> expected.volatility::"char"
       or p.proconfig is distinct from expected.config
       or pg_get_function_result(p.oid) <> expected.result_type
       or encode(extensions.digest(convert_to(
            replace(p.prosrc, chr(13) || chr(10), chr(10)), 'UTF8'),
            'sha256'), 'hex')
          <> expected.source_sha256
  ) then
    raise exception 'P4 post-apply verification failed: function source contract is unsafe';
  end if;

  if exists (
    select 1
    from (values
      ('id', 'bigint', true, 'a', null::text),
      ('org_id', 'uuid', true, '', null::text),
      ('occurred_at', 'timestamp with time zone', true, '', 'statement_timestamp()'),
      ('transaction_id', 'bigint', true, '', 'txid_current()'),
      ('actor_user_id', 'uuid', false, '', null::text),
      ('actor_role', 'text', true, '', null::text),
      ('operation', 'text', true, '', null::text),
      ('resource_type', 'text', true, '', null::text),
      ('resource_id', 'text', true, '', null::text),
      ('changed_fields', 'text[]', true, '', '''{}''::text[]')
    ) expected(column_name, data_type, not_null, identity_kind, default_expression)
    left join pg_attribute a
      on a.attrelid = 'climate_vote.platform_audit_event'::regclass
      and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum is null
       or format_type(a.atttypid, a.atttypmod) <> expected.data_type
       or a.attnotnull <> expected.not_null
       or a.attidentity::text <> expected.identity_kind
       or pg_get_expr(d.adbin, d.adrelid) is distinct from expected.default_expression
  ) or (
    select count(*) from pg_attribute a
    where a.attrelid = 'climate_vote.platform_audit_event'::regclass
      and a.attnum > 0 and not a.attisdropped
  ) <> 10 then
    raise exception 'P4 post-apply verification failed: column contract is unsafe';
  end if;

  if exists (
       select 1
       from (values
         ('platform_audit_event_org_page_idx',
          'CREATE INDEX platform_audit_event_org_page_idx ON climate_vote.platform_audit_event USING btree (org_id, id DESC)'),
         ('platform_audit_event_actor_idx',
          'CREATE INDEX platform_audit_event_actor_idx ON climate_vote.platform_audit_event USING btree (org_id, actor_user_id, id DESC) WHERE (actor_user_id IS NOT NULL)')
       ) expected(index_name, definition)
       left join pg_class c
         on c.relnamespace = 'climate_vote'::regnamespace
        and c.relname = expected.index_name
        and c.relkind = 'i'
       left join pg_index i
         on i.indexrelid = c.oid
        and i.indrelid = 'climate_vote.platform_audit_event'::regclass
       where i.indexrelid is null
          or not i.indisvalid
          or not i.indisready
          or i.indisunique
          or pg_get_indexdef(i.indexrelid) <> expected.definition
     )
     or exists (
       select 1
       from (values
         ('platform_audit_event_pkey', 'p', 'PRIMARY KEY (id)'),
         ('platform_audit_changed_fields_bounded', 'c',
          'CHECK (cardinality(changed_fields) <= 100)'),
         ('platform_audit_event_operation_check', 'c',
          'CHECK (operation = ANY (ARRAY[''insert''::text, ''update''::text, ''delete''::text]))'),
         ('platform_audit_event_resource_id_check', 'c',
          'CHECK (length(resource_id) >= 1 AND length(resource_id) <= 200)'),
         ('platform_audit_event_resource_type_check', 'c',
          'CHECK (resource_type ~ ''^[a-z][a-z0-9_]{1,62}$''::text)')
       ) expected(constraint_name, constraint_type, definition)
       left join pg_constraint c
         on c.conrelid = 'climate_vote.platform_audit_event'::regclass
        and c.conname = expected.constraint_name
        and c.contype = expected.constraint_type::"char"
       where c.oid is null
          or not c.convalidated
          or pg_get_constraintdef(c.oid, true) <> expected.definition
     )
     or (select count(*) from pg_constraint c
         where c.conrelid = 'climate_vote.platform_audit_event'::regclass
           and c.contype = 'c') <> 4 then
    raise exception 'P4 post-apply verification failed: index or constraint contract is unsafe';
  end if;

  if not exists (
       select 1
       from pg_class c
       where c.oid = 'climate_vote.platform_audit_event'::regclass
         and c.relkind = 'r'
         and c.relpersistence = 'p'
         and not c.relispartition
     )
     or not exists (
       select 1
       from pg_class c
       where c.oid = 'climate_vote.platform_audit_event_id_seq'::regclass
         and c.relkind = 'S'
         and c.relpersistence = 'p'
         and c.relowner = v_owner_oid
     ) then
    raise exception 'P4 post-apply verification failed: table storage contract is unsafe';
  end if;

  if not (select relrowsecurity from pg_class
          where oid = 'climate_vote.platform_audit_event'::regclass)
      or exists (
        select 1
        from pg_policy p
        where p.polrelid = 'climate_vote.platform_audit_event'::regclass
      )
      or exists (
        select 1
        from pg_class c
        cross join lateral aclexplode(c.relacl) acl
        where c.oid = 'climate_vote.platform_audit_event'::regclass
          and (acl.grantee <> v_owner_oid or acl.grantor <> v_owner_oid)
      )
      or exists (
        select 1
        from pg_attribute a
        cross join lateral aclexplode(a.attacl) acl
        where a.attrelid = 'climate_vote.platform_audit_event'::regclass
          and a.attnum > 0 and not a.attisdropped
          and (acl.grantee <> v_owner_oid or acl.grantor <> v_owner_oid)
      )
      or exists (
        select 1
        from pg_class c
        cross join lateral aclexplode(c.relacl) acl
        where c.oid = 'climate_vote.platform_audit_event_id_seq'::regclass
          and (acl.grantee <> v_owner_oid or acl.grantor <> v_owner_oid)
      )
      or exists (
        select 1 from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
        cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege_name)
        where has_table_privilege(roles.role_name, 'climate_vote.platform_audit_event', privileges.privilege_name)
      )
     or exists (
       select 1 from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) privileges(privilege_name)
       where has_any_column_privilege(roles.role_name, 'climate_vote.platform_audit_event', privileges.privilege_name)
     )
     or exists (
       select 1 from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
       cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) privileges(privilege_name)
       where has_sequence_privilege(roles.role_name, 'climate_vote.platform_audit_event_id_seq', privileges.privilege_name)
     ) then
    raise exception 'P4 post-apply verification failed: table privilege contract is unsafe';
  end if;

  if not exists (
       select 1 from pg_trigger
       where tgrelid = 'climate_vote.platform_audit_event'::regclass
         and tgname = 'platform_audit_event_immutable'
         and not tgisinternal and tgenabled = 'O'
         and tgfoid = 'climate_vote.platform_audit_reject_change()'::regprocedure
         and tgtype = 27 and tgqual is null and cardinality(tgattr::smallint[]) = 0
         and octet_length(tgargs) = 0 and tgconstraint = 0
         and not tgdeferrable and not tginitdeferred
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'climate_vote.platform_audit_event'::regclass
         and tgname = 'platform_audit_event_no_truncate'
         and not tgisinternal and tgenabled = 'O'
         and tgfoid = 'climate_vote.platform_audit_reject_change()'::regprocedure
         and tgtype = 34 and tgqual is null and cardinality(tgattr::smallint[]) = 0
         and octet_length(tgargs) = 0 and tgconstraint = 0
         and not tgdeferrable and not tginitdeferred
     ) then
    raise exception 'P4 post-apply verification failed: append-only trigger contract is unsafe';
  end if;

  if (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'climate_vote'
      and t.tgname = 'platform_audit_capture'
      and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgfoid = 'climate_vote.platform_audit_row_change()'::regprocedure
      and t.tgtype = 31 and t.tgqual is null
      and cardinality(t.tgattr::smallint[]) = 0 and octet_length(t.tgargs) = 0
      and t.tgconstraint = 0 and not t.tgdeferrable and not t.tginitdeferred
      and c.relname in (
        'org', 'membership', 'invitation', 'assembly', 'session',
        'discussion_topic', 'team', 'submission', 'submission_item',
        'ballot', 'ballot_item', 'issue', 'issue_link', 'result_page',
        'design_provisioning_operation'
      )
  ) <> 15 or exists (
    select 1
    from (values
      ('org'), ('membership'), ('invitation'), ('assembly'), ('session'),
      ('discussion_topic'), ('team'), ('submission'), ('submission_item'),
      ('ballot'), ('ballot_item'), ('issue'), ('issue_link'), ('result_page'),
      ('design_provisioning_operation')
    ) expected(table_name)
    where not exists (
      select 1 from pg_trigger t
      where t.tgrelid = to_regclass('climate_vote.' || expected.table_name)
        and t.tgname = 'platform_audit_capture'
        and not t.tgisinternal and t.tgenabled = 'O'
        and t.tgfoid = 'climate_vote.platform_audit_row_change()'::regprocedure
        and t.tgtype = 31 and t.tgqual is null
        and cardinality(t.tgattr::smallint[]) = 0 and octet_length(t.tgargs) = 0
        and t.tgconstraint = 0 and not t.tgdeferrable and not t.tginitdeferred
    )
  ) or (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'climate_vote'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and (t.tgtype::integer & 1) = 1
      and (t.tgtype::integer & 2) = 2
      and (t.tgtype::integer & 28) <> 0
      and c.relname in (
        'org', 'membership', 'invitation', 'assembly', 'session',
        'discussion_topic', 'team', 'submission', 'submission_item',
        'ballot', 'ballot_item', 'issue', 'issue_link', 'result_page',
        'design_provisioning_operation'
      )
  ) <> 18 or exists (
    select 1
    from (values
      ('submission', 'submission_lock_guard',
       'climate_vote.submission_lock_guard()', 19),
      ('submission_item', 'submission_item_lock_guard',
       'climate_vote.submission_item_lock_guard()', 31),
      ('issue', 'issue_org_derive',
       'climate_vote.issue_org_derive()', 7)
    ) expected(table_name, trigger_name, function_signature, trigger_type)
    where not exists (
      select 1
      from pg_trigger t
      where t.tgrelid = to_regclass('climate_vote.' || expected.table_name)
        and t.tgname = expected.trigger_name
        and not t.tgisinternal and t.tgenabled = 'O'
        and t.tgfoid = to_regprocedure(expected.function_signature)
        and t.tgtype = expected.trigger_type
        and t.tgqual is null and cardinality(t.tgattr::smallint[]) = 0
        and octet_length(t.tgargs) = 0 and t.tgconstraint = 0
        and not t.tgdeferrable and not t.tginitdeferred
    )
  ) then
    raise exception 'P4 post-apply verification failed: capture trigger contract is unsafe';
  end if;

  select p.prosrc, p.proconfig into strict v_definition, v_config
  from pg_proc p where p.oid = 'climate_vote.platform_audit_row_change()'::regprocedure;
  if not exists (
       select 1 from pg_proc p
       where p.oid = 'climate_vote.platform_audit_row_change()'::regprocedure
         and p.prosecdef and p.provolatile = 'v'
         and pg_get_function_result(p.oid) = 'trigger'
     )
     or v_config is distinct from array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[]
     or v_definition not like '%platform audit refuses cross-organization resource move%'
     or v_definition not like '%insert into climate_vote.platform_audit_event%'
     or v_definition not like '%jsonb_object_keys%'
     or v_definition not like '%auth.uid()%' then
    raise exception 'P4 post-apply verification failed: capture function contract is unsafe';
  end if;

  select p.prosrc, p.proconfig into strict v_definition, v_config
  from pg_proc p where p.oid = 'climate_vote.platform_audit_list(bigint,integer)'::regprocedure;
  if not exists (
       select 1 from pg_proc p
       where p.oid = 'climate_vote.platform_audit_list(bigint,integer)'::regprocedure
         and p.prosecdef and p.provolatile = 's'
         and pg_get_function_result(p.oid) = 'jsonb'
     )
     or v_config is distinct from array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[]
     or v_definition not like '%m.role in (''org_admin'', ''operator'', ''hq'')%'
     or v_definition not like '%where e.org_id = v_org_id%'
     or not has_schema_privilege('authenticated', 'climate_vote', 'USAGE')
     or has_function_privilege('public', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
      or has_function_privilege('anon', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
      or has_function_privilege('authenticator', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
      or has_function_privilege('service_role', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE')
      or exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(p.proacl) acl
        where p.oid = 'climate_vote.platform_audit_list(bigint,integer)'::regprocedure
          and not (
            acl.grantee = v_owner_oid
            and acl.grantor = v_owner_oid
            or acl.grantee = (select oid from pg_roles where rolname = 'authenticated')
               and acl.grantor = v_owner_oid
               and acl.privilege_type = 'EXECUTE'
               and not acl.is_grantable
          )
      )
      or not has_function_privilege('authenticated', 'climate_vote.platform_audit_list(bigint,integer)', 'EXECUTE') then
    raise exception 'P4 post-apply verification failed: list RPC contract is unsafe';
  end if;

  if exists (
    select 1
    from (values ('public'), ('anon'), ('authenticated'), ('authenticator'), ('service_role')) roles(role_name)
    cross join (values
      ('climate_vote.platform_audit_reject_change()'),
      ('climate_vote.platform_audit_org_for_row(text,jsonb)'),
      ('climate_vote.platform_audit_row_change()')
    ) helpers(signature)
    where has_function_privilege(roles.role_name, helpers.signature, 'EXECUTE')
  ) or exists (
    select 1
    from (values
      ('climate_vote.platform_audit_reject_change()'),
      ('climate_vote.platform_audit_org_for_row(text,jsonb)'),
      ('climate_vote.platform_audit_row_change()')
    ) helpers(signature)
    join pg_proc p on p.oid = to_regprocedure(helpers.signature)
    cross join lateral aclexplode(p.proacl) acl
    where acl.grantee <> v_owner_oid or acl.grantor <> v_owner_oid
  ) then
    raise exception 'P4 post-apply verification failed: helper privilege contract is unsafe';
  end if;

end
$verify$;

with attendance_snapshot as (
  select count(*) as row_count,
    encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
      'sha256'), 'hex') as canonical_jsonb_sha256
  from climate_vote.attendance_audit_log row_value
), workshop_snapshot as (
  select count(*) as row_count,
    encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
      'sha256'), 'hex') as canonical_jsonb_sha256
  from climate_vote.workshop_audit_event row_value
)
select jsonb_build_object(
  'schemaVersion', 1,
  'kind', 'platform_audit_post_apply',
  'databaseMutationExecuted', false,
  'captureTriggerCount', 15,
  'historyStableDuringVerification', true,
  'historySnapshotAlgorithm', 'sha256-canonical-jsonb-v1',
  'attendanceHistory', jsonb_build_object(
    'rowCount', attendance_snapshot.row_count,
    'canonicalJsonbSha256', attendance_snapshot.canonical_jsonb_sha256
  ),
  'workshopHistory', jsonb_build_object(
    'rowCount', workshop_snapshot.row_count,
    'canonicalJsonbSha256', workshop_snapshot.canonical_jsonb_sha256
  ),
  'status', 'verified'
) as platform_audit_post_apply
from attendance_snapshot cross join workshop_snapshot;

commit;
\echo === P4 AUDIT POST-APPLY VERIFICATION PASSED ===
