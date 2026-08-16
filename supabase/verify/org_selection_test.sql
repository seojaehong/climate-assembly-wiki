\set ON_ERROR_STOP on

-- Semantic rehearsal for the draft P1C organization selection migration.
\i /tmp/platform_p1c_activation_preflight.sql

do $test$
begin
  if has_function_privilege('anon', 'climate_vote.platform_activation_preflight()', 'EXECUTE')
     or has_function_privilege('authenticated', 'climate_vote.platform_activation_preflight()', 'EXECUTE')
     or not has_function_privilege('service_role', 'climate_vote.platform_activation_preflight()', 'EXECUTE')
     or not exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'climate_vote'
         and p.proname = 'platform_activation_preflight'
         and p.provolatile = 's'
         and p.prosecdef
     ) then
    raise exception 'P1C activation preflight execution privileges are unsafe';
  end if;
end $test$;

insert into climate_vote.org(id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'org-alpha', 'Organization Alpha', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'org-beta', 'Organization Beta', 'active');

insert into climate_vote.membership(id, org_id, user_id, role, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'facilitator', 'active');

do $test$
declare
  v_rejected boolean := false;
begin
  begin
    insert into climate_vote.org_context(token_hash, session_id, user_id, org_id)
    values (
      decode('00', 'hex'),
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'P1C accepted a non-SHA-256 organization context hash';
  end if;
end $test$;

insert into climate_vote.assembly(id, slug, title, status, org_id) values
  ('40000000-0000-4000-8000-000000000001', 'assembly-alpha', 'Assembly Alpha', 'active', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', 'assembly-beta', 'Assembly Beta', 'active', '10000000-0000-4000-8000-000000000002');

insert into climate_vote.session(id, slug, title, status, assembly_id, ordinal, held_on, org_id) values
  ('41000000-0000-4000-8000-000000000001', 'session-alpha', 'Session Alpha', 'active', '40000000-0000-4000-8000-000000000001', 1, '2026-08-16', '10000000-0000-4000-8000-000000000001'),
  ('41000000-0000-4000-8000-000000000002', 'session-beta', 'Session Beta', 'active', '40000000-0000-4000-8000-000000000002', 1, '2026-08-16', '10000000-0000-4000-8000-000000000002');

insert into climate_vote.discussion_topic(id, session_id, ordinal, prompt, status, org_id) values
  ('42000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 1, 'Topic Alpha', 'open', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 1, 'Topic Beta', 'open', '10000000-0000-4000-8000-000000000002');

insert into climate_vote.team(id, session_id, name, join_code, status, org_id) values
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'Team Alpha', '100001', 'active', '10000000-0000-4000-8000-000000000001'),
  ('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'Team Beta', '100002', 'active', '10000000-0000-4000-8000-000000000002');

insert into climate_vote.submission(id, topic_id, team_id, status, org_id) values
  ('44000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', 'draft', '10000000-0000-4000-8000-000000000001'),
  ('44000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', '43000000-0000-4000-8000-000000000002', 'draft', '10000000-0000-4000-8000-000000000002');

insert into climate_vote.ballot(id, session_id, title, status, org_id) values
  ('45000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'Ballot Alpha', 'draft', '10000000-0000-4000-8000-000000000001'),
  ('45000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'Ballot Beta', 'draft', '10000000-0000-4000-8000-000000000002');

insert into auth.users(id, email, email_confirmed_at, is_anonymous) values
  ('30000000-0000-4000-8000-000000000001', 'operator-one@example.test', clock_timestamp() - interval '1 day', false),
  ('30000000-0000-4000-8000-000000000002', 'operator-two@example.test', clock_timestamp() - interval '1 day', false),
  ('30000000-0000-4000-8000-000000000003', 'facilitator@example.test', clock_timestamp() - interval '1 day', false);

do $test$
declare
  v_report jsonb := climate_vote.platform_activation_preflight();
begin
  if v_report ->> 'status' <> 'not_ready'
     or v_report ->> 'readConsistency' <> 'single_statement'
     or (v_report #>> '{summary,multiOrganizationUserCount}')::integer <> 2
     or (v_report #>> '{summary,organizationsWithoutAdminCount}')::integer <> 2
     or (v_report #>> '{summary,organizationsWithoutHqCount}')::integer <> 2
     or jsonb_path_exists(v_report, '$.**.user_id')
     or jsonb_path_exists(v_report, '$.**.org_id') then
    raise exception 'P1C activation preflight did not return the expected count-only blockers';
  end if;
end $test$;

begin;
update climate_vote.membership
set status = 'revoked'
where id in (
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000004'
);

insert into auth.users(id, email, email_confirmed_at, is_anonymous) values
  ('30000000-0000-4000-8000-000000000010', 'admin-alpha@example.test', clock_timestamp() - interval '1 day', false),
  ('30000000-0000-4000-8000-000000000011', 'hq-alpha@example.test', clock_timestamp() - interval '1 day', false),
  ('30000000-0000-4000-8000-000000000012', 'admin-beta@example.test', clock_timestamp() - interval '1 day', false),
  ('30000000-0000-4000-8000-000000000013', 'hq-beta@example.test', clock_timestamp() - interval '1 day', false);

insert into climate_vote.membership(id, org_id, user_id, role, status) values
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000010', 'org_admin', 'active'),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000011', 'hq', 'active'),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000012', 'org_admin', 'active'),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000013', 'hq', 'active');

set role service_role;
do $test$
declare
  v_report jsonb;
begin
  v_report := climate_vote.platform_activation_preflight();
  if v_report ->> 'status' <> 'ready'
     or (v_report #>> '{summary,totalNullOrgCount}')::integer <> 0
     or (v_report #>> '{summary,hierarchyMismatchCount}')::integer <> 0
     or jsonb_array_length(v_report -> 'blockers') <> 0
     or jsonb_array_length(v_report -> 'tables') <> 12 then
    raise exception 'P1C activation preflight rejected a ready tenant inventory';
  end if;
end $test$;
reset role;
rollback;

-- A missing grant target must roll back every earlier statement in the file.
alter table climate_vote.ballot rename to ballot_activation_unavailable;
\set ON_ERROR_STOP off
\i /tmp/platform_p1c_org_selection_activation.sql
\set ON_ERROR_STOP on

do $test$
declare
  v_table text;
begin
  if has_schema_privilege('authenticated', 'climate_vote', 'USAGE')
     or has_table_privilege('authenticated', 'climate_vote.membership', 'SELECT') then
    raise exception 'P1C failed activation left partial schema or membership privileges';
  end if;
  foreach v_table in array array['assembly', 'session', 'discussion_topic', 'submission'] loop
    if has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'SELECT')
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'INSERT')
       or has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'UPDATE') then
      raise exception 'P1C failed activation left partial staff table privileges';
    end if;
  end loop;
end $test$;

alter table climate_vote.ballot_activation_unavailable rename to ballot;

\i /tmp/platform_p1c_org_selection_activation.sql

\set expect_staff_grants on
\i /tmp/org_selection_post_apply.sql

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000001',
  'session_id', '50000000-0000-4000-8000-000000000001'
)::text, false);
select set_config('request.headers', '{}'::jsonb::text, false);
set role authenticated;

do $test$
declare
  v_org_count integer;
  v_selected_count integer;
  v_rejected boolean := false;
begin
  select count(*), count(*) filter (where selected)
    into v_org_count, v_selected_count
  from climate_vote.my_orgs();
  if v_org_count <> 2 or v_selected_count <> 0 then
    raise exception 'P1C preselection organization list mismatch';
  end if;

  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('organization selection required' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C did not reject an unselected multi-organization request';
  end if;
end $test$;

select climate_vote.org_select('10000000-0000-4000-8000-000000000002') ->> 'context_token' as context_token \gset
select set_config('platform.verify_context_token', :'context_token', false);
reset role;
do $test$
begin
  if not exists (
    select 1
    from climate_vote.org_context
    where token_hash = extensions.digest(current_setting('platform.verify_context_token'), 'sha256')
      and expires_at - created_at = interval '12 hours'
  ) then
    raise exception 'P1C organization context lifetime does not match 12 hours';
  end if;
end $test$;
set role authenticated;
select set_config('request.headers', jsonb_build_object(
  'x-platform-org-context', :'context_token'
)::text, false);

do $test$
declare
  v_selected_org uuid;
  v_visible_org uuid;
  v_selected_count integer;
begin
  select id, count(*) over ()
    into v_selected_org, v_selected_count
  from climate_vote.my_orgs()
  where selected;
  if v_selected_org <> '10000000-0000-4000-8000-000000000002' or v_selected_count <> 1 then
    raise exception 'P1C selected organization mismatch';
  end if;

  select org_id into v_visible_org from climate_vote.assembly limit 1;
  if v_visible_org <> '10000000-0000-4000-8000-000000000002'
     or (select count(*) from climate_vote.assembly) <> 1 then
    raise exception 'P1C RLS exposed an organization outside the selected context';
  end if;

  if (select count(*) from climate_vote.session) <> 1
     or exists (select 1 from climate_vote.session where org_id <> '10000000-0000-4000-8000-000000000002')
     or (select count(*) from climate_vote.discussion_topic) <> 1
     or exists (select 1 from climate_vote.discussion_topic where org_id <> '10000000-0000-4000-8000-000000000002')
     or (select count(*) from climate_vote.submission) <> 1
     or exists (select 1 from climate_vote.submission where org_id <> '10000000-0000-4000-8000-000000000002')
     or (select count(*) from climate_vote.ballot) <> 1
     or exists (select 1 from climate_vote.ballot where org_id <> '10000000-0000-4000-8000-000000000002') then
    raise exception 'P1C RLS did not isolate every staff table to the selected organization';
  end if;
end $test$;

do $test$
declare
  v_updated integer;
  v_rejected boolean := false;
begin
  update climate_vote.assembly set title = 'Selected Operator Update'
  where id = '40000000-0000-4000-8000-000000000002';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'P1C rejected an operator write in the selected organization';
  end if;

  update climate_vote.assembly set title = 'Cross Organization Update'
  where id = '40000000-0000-4000-8000-000000000001';
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'P1C allowed an operator update outside the selected organization';
  end if;

  begin
    insert into climate_vote.assembly(id, slug, title, status, org_id)
    values ('40000000-0000-4000-8000-000000000003', 'assembly-cross-org', 'Cross Organization Insert', 'active',
      '10000000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'P1C allowed an operator insert outside the selected organization';
  end if;
end $test$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000003',
  'session_id', '50000000-0000-4000-8000-000000000003'
)::text, false);
select set_config('request.headers', '{}'::jsonb::text, false);

do $test$
declare
  v_updated integer;
  v_rejected boolean := false;
begin
  update climate_vote.assembly set title = 'Facilitator Update'
  where id = '40000000-0000-4000-8000-000000000002';
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'P1C allowed a facilitator update';
  end if;

  begin
    insert into climate_vote.assembly(id, slug, title, status, org_id)
    values ('40000000-0000-4000-8000-000000000004', 'assembly-facilitator', 'Facilitator Insert', 'active',
      '10000000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'P1C allowed a facilitator insert';
  end if;
end $test$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000001',
  'session_id', '50000000-0000-4000-8000-000000000001'
)::text, false);
select set_config('request.headers', jsonb_build_object(
  'x-platform-org-context', :'context_token'
)::text, false);

reset role;
update climate_vote.org_context
set created_at = clock_timestamp() - interval '2 seconds',
    expires_at = clock_timestamp() - interval '1 second'
where token_hash = extensions.digest(:'context_token'::text, 'sha256');
set role authenticated;

do $test$
declare
  v_rejected boolean := false;
  v_selected_count integer;
begin
  select count(*) filter (where selected) into v_selected_count
  from climate_vote.my_orgs();
  if v_selected_count <> 0 then
    raise exception 'P1C accepted an expired organization context token';
  end if;

  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('organization selection required' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C did not reject an expired organization context token';
  end if;
end $test$;

select climate_vote.org_select('10000000-0000-4000-8000-000000000002') ->> 'context_token' as context_token \gset
select set_config('request.headers', jsonb_build_object(
  'x-platform-org-context', :'context_token'
)::text, false);

reset role;
do $test$
begin
  if exists (
    select 1 from climate_vote.org_context where expires_at <= clock_timestamp()
  ) then
    raise exception 'P1C organization selection did not prune expired contexts';
  end if;
end $test$;
set role authenticated;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000001',
  'session_id', '50000000-0000-4000-8000-000000000002'
)::text, false);

do $test$
declare
  v_rejected boolean := false;
begin
  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('organization selection required' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C accepted a context token from another Auth session';
  end if;
end $test$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000002',
  'session_id', '50000000-0000-4000-8000-000000000001'
)::text, false);

