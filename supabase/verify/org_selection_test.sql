\set ON_ERROR_STOP on

-- Semantic rehearsal for the draft P1C organization selection migration.
insert into climate_vote.org(id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'org-alpha', 'Organization Alpha', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'org-beta', 'Organization Beta', 'active');

insert into climate_vote.membership(id, org_id, user_id, role, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'operator', 'active'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'operator', 'active');

insert into climate_vote.assembly(id, slug, title, status, org_id) values
  ('40000000-0000-4000-8000-000000000001', 'assembly-alpha', 'Assembly Alpha', 'active', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', 'assembly-beta', 'Assembly Beta', 'active', '10000000-0000-4000-8000-000000000002');

grant usage on schema climate_vote to authenticated;
grant select on climate_vote.membership, climate_vote.assembly to authenticated;

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
end $test$;

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
\i /tmp/platform_p1c_org_selection_BEFORE.sql

set role authenticated;
do $test$
declare
  v_rejected boolean := false;
begin
  begin
    perform climate_vote.org_of_uid();
  exception when others then
    v_rejected := position('user belongs to multiple orgs' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'P1C rollback did not restore multi-organization rejection';
  end if;

  if (select count(*) from climate_vote.assembly) <> 2 then
    raise exception 'P1C rollback did not restore membership-wide dormant policies';
  end if;
end $test$;
reset role;

do $test$
begin
  if to_regclass('climate_vote.org_context') is not null then
    raise exception 'P1C rollback left org_context behind';
  end if;
end $test$;

\echo === P1C ORG SELECTION REHEARSAL PASSED ===
