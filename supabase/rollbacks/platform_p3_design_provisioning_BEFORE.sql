-- Draft rollback. Run before removing prerequisite P1/P1C schema.

begin;

revoke all on function climate_vote.design_provision(jsonb, bytea) from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_design_join_code() from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_sha256_hex(text) from public, anon, authenticated, service_role;
revoke all on function climate_vote.platform_json_canonical(jsonb) from public, anon, authenticated, service_role;

drop function if exists climate_vote.design_provision(jsonb, bytea);
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
