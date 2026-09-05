\set ON_ERROR_STOP on
\if :{?seed_cli_throwaway_fixture}
\else
  \echo Seed CLI throwaway fixture flag is required
  select 1 / 0 as fixture_guard_failure;
\endif
\if :seed_cli_throwaway_fixture
\else
  \echo Seed CLI throwaway fixture flag must be enabled
  select 1 / 0 as fixture_guard_failure;
\endif

-- Synthetic, non-PII source tenancy for executing the real CLI-generated SQL.
do $guard$
begin
  if current_database() <> 'verify' then
    raise exception 'seed CLI fixture refused outside the verify database';
  end if;
end
$guard$;

\i /tmp/00_prelude.sql
\i /tmp/20260724_mod_console_core.sql
\i /tmp/20260725_attendance_roster_hq.sql
\i /tmp/20260726_team_table_no.sql
\i /tmp/20260808_s1_assembly_topic_submission.sql
\i /tmp/20260808_s2_ballot_multi_agenda.sql
\i /tmp/20260808_s4_ballot_subgroup.sql
\i /tmp/platform_p1_tenancy.sql

insert into climate_vote.org (id, slug, name, status)
values (
  '89200000-0000-4000-8000-000000000001',
  'seed-cli-verify-org',
  'Seed CLI verify organization',
  'active'
);

insert into climate_vote.assembly
  (id, slug, title, purpose, mode, config, status, org_id)
values (
  '89200000-0000-4000-8000-000000000002',
  'seed-cli-verify-assembly',
  'Seed CLI verify assembly',
  'Disposable seed SQL verification',
  'consensus',
  '{}'::jsonb,
  'active',
  '89200000-0000-4000-8000-000000000001'
);

insert into climate_vote.session
  (id, slug, title, config, status, assembly_id, ordinal, held_on, org_id)
values (
  '89200000-0000-4000-8000-000000000003',
  '0829-deliberation',
  'Seed CLI tenancy source',
  '{}'::jsonb,
  'active',
  '89200000-0000-4000-8000-000000000002',
  1,
  '2026-08-29',
  '89200000-0000-4000-8000-000000000001'
);

\echo === SEED CLI THROWAWAY SOURCE INSTALLED ===
