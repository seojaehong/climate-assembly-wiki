\set ON_ERROR_STOP on
\if :{?p1a_throwaway_fixture}
\else
  \echo P1a throwaway fixture flag is required
  select 1 / 0 as fixture_guard_failure;
\endif
\if :p1a_throwaway_fixture
\else
  \echo P1a throwaway fixture flag must be enabled
  select 1 / 0 as fixture_guard_failure;
\endif

-- Synthetic, non-PII event data for disposable PostgreSQL verification only.
do $guard$
begin
  if current_database() <> 'verify' then
    raise exception 'P1a fixture refused outside the verify database';
  end if;
end
$guard$;

insert into climate_vote.org (id, slug, name, status)
values (
  '91200000-0000-0000-0000-000000000001',
  'p1a-verify-org',
  'P1a verify organization',
  'active'
);

insert into climate_vote.assembly
  (id, slug, title, purpose, mode, config, status, org_id)
values (
  '91200000-0000-0000-0000-000000000002',
  'p1a-verify-assembly',
  'P1a verify assembly',
  'Disposable database contract verification',
  'consensus',
  '{}'::jsonb,
  'active',
  '91200000-0000-0000-0000-000000000001'
);

insert into climate_vote.session
  (id, slug, title, config, status, assembly_id, ordinal, held_on, org_id)
values (
  '91200000-0000-0000-0000-000000000003',
  '0912-deliberation',
  'P1a 0912 verification session',
  '{}'::jsonb,
  'active',
  '91200000-0000-0000-0000-000000000002',
  1,
  '2026-09-12',
  '91200000-0000-0000-0000-000000000001'
);

insert into climate_vote.team
  (id, session_id, name, subgroup, join_code, capacity, status, table_no, org_id)
values
  (
    '91200000-0000-0000-0000-000000000011',
    '91200000-0000-0000-0000-000000000003',
    'P1a verify team A',
    'synthetic-a',
    '091201',
    8,
    'active',
    'A-01',
    '91200000-0000-0000-0000-000000000001'
  ),
  (
    '91200000-0000-0000-0000-000000000012',
    '91200000-0000-0000-0000-000000000003',
    'P1a verify team B',
    'synthetic-b',
    '091202',
    8,
    'active',
    'B-01',
    '91200000-0000-0000-0000-000000000001'
  );

insert into climate_vote.discussion_topic
  (id, session_id, ordinal, block, prompt, guidance, status, org_id)
values (
  '91200000-0000-0000-0000-000000000021',
  '91200000-0000-0000-0000-000000000003',
  1,
  'am',
  'Synthetic verification topic',
  'No personal data is used in this fixture.',
  'draft',
  '91200000-0000-0000-0000-000000000001'
);

\echo === P1A 0912 THROWAWAY FIXTURE INSTALLED ===
