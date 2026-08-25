\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- Read-only A4 preflight. This script never installs or mutates database objects.
with column_state as (
  select
    to_regclass('climate_vote.session') is not null as session_table_present,
    to_regclass('climate_vote.team') is not null as team_table_present,
    to_regclass('climate_vote.assembly') is not null as assembly_table_present,
    to_regclass('climate_vote.discussion_topic') is not null as topic_table_present,
    to_regclass('climate_vote.org') is not null as org_table_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'climate_vote' and table_name = 'team' and column_name = 'ordinal'
    ) as team_ordinal_present
), counts as (
  select
    (select count(*) from climate_vote.session
      where slug is null or title is null or assembly_id is null or ordinal is null
         or held_on is null or org_id is null) as session_required_null_count,
    (select count(*) from (
      select slug from climate_vote.session where slug is not null group by slug having count(*) > 1
    ) duplicates) as session_slug_duplicate_count,
    (select count(*) from (
      select assembly_id, ordinal from climate_vote.session
      where assembly_id is not null and ordinal is not null
      group by assembly_id, ordinal having count(*) > 1
    ) duplicates) as session_ordinal_duplicate_count,
    (select count(*) from climate_vote.session s
      left join climate_vote.assembly a on a.id = s.assembly_id
      where s.assembly_id is not null
        and (a.id is null or s.org_id is null or a.org_id is null or s.org_id is distinct from a.org_id)
    ) as session_parent_org_mismatch_count,
    (select count(*) from climate_vote.team
      where capacity is null or capacity <= 0 or org_id is null) as team_required_invalid_count,
    (select count(*) from climate_vote.team) as team_rows_requiring_ordinal_mapping_count,
    (select count(*) from climate_vote.team t
      left join climate_vote.session s on s.id = t.session_id
      where s.id is null or t.org_id is null or s.org_id is null or t.org_id is distinct from s.org_id
    ) as team_parent_org_mismatch_count,
    (select count(*) from climate_vote.discussion_topic dt
      left join climate_vote.session s on s.id = dt.session_id
      where s.id is null or dt.org_id is null or s.org_id is null or dt.org_id is distinct from s.org_id
    ) as topic_parent_org_mismatch_count
)
select jsonb_build_object(
  'schemaVersion', 1,
  'kind', 'platform_design_provisioning_preflight',
  'databaseMutationExecuted', false,
  'ready',
    cs.session_table_present and cs.team_table_present and cs.assembly_table_present
    and cs.topic_table_present and cs.org_table_present
    and c.session_required_null_count = 0
    and c.session_slug_duplicate_count = 0
    and c.session_ordinal_duplicate_count = 0
    and c.session_parent_org_mismatch_count = 0
    and c.team_required_invalid_count = 0
    and c.team_rows_requiring_ordinal_mapping_count = 0
    and c.team_parent_org_mismatch_count = 0
    and c.topic_parent_org_mismatch_count = 0,
  'columns', jsonb_build_object(
    'sessionTablePresent', cs.session_table_present,
    'teamTablePresent', cs.team_table_present,
    'assemblyTablePresent', cs.assembly_table_present,
    'topicTablePresent', cs.topic_table_present,
    'orgTablePresent', cs.org_table_present,
    'teamOrdinalPresent', cs.team_ordinal_present
  ),
  'counts', jsonb_build_object(
    'sessionRequiredNullCount', c.session_required_null_count,
    'sessionSlugDuplicateCount', c.session_slug_duplicate_count,
    'sessionOrdinalDuplicateCount', c.session_ordinal_duplicate_count,
    'sessionParentOrgMismatchCount', c.session_parent_org_mismatch_count,
    'teamRequiredInvalidCount', c.team_required_invalid_count,
    'teamRowsRequiringOrdinalMappingCount', c.team_rows_requiring_ordinal_mapping_count,
    'teamParentOrgMismatchCount', c.team_parent_org_mismatch_count,
    'topicParentOrgMismatchCount', c.topic_parent_org_mismatch_count
  ),
  'requiresApprovedBackfill', c.session_required_null_count > 0
    or c.team_rows_requiring_ordinal_mapping_count > 0
) as design_provisioning_preflight
from column_state cs cross join counts c;

\echo === A4 DESIGN PROVISIONING PREFLIGHT PASSED ===