do $test$
declare
  v_rejected boolean := false;
  v_selected_count integer;
begin
  select count(*) filter (where selected) into v_selected_count
  from climate_vote.my_orgs();
  if v_selected_count <> 0 then
    raise exception 'P1C reused an organization context token for another user';
  end if;

  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('organization selection required' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C accepted a context token from another user';
  end if;
end $test$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000001',
  'session_id', '50000000-0000-4000-8000-000000000001'
)::text, false);
select set_config('request.headers', jsonb_build_object(
  'x-platform-org-context', '50000000-0000-4000-8000-000000000099'
)::text, false);

do $test$
declare
  v_rejected boolean := false;
begin
  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('organization selection required' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C accepted an unknown organization context token';
  end if;
end $test$;

reset role;

-- A missing revoke target must preserve the complete active grant set.
alter table climate_vote.membership rename to membership_activation_unavailable;
\set ON_ERROR_STOP off
\i /tmp/platform_p1c_org_selection_activation_BEFORE.sql
\set ON_ERROR_STOP on
alter table climate_vote.membership_activation_unavailable rename to membership;

\set expect_staff_grants on
\i /tmp/org_selection_post_apply.sql

\i /tmp/platform_p1c_org_selection_activation_BEFORE.sql
\set expect_staff_grants off
\i /tmp/org_selection_post_apply.sql
\i /tmp/platform_p1c_activation_preflight_BEFORE.sql
\i /tmp/platform_p1c_org_selection_BEFORE.sql

do $test$
declare
  v_rejected boolean := false;
  v_policy_count integer;
begin
  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('user belongs to multiple orgs' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C rollback did not restore multi-organization rejection';
  end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'climate_vote'
    and policyname in (
      'assembly_tenant_read', 'assembly_tenant_write',
      'session_tenant_read', 'session_tenant_write',
      'topic_tenant_read', 'topic_tenant_write',
      'submission_tenant_read', 'submission_tenant_write',
      'ballot_tenant_read', 'ballot_tenant_write'
    );
  if v_policy_count <> 10 then
    raise exception 'P1C rollback did not restore membership-wide policies';
  end if;

  if has_table_privilege('authenticated', 'climate_vote.membership', 'SELECT')
     or has_table_privilege('authenticated', 'climate_vote.assembly', 'SELECT') then
    raise exception 'P1C rollback left staff table grants active';
  end if;
  if not has_function_privilege('anon', 'climate_vote.org_of_uid()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'climate_vote.org_of_uid()', 'EXECUTE') then
    raise exception 'P1C rollback did not restore legacy org_of_uid execution privileges';
  end if;
end $test$;

do $test$
begin
  if to_regclass('climate_vote.org_context') is not null then
    raise exception 'P1C rollback left org_context behind';
  end if;
  if to_regprocedure('climate_vote.platform_activation_preflight()') is not null then
    raise exception 'P1C rollback left activation preflight behind';
  end if;
end $test$;

\echo === P1C ORG SELECTION REHEARSAL PASSED ===
