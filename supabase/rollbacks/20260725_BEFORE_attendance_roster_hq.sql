-- Roll back the additive 20260725 attendance feature.
-- Existing rounds/votes/team rows are preserved.

drop trigger if exists rounds_capture_attendance on climate_vote.rounds;
drop function if exists climate_vote.capture_round_attendance();
drop function if exists climate_vote.attendance_round_eligible_count(text);
drop function if exists climate_vote.attendance_hq_set_team_pin(text,uuid,text);
drop function if exists climate_vote.attendance_hq_audit(text,int);
drop function if exists climate_vote.attendance_member_save(text,uuid,text,text,uuid,boolean);
drop function if exists climate_vote.attendance_finalize_absent(text);
drop function if exists climate_vote.attendance_bulk_present(text,uuid[]);
drop function if exists climate_vote.attendance_set(text,uuid,text,timestamptz);
drop function if exists climate_vote.attendance_roster(text);
drop function if exists climate_vote.attendance_hq_summary();
drop function if exists climate_vote.attendance_hq_unlock(text,text);
drop function if exists climate_vote.attendance_team_unlock(text,text);
drop function if exists climate_vote.attendance_issue_token(text,uuid,text);
drop function if exists climate_vote.attendance_token_row(text);

drop table if exists climate_vote.round_attendance_snapshot;
drop table if exists climate_vote.attendance_auth_attempt;
drop table if exists climate_vote.attendance_auth_session;
drop table if exists climate_vote.attendance_secret;
drop table if exists climate_vote.attendance_audit_log;
drop table if exists climate_vote.attendance;
drop table if exists climate_vote.team_assignment;
drop table if exists climate_vote.assembly_member;

alter table climate_vote.team drop column if exists attendance_pin_hash;

create or replace function climate_vote.hq_teams()
returns table(id uuid, name text, subgroup text, capacity int, status text)
language sql security definer set search_path = climate_vote, pg_temp as $$
  select id,name,subgroup,capacity,status from climate_vote.team;
$$;
