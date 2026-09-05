-- Roll back platform_p1a_0912_event_access.sql.
-- This script refuses to erase event activity. If the preflight fails, retain the
-- additive schema and deploy a forward compatibility fix instead.

begin;

do $guard$
begin
  if exists(select 1 from climate_vote.workshop_request_ledger)
     or exists(select 1 from climate_vote.workshop_audit_event)
     or exists(select 1 from climate_vote.platform_canvas_round_event)
     or exists(select 1 from climate_vote.workshop_join_exchange_attempt)
     or exists(select 1 from climate_vote.result_implementation_event)
     or exists(select 1 from climate_vote.rounds
       where team_id is null and session_id is not null)
     or exists(select 1 from climate_vote.submission where version<>0)
     or exists(select 1 from climate_vote.submission_category_event
       where source_item_id is not null)
     or exists(select 1 from climate_vote.submission_kind_event
       where source_item_id is not null)
     or exists(select 1 from climate_vote.attendance_auth_attempt
       where source_hash is not null)
     or exists(select 1 from climate_vote.attendance_auth_session
       where session_id is not null or device_id is not null or revoked_at is not null) then
    raise exception 'P1a rollback refused: workshop activity exists; use a forward migration';
  end if;
end $guard$;

alter table climate_vote.team alter column join_code drop default;

drop function if exists climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid);
drop function if exists climate_vote.hq_clear_submissions_v2(text,text,text);
drop function if exists climate_vote.hq_topic_deadlines_v2(text,text);
drop function if exists climate_vote.hq_submission_kinds_v3(text,text);
drop function if exists climate_vote.hq_submission_kind_assign_v3(
  text,text,uuid,int,text,timestamptz,bigint,uuid);
drop function if exists climate_vote.hq_submission_kinds_v2(text,text);
drop function if exists climate_vote.hq_submission_kind_assign_v2(text,text,uuid,int,text);
drop function if exists climate_vote.hq_submission_categories_v3(text,text);
drop function if exists climate_vote.hq_submission_category_assign_v3(
  text,text,uuid,int,text,timestamptz,bigint,uuid);
drop function if exists climate_vote.hq_submission_categories_v2(text,text);
drop function if exists climate_vote.hq_submission_category_assign_v2(text,text,uuid,int,text);
drop function if exists climate_vote.hq_submission_history_v2(text,text);
drop function if exists climate_vote.submission_reopen_v2(text,text,uuid,text);
drop function if exists climate_vote.workshop_hq_logout_v2(text);
drop function if exists climate_vote.workshop_team_logout_v2(text);
drop function if exists climate_vote.hq_submissions_v3(text,text);
drop function if exists climate_vote.hq_submissions_v2(text,text);
drop function if exists climate_vote.attendance_hq_set_table_no_v2(text,text,uuid,text);
drop function if exists climate_vote.hq_teams_v2(text,text);
drop function if exists climate_vote.hq_rounds_v2(text,text);
drop function if exists climate_vote.hq_vote_counts_v2(text,text,text[]);
drop function if exists climate_vote.hq_votes_v2(text,text,text[]);
drop function if exists climate_vote.mod_rounds_v2(text);
drop function if exists climate_vote.mod_session_teams_v2(text);
drop function if exists climate_vote.mod_vote_counts_v2(text,text[]);
drop function if exists climate_vote.mod_votes_v2(text,text);
drop function if exists climate_vote.public_round_get_v2(text);
drop function if exists climate_vote.public_round_votes_v2(text);
drop function if exists climate_vote.public_round_cast_v2(text,jsonb,text);
drop function if exists climate_vote.attendance_hq_set_team_pin_v2(text,text,uuid,text);
drop function if exists climate_vote.attendance_hq_audit_v2(text,text,int);
drop function if exists climate_vote.attendance_member_save_v2(text,text,uuid,text,text,uuid,boolean);
drop function if exists climate_vote.attendance_finalize_absent_v2(text,text);
drop function if exists climate_vote.attendance_bulk_present_v2(text,text,uuid[]);
drop function if exists climate_vote.attendance_set_v2(text,text,uuid,text,timestamptz);
drop function if exists climate_vote.attendance_hq_summary_v2(text,text);
drop function if exists climate_vote.attendance_roster_v2(text,text);
drop function if exists climate_vote.attendance_round_eligible_count_v2(text,text);
drop function if exists climate_vote.attendance_scope_session_row(text,text);

drop function if exists climate_vote.workshop_hq_revoke_device(text,text,text,text);
drop function if exists climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid);
drop function if exists climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamptz,timestamptz,uuid);
drop function if exists climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,uuid);
drop function if exists climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid);
drop function if exists climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid);
drop function if exists climate_vote.workshop_hq_devices(text,text);
drop function if exists climate_vote.workshop_hq_open_next_topic(text,text,int,uuid);
drop function if exists climate_vote.workshop_hq_status(text,text);
drop function if exists climate_vote.ballot_results_v2(text,text);
drop function if exists climate_vote.ballot_list_v2(text);
drop function if exists climate_vote.platform_result_implementation_upsert_v3(
  uuid,text,uuid,jsonb,text,uuid);
