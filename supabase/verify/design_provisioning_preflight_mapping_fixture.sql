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

-- Test-only simulation of a separately approved team ordinal mapping.
do $guard$
begin
  if current_database() <> 'verify' then
    raise exception 'A4 fixture refused outside the verify database';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'climate_vote' and table_name = 'team' and column_name = 'ordinal'
  ) then
    raise exception 'A4 fixture requires the additive migration';
  end if;
end
$guard$;

update climate_vote.team
set ordinal = 1
where id = '33000000-0000-0000-0000-000000000001'
  and ordinal is null;

do $verify$
begin
  if not exists (
    select 1 from climate_vote.team
    where id = '33000000-0000-0000-0000-000000000001' and ordinal = 1
  ) then
    raise exception 'A4 fixture mapping was not applied exactly once';
  end if;
end
$verify$;

\echo === A4 PREFLIGHT MAPPING FIXTURE INSTALLED ===
