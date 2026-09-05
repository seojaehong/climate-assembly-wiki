\set ON_ERROR_STOP on
set check_function_bodies = on;

do $roles$
begin
  if not exists(select 1 from pg_roles where rolname='authenticator') then
    create role authenticator nologin;
  end if;
end $roles$;

\echo === P2A PRELUDE ===
\i /tmp/00_prelude.sql
\echo === P2A LEGACY WORKSHOP SCHEMA ===
\i /tmp/20260621140534_snapshot_include_agenda.sql
\i /tmp/20260724_mod_console_core.sql
\i /tmp/20260724_capture_votes_unique_index.sql
\i /tmp/20260724_mod_log_timer_rpc.sql
\i /tmp/20260724_votes_active_round_guard.sql
\i /tmp/20260725_attendance_roster_hq.sql
\i /tmp/20260726_team_table_no.sql
\i /tmp/20260726_attendance_unlock_by_join_code.sql
\i /tmp/20260726_revoke_public_execute_attendance.sql
\i /tmp/20260726_revoke_pin_unlock.sql
\i /tmp/20260726_grant_authenticated_execute.sql
\i /tmp/20260808_s1_assembly_topic_submission.sql
\i /tmp/20260808_s2_ballot_multi_agenda.sql
\i /tmp/20260808_s4_ballot_subgroup.sql
\i /tmp/20260828_s8_hq_reopen_and_history.sql
\i /tmp/20260828_s9_submission_category.sql
\i /tmp/20260828_s10_hq_named_operator.sql
\i /tmp/20260828_s11_hq_change_password.sql
\i /tmp/20260828_s12_ontology_kind.sql
\i /tmp/20260828_s13_team_reopen.sql
\i /tmp/20260828_s14_hq_clear_submissions.sql
\i /tmp/20260830_s15_submission_server_line_split.sql
\i /tmp/20260901_s17_topic_deadline.sql
\i /tmp/20260902_s19_hq_topic_deadlines.sql

\echo === P2A TENANCY AND SYNTHETIC SESSION ===
\i /tmp/platform_p1_tenancy.sql
\i /tmp/0912-p1a-seed.sql
\echo === P2A ADDITIVE TOKEN ACCESS ===
\i /tmp/platform_p1a_0912_event_access.sql

\echo === P2 ANALYSIS BEFORE LOCKDOWN ===
\i /tmp/platform_p2_analysis_review.sql
\echo === P1 BACKFILL AND REQUEST ORG SELECTION ===
\i /tmp/platform_p1b_backfill.sql
\i /tmp/platform_p1c_org_selection.sql
\i /tmp/platform_p1c_activation_preflight.sql
\i /tmp/platform_p1c_org_selection_activation.sql

\echo === PRODUCTION LEGACY OPERATIONAL ACL SURFACE ===
-- The live archive routine historically allowed authenticated+service_role;
-- P2a must narrow it to service_role. The retired public admin routine is an
-- equivalent fixture for a DB-only legacy function not present in migrations.
revoke execute on function climate_vote.cv_archive_round(text,text,text)
  from public, anon, authenticated;
grant execute on function climate_vote.cv_archive_round(text,text,text)
  to authenticated, service_role;
create or replace function public.cv_set_active(p_round_id text)
returns jsonb language sql security definer as $$
  select jsonb_build_object('round_id',p_round_id,'fixture',true)
$$;
grant execute on function public.cv_set_active(text) to public, anon, authenticated;

\echo === LEGACY ROUND/VOTE TABLE SURFACE BEFORE ATOMIC CUTOVER ===
grant select on table climate_vote.rounds to anon, authenticated;
grant select, insert on table climate_vote.votes to anon, authenticated;
create or replace view public.cv_rounds as select * from climate_vote.rounds;
create or replace view public.cv_votes as select * from climate_vote.votes;
create or replace view public.cv_tally as
  select round_id,choice,count(*)::int as n from climate_vote.votes
   where archived_at is null group by round_id,choice;