drop function if exists climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb);
drop function if exists climate_vote.platform_result_unpublish_v2(uuid,uuid);
drop function if exists climate_vote.platform_result_publish_v2(uuid,text,uuid,text);
drop function if exists climate_vote.platform_result_implementation_snapshot_hash(jsonb);
drop function if exists climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid);
drop function if exists climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid);
drop function if exists climate_vote.platform_issue_review_v2(uuid,uuid);
drop function if exists climate_vote.platform_issue_merge_v2(uuid,uuid,uuid);
drop function if exists climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid);
drop function if exists climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid);
drop function if exists climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid);
drop function if exists climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb);
drop function if exists climate_vote.platform_issue_items_v2(uuid,uuid);
drop function if exists climate_vote.platform_issue_list_v2(uuid,uuid);
drop function if exists climate_vote.platform_issue_snapshot_hash(uuid);
drop function if exists climate_vote.platform_ballot_results_v2(text,uuid);
drop function if exists climate_vote.platform_ballot_list_v2(uuid);
drop function if exists climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid);
drop function if exists climate_vote.platform_canvas_round_current_v2(uuid);
drop function if exists climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid);
drop function if exists climate_vote.platform_readiness_check_v2(uuid);
drop function if exists climate_vote.platform_staff_session_for_roles(uuid,text[]);
drop function if exists climate_vote.platform_staff_live_session_row(uuid);
drop function if exists climate_vote.platform_staff_session_row(uuid);
drop function if exists climate_vote.ballot_set_status_v2(text,uuid,text);
drop function if exists climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid);
drop function if exists climate_vote.ballot_create_v2(text,text,text,jsonb,text);
drop function if exists climate_vote.mod_log_timer_v2(text,text,int,timestamptz,timestamptz);
drop function if exists climate_vote.mod_proxy_vote_v2(text,text,jsonb,int);
drop function if exists climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid);
drop function if exists climate_vote.mod_set_round_status_v3(text,text,text,text,uuid);
drop function if exists climate_vote.mod_set_round_status_v2(text,text,text);
drop function if exists climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid);
drop function if exists climate_vote.mod_create_round_v2(text,text,text,jsonb);
drop function if exists climate_vote.submission_reopen_by_team_v2(text,uuid);
drop function if exists climate_vote.submission_finalize_v2(text,uuid,bigint);
drop function if exists climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean);
drop function if exists climate_vote.submission_get_v2(text,uuid);
drop function if exists climate_vote.topic_list_v2(text);
drop function if exists climate_vote.mod_session_get(text);
drop function if exists climate_vote.mod_exchange_join_code(text,uuid,text);

drop function if exists climate_vote.submission_payload(uuid,text,bigint,timestamptz,timestamptz);
drop function if exists climate_vote.workshop_hq_session_row(text,text);
drop function if exists climate_vote.team_token_row(text);
drop function if exists climate_vote.workshop_request_finish(uuid,jsonb);
drop function if exists climate_vote.workshop_request_claim(uuid,text,text,uuid,uuid,uuid);
drop function if exists climate_vote.workshop_audit(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb);

drop trigger if exists platform_canvas_round_event_no_truncate
  on climate_vote.platform_canvas_round_event;
drop trigger if exists platform_canvas_round_event_append_only_guard
  on climate_vote.platform_canvas_round_event;
drop table if exists climate_vote.platform_canvas_round_event;

drop trigger if exists workshop_audit_no_truncate on climate_vote.workshop_audit_event;
drop trigger if exists workshop_audit_append_only_guard on climate_vote.workshop_audit_event;
drop function if exists climate_vote.workshop_audit_append_only_guard();
drop table if exists climate_vote.workshop_request_ledger;
drop table if exists climate_vote.workshop_audit_event;
drop table if exists climate_vote.workshop_join_exchange_attempt;
drop trigger if exists result_implementation_no_truncate
  on climate_vote.result_implementation_event;
drop trigger if exists result_implementation_no_update_delete
  on climate_vote.result_implementation_event;
drop function if exists climate_vote.result_implementation_append_only_guard();
drop table if exists climate_vote.result_implementation_event;
drop function if exists climate_vote.workshop_request_source_hash();
drop function if exists climate_vote.workshop_random_join_code();
drop function if exists climate_vote.workshop_random_join_code(text[]);

drop trigger if exists round_scope_binding_guard on climate_vote.rounds;
drop function if exists climate_vote.round_scope_binding_guard();
drop index if exists climate_vote.rounds_one_active_per_team_uidx;
drop index if exists climate_vote.rounds_session_scope_idx;
alter table climate_vote.rounds
  drop column if exists org_id,
  drop column if exists session_id;

drop index if exists climate_vote.attendance_auth_session_live_device_uidx;
drop index if exists climate_vote.attendance_auth_session_context_idx;
drop index if exists climate_vote.attendance_auth_session_id_uidx;
drop index if exists climate_vote.attendance_auth_attempt_source_idx;
alter table climate_vote.attendance_auth_attempt
  drop constraint if exists attendance_auth_attempt_source_hash_check,
  drop column if exists source_hash;

