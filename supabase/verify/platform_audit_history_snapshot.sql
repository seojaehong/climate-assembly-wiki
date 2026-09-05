\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;
set local search_path = pg_catalog, climate_vote;

do $required_history$
begin
  if to_regclass('climate_vote.attendance_audit_log') is null
     or to_regclass('climate_vote.workshop_audit_event') is null then
    raise exception 'P4 history snapshot failed: legacy audit table is missing';
  end if;
end
$required_history$;

select jsonb_build_object(
  'schemaVersion', 1,
  'kind', 'platform_audit_legacy_history_snapshot',
  'algorithm', 'sha256-canonical-jsonb-v1',
  'databaseMutationExecuted', false,
  'attendance', jsonb_build_object(
    'rowCount', (select count(*) from climate_vote.attendance_audit_log),
    'sha256', (select encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
      'sha256'), 'hex') from climate_vote.attendance_audit_log row_value)
  ),
  'workshop', jsonb_build_object(
    'rowCount', (select count(*) from climate_vote.workshop_audit_event),
    'sha256', (select encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
      'sha256'), 'hex') from climate_vote.workshop_audit_event row_value)
  )
) as platform_audit_legacy_history_snapshot;

commit;
\echo === P4 LEGACY AUDIT HISTORY SNAPSHOT PASSED ===