create or replace view public.cv_tally_scale as
  select round_id,count(*)::int as n from climate_vote.votes
   where archived_at is null group by round_id;
grant select on table public.cv_rounds,public.cv_tally,public.cv_tally_scale
to anon, authenticated;
grant select,insert on table public.cv_votes to anon, authenticated;

\echo === P2A EXPLICIT TOKEN-ONLY ACTIVATION ===
\i /tmp/platform_p2a_0912_token_only_activation.sql
\echo === P2A ACTIVATION BEHAVIOR ===
\i /tmp/platform_p2a_0912_token_only_activation.verify.sql

\echo === LATER PLATFORM MIGRATIONS MUST NOT REOPEN LEGACY EXECUTE ===
\i /tmp/platform_p3_design_provisioning.sql
\i /tmp/design_provisioning_post_apply.sql
\echo === CAPTURE PRE-P4 LEGACY AUDIT HISTORY ===
\i /tmp/platform_audit_history_snapshot.sql
create temporary table p4_legacy_history_before (
  attendance_row_count bigint not null,
  attendance_sha256 text not null,
  workshop_row_count bigint not null,
  workshop_sha256 text not null
) on commit preserve rows;
insert into p4_legacy_history_before
select
  (select count(*) from climate_vote.attendance_audit_log),
  (select encode(extensions.digest(
    coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
    'sha256'), 'hex') from climate_vote.attendance_audit_log row_value),
  (select count(*) from climate_vote.workshop_audit_event),
  (select encode(extensions.digest(
    coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
    'sha256'), 'hex') from climate_vote.workshop_audit_event row_value);
\i /tmp/platform_p4_audit_log.sql
\i /tmp/platform_audit_post_apply.sql
\i /tmp/platform_audit_history_snapshot.sql
do $p4_history_preservation$
declare
  v_before p4_legacy_history_before%rowtype;
  v_attendance_count bigint;
  v_attendance_sha256 text;
  v_workshop_count bigint;
  v_workshop_sha256 text;
begin
  select * into strict v_before from p4_legacy_history_before;
  select count(*), encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
      'sha256'), 'hex')
    into v_attendance_count, v_attendance_sha256
    from climate_vote.attendance_audit_log row_value;
  select count(*), encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.id), '[]'::jsonb)::text,
      'sha256'), 'hex')
    into v_workshop_count, v_workshop_sha256
    from climate_vote.workshop_audit_event row_value;
  if v_before.attendance_row_count is distinct from v_attendance_count
     or v_before.attendance_sha256 is distinct from v_attendance_sha256
     or v_before.workshop_row_count is distinct from v_workshop_count
     or v_before.workshop_sha256 is distinct from v_workshop_sha256
     or (select count(*) from climate_vote.platform_audit_event) <> 0 then
    raise exception 'P4 migration changed pre-existing audit history';
  end if;
end
$p4_history_preservation$;
drop table p4_legacy_history_before;
\i /tmp/platform_p2a_0912_token_only_activation.verify.sql

\echo === P2A ACTIVATION ROLLBACK ===
set climate_vote.emergency_rollback_ack='I_ACCEPT_LEGACY_ACCESS_REOPEN';
set climate_vote.emergency_rollback_incident='disposable-verification-only';
\i /tmp/platform_p2a_0912_token_only_activation_BEFORE.sql
reset climate_vote.emergency_rollback_ack;
reset climate_vote.emergency_rollback_incident;
\i /tmp/platform_p2a_0912_token_only_activation.rollback.verify.sql

\echo === P2A REAPPLY AFTER ROLLBACK ===
\i /tmp/platform_p2a_0912_token_only_activation.sql
\i /tmp/platform_p2a_0912_token_only_activation.verify.sql

\echo === P2A 0912 ACTIVATION DRIVER PASSED ===
