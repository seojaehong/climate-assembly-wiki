\set ON_ERROR_STOP on
\if :{?a4_throwaway_fixture}
\else
  \echo A4 throwaway fixture flag is required
  \quit 3
\endif
\if :a4_throwaway_fixture
\else
  \echo A4 throwaway fixture flag must be enabled
  \quit 3
\endif

-- Test-only legacy rows. Never run against a production database.
do $guard$
begin
  if current_database() <> 'verify' then
    raise exception 'A4 fixture refused outside the verify database';
  end if;
end
$guard$;

insert into climate_vote.org (id, slug, name, status)
values ('30000000-0000-0000-0000-000000000001', 'a4-legacy-org', 'A4 legacy org', 'active');

insert into climate_vote.assembly (id, slug, title, purpose, mode, config, status, org_id)
values (
  '31000000-0000-0000-0000-000000000001',
  'a4-legacy-assembly',
  'A4 legacy assembly',
  'Preflight lifecycle fixture',
  'consensus',
  '{"readiness":["topics_open"]}'::jsonb,
  'draft',
  '30000000-0000-0000-0000-000000000001'
);

insert into climate_vote.session (id, slug, title, status, assembly_id, ordinal, held_on, org_id)
values (
  '32000000-0000-0000-0000-000000000001',
  'a4-legacy-session',
  'A4 legacy session',
  'draft',
  '31000000-0000-0000-0000-000000000001',
  1,
  '2026-09-10',
  '30000000-0000-0000-0000-000000000001'
);

insert into climate_vote.team (id, session_id, name, join_code, capacity, status, org_id)
values (
  '33000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  'Legacy team',
  '654321',
  12,
  'active',
  '30000000-0000-0000-0000-000000000001'
);

\echo === A4 LEGACY PREFLIGHT FIXTURE INSTALLED ===
