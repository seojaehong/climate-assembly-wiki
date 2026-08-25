\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- Read-only A4 preflight. This script never installs or mutates database objects.
-- Additive migration readiness and RPC activation readiness are intentionally separate.
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
    (select count(*) from climate_vote.session
      where (slug is not null and slug !~ '^[a-z0-9-]{3,40}$')
         or (title is not null and length(trim(title)) not between 1 and 200)
         or (ordinal is not null and ordinal <= 0)) as session_shape_invalid_count,
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
      where capacity is null or capacity <= 0) as team_capacity_invalid_count,
    (select count(*) from climate_vote.team t
      where not cs.team_ordinal_present or (to_jsonb(t) ->> 'ordinal') is null
    ) as team_ordinal_null_count,
    (select count(*) from climate_vote.team t
      where cs.team_ordinal_present
        and (to_jsonb(t) ->> 'ordinal') is not null
        and (to_jsonb(t) ->> 'ordinal')::integer <= 0
    ) as team_ordinal_invalid_count,
    (select count(*) from (
      select t.session_id, to_jsonb(t) ->> 'ordinal' as ordinal
      from climate_vote.team t
      where cs.team_ordinal_present and (to_jsonb(t) ->> 'ordinal') is not null
      group by t.session_id, to_jsonb(t) ->> 'ordinal'
      having count(*) > 1
    ) duplicates) as team_ordinal_duplicate_count,
    (select count(*) from climate_vote.team t
      left join climate_vote.session s on s.id = t.session_id
      where s.id is null or t.org_id is null or s.org_id is null or t.org_id is distinct from s.org_id
    ) as team_parent_org_mismatch_count,
    (select count(*) from climate_vote.discussion_topic dt
      left join climate_vote.session s on s.id = dt.session_id
      where s.id is null or dt.org_id is null or s.org_id is null or dt.org_id is distinct from s.org_id
    ) as topic_parent_org_mismatch_count
  from column_state cs
), readiness as (
  select
    cs.*,
    c.*,
    cs.session_table_present and cs.team_table_present and cs.assembly_table_present
      and cs.topic_table_present and cs.org_table_present
      and c.session_shape_invalid_count = 0
      and c.session_slug_duplicate_count = 0
      and c.session_ordinal_duplicate_count = 0
      and c.team_capacity_invalid_count = 0 as ready_for_additive_migration
  from column_state cs cross join counts c
), activation as (
  select
    r.*,
    r.ready_for_additive_migration
      and r.session_required_null_count = 0
      and r.session_parent_org_mismatch_count = 0
      and r.team_ordinal_present
      and r.team_ordinal_null_count = 0
      and r.team_ordinal_invalid_count = 0
      and r.team_ordinal_duplicate_count = 0
      and r.team_parent_org_mismatch_count = 0
      and r.topic_parent_org_mismatch_count = 0 as ready_for_activation
  from readiness r
)
select jsonb_build_object(
  'schemaVersion', 2,
  'kind', 'platform_design_provisioning_preflight',
  'databaseMutationExecuted', false,
  'status', case
    when a.ready_for_activation then 'activation_ready'
    when a.ready_for_additive_migration then 'migration_ready'
    else 'not_ready'
  end,
  'readyForAdditiveMigration', a.ready_for_additive_migration,
  'readyForActivation', a.ready_for_activation,
  'columns', jsonb_build_object(
    'sessionTablePresent', a.session_table_present,
    'teamTablePresent', a.team_table_present,
    'assemblyTablePresent', a.assembly_table_present,
    'topicTablePresent', a.topic_table_present,
    'orgTablePresent', a.org_table_present,
    'teamOrdinalPresent', a.team_ordinal_present
  ),
  'counts', jsonb_build_object(
    'sessionRequiredNullCount', a.session_required_null_count,
    'sessionShapeInvalidCount', a.session_shape_invalid_count,
    'sessionSlugDuplicateCount', a.session_slug_duplicate_count,
    'sessionOrdinalDuplicateCount', a.session_ordinal_duplicate_count,
    'sessionParentOrgMismatchCount', a.session_parent_org_mismatch_count,
    'teamCapacityInvalidCount', a.team_capacity_invalid_count,
    'teamOrdinalNullCount', a.team_ordinal_null_count,
    'teamOrdinalInvalidCount', a.team_ordinal_invalid_count,
    'teamOrdinalDuplicateCount', a.team_ordinal_duplicate_count,
    'teamParentOrgMismatchCount', a.team_parent_org_mismatch_count,
    'topicParentOrgMismatchCount', a.topic_parent_org_mismatch_count
  ),
  'requiresApprovedBackfill', a.session_required_null_count > 0 or a.team_ordinal_null_count > 0
) as design_provisioning_preflight
from activation a;

\echo === A4 DESIGN PROVISIONING PREFLIGHT PASSED ===
