\set ON_ERROR_STOP on
\if :{?a4_throwaway_fixture}
\else
  \echo A4 throwaway fixture flag is required
  select 1 / 0 as fixture_guard_failure;
\endif
\if :a4_throwaway_fixture
\else
  \echo A4 throwaway fixture flag must be enabled
  select 1 / 0 as fixture_guard_failure;
\endif

-- Test-only cleanup of the exact A4 rehearsal scope. Never run against production.
do $guard$
begin
  if current_database() <> 'verify' then
    raise exception 'A4 fixture refused outside the verify database';
  end if;
end
$guard$;

delete from climate_vote.design_provisioning_operation
where org_id in (
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001'
);

delete from climate_vote.discussion_topic
where session_id in (
  select s.id
  from climate_vote.session s
  join climate_vote.assembly a on a.id = s.assembly_id
  where a.slug in ('a4-test-assembly', 'a4-legacy-assembly')
);

delete from climate_vote.team
where session_id in (
  select s.id
  from climate_vote.session s
  join climate_vote.assembly a on a.id = s.assembly_id
  where a.slug in ('a4-test-assembly', 'a4-legacy-assembly')
);

delete from climate_vote.session
where assembly_id in (
  select id from climate_vote.assembly
  where slug in ('a4-test-assembly', 'a4-legacy-assembly')
);

delete from climate_vote.assembly
where slug in ('a4-test-assembly', 'a4-legacy-assembly');

delete from climate_vote.membership
where org_id in (
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001'
);

delete from climate_vote.org
where id in (
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001'
);

delete from auth.users
where id = '10000000-0000-0000-0000-000000000001';

do $verify$
begin
  if exists (
       select 1 from climate_vote.design_provisioning_operation
       where org_id in (
         '20000000-0000-0000-0000-000000000001',
         '30000000-0000-0000-0000-000000000001'
       )
     )
     or exists (
       select 1 from climate_vote.assembly
       where slug in ('a4-test-assembly', 'a4-legacy-assembly')
     ) then
    raise exception 'A4 fixture cleanup was incomplete';
  end if;
end
$verify$;

\echo === A4 ROLLBACK CLEANUP FIXTURE COMPLETED ===
