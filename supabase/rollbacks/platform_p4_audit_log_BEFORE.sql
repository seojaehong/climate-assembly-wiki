-- Draft rollback. Production evidence must be exported and covered by an approved retention plan first.
begin;

do $rollback_guard$
begin
  if to_regclass('climate_vote.platform_audit_event') is not null
     and exists (select 1 from climate_vote.platform_audit_event limit 1) then
    raise exception 'platform_audit_rollback_requires_retention_plan';
  end if;
end
$rollback_guard$;

drop trigger if exists platform_audit_capture on climate_vote.design_provisioning_operation;
drop trigger if exists platform_audit_capture on climate_vote.result_page;
drop trigger if exists platform_audit_capture on climate_vote.issue_link;
drop trigger if exists platform_audit_capture on climate_vote.issue;
drop trigger if exists platform_audit_capture on climate_vote.ballot_item;
drop trigger if exists platform_audit_capture on climate_vote.ballot;
drop trigger if exists platform_audit_capture on climate_vote.submission_item;
drop trigger if exists platform_audit_capture on climate_vote.submission;
drop trigger if exists platform_audit_capture on climate_vote.team;
drop trigger if exists platform_audit_capture on climate_vote.discussion_topic;
drop trigger if exists platform_audit_capture on climate_vote.session;
drop trigger if exists platform_audit_capture on climate_vote.assembly;
drop trigger if exists platform_audit_capture on climate_vote.invitation;
drop trigger if exists platform_audit_capture on climate_vote.membership;
drop trigger if exists platform_audit_capture on climate_vote.org;

drop function if exists climate_vote.platform_audit_list(bigint, integer);
drop function if exists climate_vote.platform_audit_row_change();
drop function if exists climate_vote.platform_audit_org_for_row(text, jsonb);
drop table if exists climate_vote.platform_audit_event;
drop function if exists climate_vote.platform_audit_reject_change();

commit;
