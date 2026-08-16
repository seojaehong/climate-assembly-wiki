\set ON_ERROR_STOP on

-- Semantic rehearsal for the draft P1C organization selection migration.
insert into climate_vote.org(id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'org-alpha', 'Organization Alpha', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'org-beta', 'Organization Beta', 'active');

insert into climate_vote.membership(id, org_id, user_id, role, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'facilitator', 'active');

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

grant usage on schema climate_vote to authenticated;
grant select on climate_vote.membership to authenticated;
grant select, insert, update on climate_vote.assembly, climate_vote.session,
  climate_vote.discussion_topic, climate_vote.submission, climate_vote.ballot to authenticated;

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
\i /tmp/platform_p1c_org_selection_activation_BEFORE.sql
\set expect_staff_grants off
\i /tmp/org_selection_post_apply.sql
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
end $test$;

do $test$
begin
  if to_regclass('climate_vote.org_context') is not null then
    raise exception 'P1C rollback left org_context behind';
  end if;
end $test$;

\echo === P1C ORG SELECTION REHEARSAL PASSED ===