alter table climate_vote.submission
  drop constraint if exists submission_version_nonnegative,
  drop column if exists last_saved_by,
  drop column if exists version;
drop index if exists climate_vote.submission_category_event_source_idx;
drop index if exists climate_vote.submission_kind_event_source_idx;
alter table climate_vote.submission_category_event
  drop column if exists source_item_id;
alter table climate_vote.submission_kind_event
  drop column if exists source_item_id;
alter table climate_vote.attendance_auth_session
  drop column if exists last_seen_at,
  drop column if exists revoked_at,
  drop column if exists device_label,
  drop column if exists device_id,
  drop column if exists purpose,
  drop column if exists session_id,
  drop column if exists id;
alter table climate_vote.session drop column if exists access_expires_at;

-- P1a hardened the existing public ballot_submit shape. After removing the
-- P1a hard-window column, retain a rollback-compatible implementation that is
-- still tenant/lifecycle scoped and serialized against ballot close. Emergency
-- rollback intentionally loses the event-window check, not the core boundary.
create or replace function climate_vote.ballot_submit(
  p_token text, p_client_id text, p_answers jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_ballot climate_vote.ballot; v_item record; v_value_text text; v_val int;
begin
  if p_token is null or length(p_token)<>32 then
    raise exception 'ballot token required';
  end if;
  if p_client_id is null or length(trim(p_client_id)) not between 8 and 80 then
    raise exception 'ballot client id required';
  end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' then
    raise exception 'answers must be object';
  end if;

  select b.* into v_ballot
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
    join climate_vote.assembly a on a.id=s.assembly_id
      and a.org_id=s.org_id and a.status='active' and a.archived_at is null
    join climate_vote.org o on o.id=s.org_id
      and o.status='active' and o.archived_at is null
   where b.token=p_token and b.status='open' and b.archived_at is null
   for update of b;
  if not found then raise exception 'ballot not open or event unavailable'; end if;

  if exists(
    select 1 from jsonb_object_keys(p_answers) supplied(key)
    where not exists(select 1 from climate_vote.ballot_item bi
      where bi.ballot_id=v_ballot.id and bi.id::text=supplied.key)
  ) then
    raise exception 'answers contain unknown ballot item';
  end if;
  for v_item in
    select id,scale,required from climate_vote.ballot_item
     where ballot_id=v_ballot.id order by ordinal
  loop
    if not (p_answers ? v_item.id::text) then
      if v_item.required then raise exception 'missing answer for item %',v_item.id; end if;
      continue;
    end if;
    if jsonb_typeof(p_answers->(v_item.id::text))<>'number' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_value_text:=p_answers->>(v_item.id::text);
    if v_value_text!~'^[0-9]+$' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_val:=v_value_text::int;
    if v_val<1 or v_val>v_item.scale then
      raise exception 'answer out of scale for item %',v_item.id;
    end if;
  end loop;

  insert into climate_vote.ballot_response(ballot_id,client_id,answers,org_id)
  values(v_ballot.id,trim(p_client_id),p_answers,v_ballot.org_id);
  return jsonb_build_object('ok',true);
exception when unique_violation then
  raise exception 'already submitted';
end $fn$;

-- Restore legacy validation while retaining P1 org_id compatibility. This continues
-- to work even if P1b has already made attendance_auth_session.org_id NOT NULL.
create or replace function climate_vote.attendance_token_row(p_token text)
returns climate_vote.attendance_auth_session
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_row climate_vote.attendance_auth_session;
begin
  if p_token is null or length(p_token)<32 then raise exception 'attendance authorization required'; end if;
  select * into v_row from climate_vote.attendance_auth_session s
   where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now();
  if not found then raise exception 'attendance authorization expired'; end if;
  return v_row;
end $fn$;

create or replace function climate_vote.attendance_issue_token(
  p_scope text,p_team_id uuid,p_actor_label text)
returns text language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_token text; v_org uuid;
begin
  if p_scope='team' then
    select t.org_id into v_org from climate_vote.team t where t.id=p_team_id and t.status='active';
  elsif p_scope='hq' then
    select id into v_org from climate_vote.org where status='active' order by id limit 1;
  else raise exception 'invalid authorization scope';
  end if;
  if v_org is null then raise exception 'authorization org is not provisioned'; end if;
  v_token:=encode(gen_random_bytes(32),'hex');
  delete from climate_vote.attendance_auth_session where expires_at<=now();
  insert into climate_vote.attendance_auth_session
    (token_hash,scope,team_id,actor_label,expires_at,org_id)
  values(encode(digest(v_token,'sha256'),'hex'),p_scope,p_team_id,
    left(trim(p_actor_label),80),now()+interval '8 hours',v_org);
  return v_token;
end $fn$;

revoke execute on function climate_vote.attendance_token_row(text),
  climate_vote.attendance_issue_token(text,uuid,text) from public,anon,authenticated;

commit;
