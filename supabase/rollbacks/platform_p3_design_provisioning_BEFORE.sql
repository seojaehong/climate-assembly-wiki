-- Draft rollback. Run before removing prerequisite P1/P1C schema.

begin;

do $rollback_guard$
declare
  v_populated_ledger_count bigint := 0;
  v_populated_ordinal_count bigint := 0;
begin
  if to_regclass('climate_vote.design_provisioning_operation') is not null then
    select count(*) into v_populated_ledger_count
    from climate_vote.design_provisioning_operation;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'climate_vote' and table_name = 'team' and column_name = 'ordinal'
  ) then
    execute 'select count(*) from climate_vote.team where ordinal is not null'
    into v_populated_ordinal_count;
  end if;
  if v_populated_ledger_count > 0 or v_populated_ordinal_count > 0 then
    raise exception using message = 'design_provisioning_rollback_requires_data_plan';
  end if;
end
$rollback_guard$;

revoke all on function climate_vote.design_provision(jsonb, bytea, jsonb) from public, anon, authenticated, service_role;
revoke all on function climate_vote.design_provision(jsonb, bytea) from public, anon, authenticated, service_role;
revoke all on function climate_vote.design_provisioning_status(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function climate_vote.design_provisioning_status(jsonb) from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_design_authorization_revision() from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_design_join_code() from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_sha256_hex(text) from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_json_canonical(jsonb) from public, anon, authenticated, service_role;

drop function if exists climate_vote.design_provisioning_status(jsonb, jsonb);
drop function if exists climate_vote.design_provisioning_status(jsonb);
drop function if exists climate_vote.design_provision(jsonb, bytea, jsonb);
drop function if exists climate_vote.design_provision(jsonb, bytea);
drop function if exists climate_vote.platform_design_authorization_revision();
drop function if exists climate_vote.platform_design_join_code();
drop function if exists climate_vote.platform_sha256_hex(text);
drop function if exists climate_vote.platform_json_canonical(jsonb);
drop table if exists climate_vote.design_provisioning_operation;

alter table climate_vote.team
  drop constraint if exists platform_team_session_ordinal_key,
  drop constraint if exists platform_team_capacity_positive,
  drop constraint if exists platform_team_ordinal_positive,
  drop column if exists ordinal;

alter table climate_vote.session
  drop constraint if exists platform_session_assembly_ordinal_key,
  drop constraint if exists platform_session_ordinal_positive,
  drop constraint if exists platform_session_title_shape,
  drop constraint if exists platform_session_slug_shape;

commit;
