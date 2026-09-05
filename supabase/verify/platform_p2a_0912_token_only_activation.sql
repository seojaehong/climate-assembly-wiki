-- Disposable semantic verification for platform_p2a_0912_token_only_activation.sql.
-- Canonical prerequisites: P1 -> reviewed 0912 seed/s20 -> P1a -> P2 ->
-- P1b/P1c -> P2a. P3/P4 run only after this activation verifies cleanly.

begin;

-- Supabase exposes the schema to PostgREST roles. The lightweight verification
-- prelude does not, so grant usage only inside this rollback-only transaction.
grant usage on schema climate_vote to anon, authenticated;

do $preexisting_hq_cutover$
begin
  if exists(select 1 from climate_vote.attendance_auth_session
      where scope='hq' and purpose='hq' and revoked_at is null) then
    raise exception 'pre-cutover shared or forged HQ bearer survived activation';
  end if;
end $preexisting_hq_cutover$;

do $acl$
declare v_name text; v_view text;
begin
  foreach v_name in array array[
    'climate_vote.mod_join(text)',
    'climate_vote.mod_create_round(text,text,text,jsonb)',
    'climate_vote.mod_set_round_status(text,text,text)',
    'climate_vote.mod_proxy_vote(text,text,jsonb,integer)',
    'climate_vote.mod_log_timer(text,text,integer,timestamp with time zone,timestamp with time zone)',
    'climate_vote.topic_list(text)',
    'climate_vote.topic_set_deadline(text,uuid,timestamp with time zone)',
    'climate_vote.readiness_check(uuid)',
    'climate_vote.org_of_code(text)',
    'climate_vote.org_of_token(text)',
    'climate_vote.attendance_hq_unlock(text,text)',
    'climate_vote.attendance_team_unlock(text,text)',
    'climate_vote.attendance_team_unlock_by_code(text)',
    'climate_vote.attendance_round_eligible_count(text)',
    'climate_vote.attendance_roster(text)',
    'climate_vote.attendance_hq_summary()',
    'climate_vote.attendance_set(text,uuid,text,timestamp with time zone)',
    'climate_vote.attendance_bulk_present(text,uuid[])',
    'climate_vote.attendance_finalize_absent(text)',
    'climate_vote.attendance_member_save(text,uuid,text,text,uuid,boolean)',
    'climate_vote.attendance_hq_audit(text,integer)',
    'climate_vote.attendance_hq_set_team_pin(text,uuid,text)',
    'climate_vote.attendance_hq_set_table_no(text,uuid,text)',
    'climate_vote.hq_teams()',
    'climate_vote.hq_submissions(text,text)',
    'climate_vote.submission_reopen(text,uuid,text)',
    'climate_vote.hq_submission_history(text,text)',
    'climate_vote.hq_submission_category_assign(text,uuid,integer,text)',
    'climate_vote.hq_submission_categories(text,text)',
    'climate_vote.hq_submission_kind_assign(text,uuid,integer,text)',
    'climate_vote.hq_submission_kinds(text,text)',
    'climate_vote.hq_topic_deadlines(text,text)',
    'climate_vote.hq_clear_submissions(text,text,text)',
    'climate_vote.submission_get(text,uuid)',
    'climate_vote.submission_save(text,uuid,jsonb)',
    'climate_vote.submission_save_v2(text,uuid,jsonb)',
    'climate_vote.submission_finalize(text,uuid)',
    'climate_vote.submission_finalize_hq(text,uuid,text)',
    'climate_vote.submission_reopen_by_team(text,uuid)',
    'climate_vote.ballot_create(text,text,text,jsonb,text)',
    'climate_vote.ballot_set_status(text,uuid,text)',
    'climate_vote.ballot_list(text)',
    'climate_vote.issue_items(text,uuid)',
    'climate_vote.issue_list(text,uuid)',
    'climate_vote.issue_upsert(text,uuid,jsonb)',
    'climate_vote.issue_link_set(text,uuid,uuid[],uuid)',
    'climate_vote.issue_merge(text,uuid,uuid)',
    'climate_vote.issue_review(text,uuid)',
    'climate_vote.result_publish(text,text,uuid,text)',
    'climate_vote.result_unpublish(text,uuid)',
    'climate_vote.mod_proxy_vote_v2(text,text,jsonb,integer)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'legacy execute survived activation: %',v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'climate_vote.platform_readiness_check_v2(uuid)',
    'climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid)',
    'climate_vote.platform_canvas_round_current_v2(uuid)',
    'climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)',
    'climate_vote.platform_ballot_list_v2(uuid)',
    'climate_vote.platform_ballot_results_v2(text,uuid)',
    'climate_vote.platform_issue_list_v2(uuid,uuid)',
    'climate_vote.platform_issue_items_v2(uuid,uuid)',
    'climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid)',
    'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)',
    'climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid)',
    'climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid)',
    'climate_vote.platform_result_publish_v2(uuid,text,uuid,text)',
    'climate_vote.platform_result_unpublish_v2(uuid,uuid)',
    'climate_vote.platform_result_implementation_upsert_v3(uuid,text,uuid,jsonb,text,uuid)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'staff ballot privilege mismatch: %',v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'climate_vote.ballot_get(text)',
    'climate_vote.ballot_submit(text,text,jsonb)',
    'climate_vote.ballot_results(text,text)',
    'climate_vote.result_get(text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'public ballot/result capability privilege mismatch: %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.mod_exchange_join_code(text,uuid,text)',
    'climate_vote.mod_session_get(text)',
    'climate_vote.topic_list_v2(text)',
    'climate_vote.attendance_round_eligible_count_v2(text,text)',
    'climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean)',
    'climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid)',
    'climate_vote.mod_set_round_status_v3(text,text,text,text,uuid)',
    'climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid)',
    'climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid)',
    'climate_vote.ballot_set_status_v2(text,uuid,text)',
    'climate_vote.workshop_hq_status(text,text)',
    'climate_vote.workshop_hq_open_next_topic(text,text,int,uuid)',
    'climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid)',
    'climate_vote.workshop_hq_devices(text,text)',
    'climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid)',
    'climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamptz,timestamptz,uuid)',
    'climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid)',
    'climate_vote.workshop_team_logout_v2(text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'safe token RPC activation privilege mismatch: %',v_name;
    end if;
  end loop;
  if to_regprocedure('climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,uuid)') is not null
     or to_regprocedure('climate_vote.workshop_hq_revoke_device(text,text,text,text)') is not null then
    raise exception 'unsafe HQ mutation overload survived activation';
  end if;
  foreach v_name in array array[
    'climate_vote.attendance_hq_unlock_named(text,text)',
    'climate_vote.hq_change_password(text,text,text)',
    'climate_vote.workshop_hq_logout_v2(text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'named HQ bootstrap privilege mismatch: %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.attendance_roster_v2(text,text)',
    'climate_vote.attendance_hq_summary_v2(text,text)',
    'climate_vote.attendance_set_v2(text,text,uuid,text,timestamp with time zone)',
    'climate_vote.attendance_bulk_present_v2(text,text,uuid[])',
    'climate_vote.attendance_finalize_absent_v2(text,text)',
    'climate_vote.attendance_member_save_v2(text,text,uuid,text,text,uuid,boolean)',
    'climate_vote.attendance_hq_audit_v2(text,text,integer)',
    'climate_vote.attendance_hq_set_team_pin_v2(text,text,uuid,text)',
    'climate_vote.attendance_hq_set_table_no_v2(text,text,uuid,text)',
    'climate_vote.hq_teams_v2(text,text)',
    'climate_vote.hq_rounds_v2(text,text)',
    'climate_vote.hq_vote_counts_v2(text,text,text[])',
    'climate_vote.hq_votes_v2(text,text,text[])',
    'climate_vote.mod_rounds_v2(text)',
    'climate_vote.mod_session_teams_v2(text)',
    'climate_vote.mod_vote_counts_v2(text,text[])',
    'climate_vote.mod_votes_v2(text,text)',
    'climate_vote.public_round_get_v2(text)',
    'climate_vote.public_round_votes_v2(text)',
    'climate_vote.public_round_cast_v2(text,jsonb,text)',
    'climate_vote.hq_submissions_v3(text,text)',
    'climate_vote.submission_reopen_v2(text,text,uuid,text)',
    'climate_vote.hq_submission_history_v2(text,text)',
    'climate_vote.hq_submission_category_assign_v3(text,text,uuid,integer,text,timestamptz,bigint,uuid)',
    'climate_vote.hq_submission_categories_v3(text,text)',
    'climate_vote.hq_submission_kind_assign_v3(text,text,uuid,integer,text,timestamptz,bigint,uuid)',
    'climate_vote.hq_submission_kinds_v3(text,text)',
    'climate_vote.hq_topic_deadlines_v2(text,text)',
    'climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'scoped attendance/HQ RPC activation privilege mismatch: %',v_name;
    end if;
  end loop;
  if has_table_privilege('public','climate_vote.rounds','select')
     or has_table_privilege('anon','climate_vote.rounds','select')
     or has_table_privilege('authenticated','climate_vote.rounds','select')
     or has_table_privilege('public','climate_vote.votes','select')
     or has_table_privilege('anon','climate_vote.votes','select')
     or has_table_privilege('authenticated','climate_vote.votes','select')
     or has_table_privilege('public','climate_vote.votes','insert')
     or has_table_privilege('anon','climate_vote.votes','insert')
     or has_table_privilege('authenticated','climate_vote.votes','insert') then
    raise exception 'broad rounds/votes table access survived activation';
  end if;
  if has_table_privilege('public','climate_vote.hq_operator','select')
     or has_table_privilege('anon','climate_vote.hq_operator','select')
     or has_table_privilege('authenticated','climate_vote.hq_operator','select')
     or has_column_privilege('public','climate_vote.hq_operator','must_change_password','select')
     or has_column_privilege('anon','climate_vote.hq_operator','must_change_password','select')
     or has_column_privilege('authenticated','climate_vote.hq_operator','must_change_password','select') then
    raise exception 'HQ operator credential state remained browser-readable';
  end if;
  if has_table_privilege('public','climate_vote.platform_canvas_round_event','select')
     or has_table_privilege('anon','climate_vote.platform_canvas_round_event','select')
     or has_table_privilege('authenticated','climate_vote.platform_canvas_round_event','select') then
    raise exception 'private Canvas round audit table leaked';
  end if;
  foreach v_view in array array[
    'public.cv_votes','public.cv_rounds','public.cv_tally','public.cv_tally_scale'
  ] loop
    if to_regclass(v_view) is not null and (
       has_table_privilege('public',v_view,'select')
       or has_table_privilege('anon',v_view,'select')
       or has_table_privilege('authenticated',v_view,'select')
       or has_table_privilege('public',v_view,'insert')
       or has_table_privilege('anon',v_view,'insert')
       or has_table_privilege('authenticated',v_view,'insert')) then
      raise exception 'legacy owner-rights vote view survived activation: %',v_view;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.mod_create_round_v2(text,text,text,jsonb)',
    'climate_vote.mod_set_round_status_v2(text,text,text)',
    'climate_vote.ballot_create_v2(text,text,text,jsonb,text)',
    'climate_vote.mod_proxy_vote_v2(text,text,jsonb,int)',
    'climate_vote.hq_submission_category_assign_v2(text,text,uuid,int,text)',
    'climate_vote.hq_submission_kind_assign_v2(text,text,uuid,int,text)',
    'climate_vote.hq_clear_submissions_v2(text,text,text)',
    'climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb)',
    'climate_vote.platform_issue_merge_v2(uuid,uuid,uuid)',
    'climate_vote.platform_issue_review_v2(uuid,uuid)',
    'climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'non-idempotent v2 RPC was exposed: %',v_name;
    end if;
  end loop;
  if to_regprocedure('climate_vote.result_implementation_upsert(text,text,uuid,jsonb)') is not null
     and (has_function_privilege('public','climate_vote.result_implementation_upsert(text,text,uuid,jsonb)','execute')
       or has_function_privilege('anon','climate_vote.result_implementation_upsert(text,text,uuid,jsonb)','execute')
       or has_function_privilege('authenticated','climate_vote.result_implementation_upsert(text,text,uuid,jsonb)','execute')) then
    raise exception 'legacy result implementation write survived activation';
  end if;
  foreach v_name in array array[
    'climate_vote.votes_require_active_round()',
    'climate_vote.capture_round_attendance()',
    'climate_vote.submission_item_archive_trigger()',
    'climate_vote.platform_issue_snapshot_hash(uuid)',
    'climate_vote.platform_result_implementation_snapshot_hash(jsonb)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'internal trigger helper remained directly executable: %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.cv_snapshot_now(text,text)',
    'climate_vote.cv_archive_round(text,text,text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute')
       or not has_function_privilege('service_role',v_name,'execute') then
      raise exception 'operational RPC was not normalized to service_role only: %',v_name;
    end if;
  end loop;
  if to_regprocedure('public.cv_set_active(text)') is not null
     and (has_function_privilege('public','public.cv_set_active(text)','execute')
       or has_function_privilege('anon','public.cv_set_active(text)','execute')
       or has_function_privilege('authenticated','public.cv_set_active(text)','execute')) then
    raise exception 'retired public round activation RPC survived cutover';
  end if;
end $acl$;

-- Fail closed over the complete PostgREST routine surface, not only a list of
-- legacy names we happened to remember. Every executable climate_vote
-- signature must be an approved public capability, token-scoped operation, or
-- authenticated selected-organization staff operation. PUBLIC itself owns no
-- EXECUTE grant.
do $executable_allowlist$
declare
  v_anon_allowed text[]:=array[
    'climate_vote.attendance_hq_unlock_named(text,text)',
    'climate_vote.hq_change_password(text,text,text)',
    'climate_vote.workshop_hq_logout_v2(text)',
    'climate_vote.ballot_get(text)',
    'climate_vote.ballot_submit(text,text,jsonb)',
    'climate_vote.ballot_results(text,text)',
    'climate_vote.result_get(text)',
    'climate_vote.mod_exchange_join_code(text,uuid,text)',
    'climate_vote.mod_session_get(text)',
    'climate_vote.topic_list_v2(text)',
    'climate_vote.attendance_round_eligible_count_v2(text,text)',
    'climate_vote.submission_get_v2(text,uuid)',
    'climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean)',
    'climate_vote.submission_finalize_v2(text,uuid,bigint)',
    'climate_vote.submission_reopen_by_team_v2(text,uuid)',
    'climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid)',
    'climate_vote.workshop_team_logout_v2(text)',
    'climate_vote.mod_set_round_status_v3(text,text,text,text,uuid)',
    'climate_vote.mod_proxy_vote_v3(text,text,jsonb,integer,uuid)',
    'climate_vote.mod_log_timer_v2(text,text,integer,timestamp with time zone,timestamp with time zone)',
    'climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid)',
    'climate_vote.ballot_set_status_v2(text,uuid,text)',
    'climate_vote.ballot_list_v2(text)',
    'climate_vote.ballot_results_v2(text,text)',
    'climate_vote.workshop_hq_status(text,text)',
    'climate_vote.workshop_hq_open_next_topic(text,text,integer,uuid)',
    'climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid)',
    'climate_vote.workshop_hq_devices(text,text)',
    'climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid)',
    'climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamp with time zone,timestamp with time zone,uuid)',
    'climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid)',
    'climate_vote.attendance_roster_v2(text,text)',
    'climate_vote.attendance_hq_summary_v2(text,text)',
    'climate_vote.attendance_set_v2(text,text,uuid,text,timestamp with time zone)',
    'climate_vote.attendance_bulk_present_v2(text,text,uuid[])',
    'climate_vote.attendance_finalize_absent_v2(text,text)',
    'climate_vote.attendance_member_save_v2(text,text,uuid,text,text,uuid,boolean)',
    'climate_vote.attendance_hq_audit_v2(text,text,integer)',
    'climate_vote.attendance_hq_set_team_pin_v2(text,text,uuid,text)',
    'climate_vote.attendance_hq_set_table_no_v2(text,text,uuid,text)',
    'climate_vote.hq_teams_v2(text,text)',
    'climate_vote.hq_rounds_v2(text,text)',
    'climate_vote.hq_vote_counts_v2(text,text,text[])',
    'climate_vote.hq_votes_v2(text,text,text[])',
    'climate_vote.mod_rounds_v2(text)',
    'climate_vote.mod_session_teams_v2(text)',
    'climate_vote.mod_vote_counts_v2(text,text[])',
    'climate_vote.mod_votes_v2(text,text)',
    'climate_vote.public_round_get_v2(text)',
    'climate_vote.public_round_votes_v2(text)',
    'climate_vote.public_round_cast_v2(text,jsonb,text)',
    'climate_vote.hq_submissions_v3(text,text)',
    'climate_vote.submission_reopen_v2(text,text,uuid,text)',
    'climate_vote.hq_submission_history_v2(text,text)',
    'climate_vote.hq_submission_category_assign_v3(text,text,uuid,integer,text,timestamp with time zone,bigint,uuid)',
    'climate_vote.hq_submission_categories_v3(text,text)',
    'climate_vote.hq_submission_kind_assign_v3(text,text,uuid,integer,text,timestamp with time zone,bigint,uuid)',
    'climate_vote.hq_submission_kinds_v3(text,text)',
    'climate_vote.hq_topic_deadlines_v2(text,text)',
    'climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid)'
  ];
  v_authenticated_allowed text[]:=v_anon_allowed||array[
    'climate_vote.org_of_uid()',
    'climate_vote.my_orgs()',
    'climate_vote.org_select(uuid)',
    'climate_vote.platform_readiness_check_v2(uuid)',
    'climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid)',
    'climate_vote.platform_canvas_round_current_v2(uuid)',
    'climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)',
    'climate_vote.platform_ballot_list_v2(uuid)',
    'climate_vote.platform_ballot_results_v2(text,uuid)',
    'climate_vote.platform_issue_list_v2(uuid,uuid)',
    'climate_vote.platform_issue_items_v2(uuid,uuid)',
    'climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid)',
    'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)',
    'climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid)',
    'climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid)',
    'climate_vote.platform_result_publish_v2(uuid,text,uuid,text)',
    'climate_vote.platform_result_unpublish_v2(uuid,uuid)',
    'climate_vote.platform_result_implementation_upsert_v3(uuid,text,uuid,jsonb,text,uuid)',
    'climate_vote.platform_audit_list(bigint,integer)'
  ];
  v_unexpected text[];
begin
  select array_agg(signature order by signature) into v_unexpected
  from (
    select p.oid,
      format('%I.%I(%s)',n.nspname,p.proname,coalesce((
        select string_agg(format_type(arg_type,null),',' order by ordinal)
        from unnest(p.proargtypes::oid[]) with ordinality args(arg_type,ordinal)
      ),'')) signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='climate_vote' and p.prokind in ('f','p')
  ) routines
  where has_function_privilege('public',oid,'execute');
  if v_unexpected is not null then
    raise exception 'PUBLIC executable routine(s) survived activation: %',v_unexpected;
  end if;

  select array_agg(signature order by signature) into v_unexpected
  from (
    select p.oid,
      format('%I.%I(%s)',n.nspname,p.proname,coalesce((
        select string_agg(format_type(arg_type,null),',' order by ordinal)
        from unnest(p.proargtypes::oid[]) with ordinality args(arg_type,ordinal)
      ),'')) signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='climate_vote' and p.prokind in ('f','p')
  ) routines
  where has_function_privilege('anon',oid,'execute')
    and not (signature=any(v_anon_allowed));
  if v_unexpected is not null then
    raise exception 'anon routine outside post-cutover allowlist: %',v_unexpected;
  end if;

  select array_agg(signature order by signature) into v_unexpected
  from (
    select p.oid,
      format('%I.%I(%s)',n.nspname,p.proname,coalesce((
        select string_agg(format_type(arg_type,null),',' order by ordinal)
        from unnest(p.proargtypes::oid[]) with ordinality args(arg_type,ordinal)
      ),'')) signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='climate_vote' and p.prokind in ('f','p')
  ) routines
  where has_function_privilege('authenticated',oid,'execute')
    and not (signature=any(v_authenticated_allowed));
  if v_unexpected is not null then
    raise exception 'authenticated routine outside post-cutover allowlist: %',v_unexpected;
  end if;
end $executable_allowlist$;

-- The positive half of the atomic cutover: after P2a, a newly rotated code can
-- bootstrap a token while the legacy durable-code functions above are denied.
update climate_vote.session set access_expires_at=now()+interval '36 hours'
 where id='91200000-0000-0000-0000-000000000003';
update climate_vote.team set join_code='731245'
 where id='91200000-0000-0000-0000-000000000011';

-- Two organizations and a multi-membership user prove that session_id is not
-- accepted as an organization selector. The P1c request context remains the
-- selected organization authority.
insert into climate_vote.session
  (id,slug,title,config,status,assembly_id,ordinal,held_on,org_id)
values
 ('91200000-0000-0000-0000-000000000151','p2a-same-org-other',
  'P2a same-org other session','{}'::jsonb,'active',
  '91200000-0000-0000-0000-000000000002',2,'2026-09-13',
  '91200000-0000-0000-0000-000000000001');
insert into climate_vote.team
  (id,session_id,name,subgroup,join_code,capacity,status,table_no,org_id)
values
 ('91200000-0000-0000-0000-000000000152',
  '91200000-0000-0000-0000-000000000151','P2a same-org other team','other',
  '741235',8,'active','S-01','91200000-0000-0000-0000-000000000001');
insert into climate_vote.rounds(id,title,type,options,status,team_id,created_by)
values
 ('p2a-same-org-round-capability-01','P2a same-org isolated round','RADIO',
  '["yes","no"]'::jsonb,'active','91200000-0000-0000-0000-000000000152','verify');

insert into climate_vote.org(id,slug,name,status) values
 ('91200000-0000-0000-0000-000000000101','p2a-other-org','P2a other org','active');
insert into climate_vote.assembly
  (id,slug,title,purpose,mode,config,status,org_id)
values
 ('91200000-0000-0000-0000-000000000102','p2a-other-assembly','P2a other assembly',
  'Cross-organization verification','consensus','{}'::jsonb,'active',
  '91200000-0000-0000-0000-000000000101');
insert into climate_vote.session
  (id,slug,title,config,status,assembly_id,ordinal,held_on,org_id)
values
 ('91200000-0000-0000-0000-000000000103','p2a-other-session','P2a other session',
  '{}'::jsonb,'active','91200000-0000-0000-0000-000000000102',1,'2026-09-12',
  '91200000-0000-0000-0000-000000000101');
insert into climate_vote.discussion_topic
  (id,session_id,ordinal,block,prompt,guidance,status,org_id)
values
 ('91200000-0000-0000-0000-000000000104','91200000-0000-0000-0000-000000000103',
  1,'am','P2a other organization topic','Cross-organization negative fixture',
 'open','91200000-0000-0000-0000-000000000101');
insert into climate_vote.team
  (id,session_id,name,subgroup,join_code,capacity,status,table_no,org_id)
values('91200000-0000-0000-0000-000000000105',
  '91200000-0000-0000-0000-000000000103','P2a other org team','other','741236',8,
  'active','X-01','91200000-0000-0000-0000-000000000101');
insert into climate_vote.submission(id,topic_id,team_id,status,org_id,version)
values('91200000-0000-0000-0000-000000000106',
  '91200000-0000-0000-0000-000000000104',
  '91200000-0000-0000-0000-000000000105','draft',
  '91200000-0000-0000-0000-000000000101',0);
insert into climate_vote.submission_item
  (id,submission_id,ordinal,kind,content,rationale,provenance)
values('91200000-0000-0000-0000-000000000107',
  '91200000-0000-0000-0000-000000000106',1,'core',
  'P2a foreign source item','Cross-organization negative fixture','{}'::jsonb);
insert into climate_vote.issue
  (id,topic_id,label,stance,frequency_class,summary,origin,review_status,org_id)
values('91200000-0000-0000-0000-000000000108',
  '91200000-0000-0000-0000-000000000104','P2a foreign issue','neutral','mixed',
  'Cross-organization negative fixture','human','draft',
  '91200000-0000-0000-0000-000000000101');
insert into climate_vote.rounds(id,title,type,options,status,team_id,created_by)
values('p2a-foreign-round-capability-0001','P2a foreign isolated round','RADIO',
  '["yes","no"]'::jsonb,'active','91200000-0000-0000-0000-000000000105','verify');

insert into climate_vote.assembly_member(id,official_id,name,active,source_hash,org_id)
values
 ('91200000-0000-0000-0000-000000000341','P2A-SHARED-OFFICIAL-ID',
  'P2a attendance member',true,'verify',
  '91200000-0000-0000-0000-000000000001'),
 ('91200000-0000-0000-0000-000000000343','P2A-SHARED-OFFICIAL-ID',
  'P2a other-org member',true,'verify',
  '91200000-0000-0000-0000-000000000101');
do $org_scoped_official_id$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid='climate_vote.assembly_member'::regclass
       and conname='assembly_member_official_id_key'
  ) or not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid=i.indexrelid
      join pg_namespace n on n.oid=c.relnamespace
      join pg_am am on am.oid=c.relam
     where n.nspname='climate_vote'
       and c.relname='assembly_member_org_official_id_uniq'
       and i.indrelid='climate_vote.assembly_member'::regclass
       and i.indisunique and i.indisvalid and i.indisready
       and am.amname='btree' and i.indnkeyatts=2 and i.indnatts=2
       and pg_get_indexdef(i.indexrelid,1,true)='org_id'
       and pg_get_indexdef(i.indexrelid,2,true)='official_id'
       and regexp_replace(
         lower(pg_get_expr(i.indpred,i.indrelid,false)),
         '[[:space:]]+',' ','g')='(org_id is not null)'
  ) then
    raise exception 'P1b official id cutover did not replace the global guard';
  end if;
  if (select count(*) from climate_vote.assembly_member
       where official_id='P2A-SHARED-OFFICIAL-ID'
         and org_id in ('91200000-0000-0000-0000-000000000001',
                        '91200000-0000-0000-0000-000000000101'))<>2 then
    raise exception 'P2a organization-scoped official id did not allow two organizations';
  end if;
  begin
    insert into climate_vote.assembly_member(id,official_id,name,active,source_hash,org_id)
    values('91200000-0000-0000-0000-000000000345','P2A-SHARED-OFFICIAL-ID',
      'P2a same-org duplicate must fail',true,'verify',
      '91200000-0000-0000-0000-000000000001');
    raise exception 'P2a same-org duplicate official id unexpectedly accepted';
  exception when unique_violation then
    null;
  end;
end $org_scoped_official_id$;
insert into climate_vote.team_assignment(id,session_id,team_id,member_id,active,org_id)
values
 ('91200000-0000-0000-0000-000000000342',
  '91200000-0000-0000-0000-000000000003',
  '91200000-0000-0000-0000-000000000011',
  '91200000-0000-0000-0000-000000000341',true,
  '91200000-0000-0000-0000-000000000001'),
 ('91200000-0000-0000-0000-000000000344',
  '91200000-0000-0000-0000-000000000151',
  '91200000-0000-0000-0000-000000000152',
  '91200000-0000-0000-0000-000000000341',true,
  '91200000-0000-0000-0000-000000000001');
insert into climate_vote.attendance(assignment_id,base_status,org_id)
values('91200000-0000-0000-0000-000000000342','unconfirmed',
  '91200000-0000-0000-0000-000000000001');
insert into climate_vote.hq_operator(name,default_subgroup,active,must_change_password)
values('P2a scoped HQ verifier','synthetic',true,false)
on conflict(name) do update set active=true;

do $scoped_hq_negative$
declare
  v_hq text; v_before text; v_audit_before bigint;
  v_member_before jsonb; v_current_assignment_before jsonb;
  v_shared_assignment_before jsonb;
begin
  v_hq:=climate_vote.attendance_issue_token('hq',null,'P2a scoped HQ verifier');
  select to_jsonb(m) into v_member_before from climate_vote.assembly_member m
   where m.id='91200000-0000-0000-0000-000000000341';
  select to_jsonb(ta) into v_current_assignment_before
    from climate_vote.team_assignment ta
   where ta.id='91200000-0000-0000-0000-000000000342';
  select to_jsonb(ta) into v_shared_assignment_before
    from climate_vote.team_assignment ta
   where ta.id='91200000-0000-0000-0000-000000000344';
  v_audit_before:=(select count(*) from climate_vote.attendance_audit_log);
  begin
    perform climate_vote.attendance_member_save_v2(v_hq,'0912-deliberation',
      '91200000-0000-0000-0000-000000000342','P2A-MUTATED',
      'P2a mutated shared member','91200000-0000-0000-0000-000000000011',false);
    raise exception 'P2a shared member mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a shared member mutation unexpectedly accepted' then raise; end if;
    if position('shared member fields cannot be changed outside current session scope' in sqlerrm)=0 then raise; end if;
  end;
  if (select to_jsonb(m) from climate_vote.assembly_member m
       where m.id='91200000-0000-0000-0000-000000000341') is distinct from v_member_before
     or (select to_jsonb(ta) from climate_vote.team_assignment ta
          where ta.id='91200000-0000-0000-0000-000000000342')
          is distinct from v_current_assignment_before
     or (select to_jsonb(ta) from climate_vote.team_assignment ta
          where ta.id='91200000-0000-0000-0000-000000000344')
          is distinct from v_shared_assignment_before
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit_before then
    raise exception 'P2a rejected shared member mutation changed either session or audit state';
  end if;
  delete from climate_vote.team_assignment
   where id='91200000-0000-0000-0000-000000000344';
  begin
    perform * from climate_vote.hq_rounds_v2(v_hq,'p2a-same-org-other');
    raise exception 'P2a cross-session HQ read unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a cross-session HQ read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_vote_counts_v2(v_hq,'0912-deliberation',
      array['p2a-same-org-round-capability-01']);
    raise exception 'P2a cross-session HQ round target unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a cross-session HQ round target unexpectedly accepted' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_submissions_v3(v_hq,'p2a-other-session');
    raise exception 'P2a cross-org HQ read unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a cross-org HQ read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_votes_v2(v_hq,'0912-deliberation',
      array['p2a-foreign-round-capability-0001']);
    raise exception 'P2a cross-org HQ round target unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a cross-org HQ round target unexpectedly accepted' then raise; end if;
  end;
  select table_no into v_before from climate_vote.team
   where id='91200000-0000-0000-0000-000000000105';
  begin
    perform climate_vote.attendance_hq_set_table_no_v2(v_hq,'0912-deliberation',
      '91200000-0000-0000-0000-000000000105','COMPROMISED');
    raise exception 'P2a cross-org HQ mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a cross-org HQ mutation unexpectedly accepted' then raise; end if;
  end;
  if (select table_no from climate_vote.team
      where id='91200000-0000-0000-0000-000000000105') is distinct from v_before then
    raise exception 'P2a rejected cross-org target was changed';
  end if;
  begin
    perform climate_vote.hq_submission_kind_assign_v3(v_hq,'0912-deliberation',
      '91200000-0000-0000-0000-000000000106',1,'Claim',clock_timestamp(),null,
      gen_random_uuid());
    raise exception 'P2a cross-org submission mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='P2a cross-org submission mutation unexpectedly accepted' then raise; end if;
  end;
end $scoped_hq_negative$;

insert into auth.users(id,email,email_confirmed_at,confirmed_at)
values('91200000-0000-0000-0000-000000000201','p2a-staff@example.invalid',now(),now());
insert into climate_vote.membership(id,org_id,user_id,role,status) values
 ('91200000-0000-0000-0000-000000000211','91200000-0000-0000-0000-000000000001',
  '91200000-0000-0000-0000-000000000201','org_admin','active'),
 ('91200000-0000-0000-0000-000000000212','91200000-0000-0000-0000-000000000101',
  '91200000-0000-0000-0000-000000000201','operator','active');

insert into climate_vote.ballot
  (id,session_id,title,status,token,created_by,published_at,org_id,subgroup)
values
 ('91200000-0000-0000-0000-000000000301','91200000-0000-0000-0000-000000000003',
  'P2a published','published','p2a-published-ballot-token-0001','verify',now(),
  '91200000-0000-0000-0000-000000000001',null),
 ('91200000-0000-0000-0000-000000000302','91200000-0000-0000-0000-000000000003',
  'P2a draft','draft','p2a-draft-ballot-token-00000002','verify',null,
  '91200000-0000-0000-0000-000000000001',null),
 ('91200000-0000-0000-0000-000000000304','91200000-0000-0000-0000-000000000003',
  'P2a open participation ballot','open','p2a-open-ballot-capability-00001','verify',null,
  '91200000-0000-0000-0000-000000000001',null),
 ('91200000-0000-0000-0000-000000000303','91200000-0000-0000-0000-000000000103',
  'P2a other org draft','draft','p2a-other-ballot-token-00000003','verify',null,
  '91200000-0000-0000-0000-000000000101',null);
insert into climate_vote.ballot_item(id,ballot_id,ordinal,statement,scale,required)
values
 ('91200000-0000-0000-0000-000000000311','91200000-0000-0000-0000-000000000301',
  1,'Published verification statement',5,true),
 ('91200000-0000-0000-0000-000000000312','91200000-0000-0000-0000-000000000302',
  1,'Draft verification statement',5,true),
 ('91200000-0000-0000-0000-000000000314','91200000-0000-0000-0000-000000000304',
  1,'Open participation verification statement',5,true),
 ('91200000-0000-0000-0000-000000000313','91200000-0000-0000-0000-000000000303',
  1,'Other organization statement',5,true);
insert into climate_vote.ballot_response(ballot_id,client_id,answers,org_id)
values('91200000-0000-0000-0000-000000000301','p2a-client-0001',
  jsonb_build_object('91200000-0000-0000-0000-000000000311',5),
  '91200000-0000-0000-0000-000000000001');

insert into climate_vote.submission
  (id,topic_id,team_id,status,org_id,version)
values('91200000-0000-0000-0000-000000000321',
  '91200000-0000-0000-0000-000000000021',
  '91200000-0000-0000-0000-000000000011','draft',
  '91200000-0000-0000-0000-000000000001',0);
insert into climate_vote.submission_item
  (id,submission_id,ordinal,kind,content,rationale,provenance)
values
 ('91200000-0000-0000-0000-000000000322',
  '91200000-0000-0000-0000-000000000321',1,'core',
  'P2a staff issue source item','Synthetic verification rationale','{}'::jsonb),
 ('91200000-0000-0000-0000-000000000323',
  '91200000-0000-0000-0000-000000000321',2,'extra',
  'P2a atomic reclassification item','Synthetic atomic rationale','{}'::jsonb);

-- Public round-id capabilities remain usable without broad table privileges.
-- A closed round exposes aggregate counts only; an active round accepts only
-- configured choices and enforces one live ballot per client id atomically.
insert into climate_vote.rounds(id,title,type,options,status,team_id,created_by)
values('p2a-public-closed-capability-0001','P2a public closed round','RADIO',
  '["yes","no"]'::jsonb,'active','91200000-0000-0000-0000-000000000011','verify');
insert into climate_vote.votes(round_id,choice,voter_role,client_id,org_id)
values('p2a-public-closed-capability-0001','"yes"'::jsonb,'citizen',
  'p2a-closed-existing-client','91200000-0000-0000-0000-000000000001');
update climate_vote.rounds set status='closed'
 where id='p2a-public-closed-capability-0001';
insert into climate_vote.rounds(id,title,type,options,status,team_id,created_by)
values('p2a-public-active-capability-0001','P2a public active round','RADIO',
  '["yes","no"]'::jsonb,'active','91200000-0000-0000-0000-000000000011','verify');

do $lifecycle_guards$
declare
  v_team_token text; v_attendance jsonb; v_status text;
  v_attendance_audit bigint; v_votes bigint; v_ballot_responses bigint;
begin
  v_team_token:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011','P2a lifecycle verifier');
  update climate_vote.attendance_auth_session set purpose='workshop',device_id=gen_random_uuid()
   where token_hash=encode(extensions.digest(v_team_token,'sha256'),'hex');
  select to_jsonb(a) into v_attendance from climate_vote.attendance a
   where assignment_id='91200000-0000-0000-0000-000000000342';
  v_attendance_audit:=(select count(*) from climate_vote.attendance_audit_log);
  foreach v_status in array array['draft','closed','archived'] loop
    update climate_vote.session set status=v_status where slug='0912-deliberation';
    begin
      perform * from climate_vote.attendance_roster_v2(v_team_token,'0912-deliberation');
      raise exception 'P2a inactive session attendance read accepted: %',v_status;
    exception when others then
      if sqlerrm like 'P2a inactive session attendance read accepted:%' then raise; end if;
    end;
    begin
      perform climate_vote.attendance_set_v2(v_team_token,'0912-deliberation',
        '91200000-0000-0000-0000-000000000342','present',now());
      raise exception 'P2a inactive session attendance mutation accepted: %',v_status;
    exception when others then
      if sqlerrm like 'P2a inactive session attendance mutation accepted:%' then raise; end if;
    end;
  end loop;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.session set access_expires_at=null where slug='0912-deliberation';
  begin
    perform * from climate_vote.attendance_roster_v2(v_team_token,'0912-deliberation');
    raise exception 'P2a NULL-expiry attendance read accepted';
  exception when others then
    if sqlerrm='P2a NULL-expiry attendance read accepted' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_set_v2(v_team_token,'0912-deliberation',
      '91200000-0000-0000-0000-000000000342','present',now());
    raise exception 'P2a NULL-expiry attendance mutation accepted';
  exception when others then
    if sqlerrm='P2a NULL-expiry attendance mutation accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()+interval '36 hours'
   where slug='0912-deliberation';
  if (select to_jsonb(a) from climate_vote.attendance a
       where assignment_id='91200000-0000-0000-0000-000000000342') is distinct from v_attendance
     or (select count(*) from climate_vote.attendance_audit_log)<>v_attendance_audit then
    raise exception 'P2a rejected attendance lifecycle access changed state';
  end if;

  v_votes:=(select count(*) from climate_vote.votes
    where round_id='p2a-public-active-capability-0001');
  v_ballot_responses:=(select count(*) from climate_vote.ballot_response
    where ballot_id='91200000-0000-0000-0000-000000000304');
  foreach v_status in array array['draft','closed','archived'] loop
    update climate_vote.session set status=v_status where slug='0912-deliberation';
    begin
      perform climate_vote.public_round_cast_v2(
        'p2a-public-active-capability-0001','"yes"','p2a-lifecycle-'||v_status);
      raise exception 'P2a inactive session public cast accepted: %',v_status;
    exception when others then
      if sqlerrm like 'P2a inactive session public cast accepted:%' then raise; end if;
    end;
    begin
      perform climate_vote.ballot_submit(
        'p2a-open-ballot-capability-00001','p2a-ballot-session-'||v_status,
        jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
      raise exception 'P2a inactive session ballot submit accepted: %',v_status;
    exception when others then
      if sqlerrm like 'P2a inactive session ballot submit accepted:%' then raise; end if;
    end;
  end loop;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.org set status='suspended'
   where id='91200000-0000-0000-0000-000000000001';
  begin
    perform climate_vote.public_round_cast_v2(
      'p2a-public-active-capability-0001','"yes"','p2a-inactive-org');
    raise exception 'P2a inactive organization public cast accepted';
  exception when others then
    if sqlerrm='P2a inactive organization public cast accepted' then raise; end if;
  end;
  begin
    perform climate_vote.ballot_submit(
      'p2a-open-ballot-capability-00001','p2a-ballot-org-suspended',
      jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
    raise exception 'P2a inactive organization ballot submit accepted';
  exception when others then
    if sqlerrm='P2a inactive organization ballot submit accepted' then raise; end if;
  end;
  update climate_vote.org set status='active'
   where id='91200000-0000-0000-0000-000000000001';
  update climate_vote.assembly set status='closed'
   where id='91200000-0000-0000-0000-000000000002';
  begin
    perform climate_vote.public_round_cast_v2(
      'p2a-public-active-capability-0001','"yes"','p2a-inactive-assembly');
    raise exception 'P2a inactive assembly public cast accepted';
  exception when others then
    if sqlerrm='P2a inactive assembly public cast accepted' then raise; end if;
  end;
  begin
    perform climate_vote.ballot_submit(
      'p2a-open-ballot-capability-00001','p2a-ballot-assembly-closed',
      jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
    raise exception 'P2a inactive assembly ballot submit accepted';
  exception when others then
    if sqlerrm='P2a inactive assembly ballot submit accepted' then raise; end if;
  end;
  update climate_vote.assembly set status='active',archived_at=now()
   where id='91200000-0000-0000-0000-000000000002';
  begin
    perform climate_vote.public_round_cast_v2(
      'p2a-public-active-capability-0001','"yes"','p2a-archived-assembly');
    raise exception 'P2a archived assembly public cast accepted';
  exception when others then
    if sqlerrm='P2a archived assembly public cast accepted' then raise; end if;
  end;
  begin
    perform climate_vote.ballot_submit(
      'p2a-open-ballot-capability-00001','p2a-ballot-assembly-archive',
      jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
    raise exception 'P2a archived assembly ballot submit accepted';
  exception when others then
    if sqlerrm='P2a archived assembly ballot submit accepted' then raise; end if;
  end;
  update climate_vote.assembly set archived_at=null
   where id='91200000-0000-0000-0000-000000000002';
  update climate_vote.session set access_expires_at=null where slug='0912-deliberation';
  begin
    perform climate_vote.public_round_cast_v2(
      'p2a-public-active-capability-0001','"yes"','p2a-NULL-expiry');
    raise exception 'P2a NULL-expiry public cast accepted';
  exception when others then
    if sqlerrm='P2a NULL-expiry public cast accepted' then raise; end if;
  end;
  begin
    perform climate_vote.ballot_submit(
      'p2a-open-ballot-capability-00001','p2a-ballot-null-expiry',
      jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
    raise exception 'P2a NULL-expiry ballot submit accepted';
  exception when others then
    if sqlerrm='P2a NULL-expiry ballot submit accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()-interval '1 minute'
   where slug='0912-deliberation';
  begin
    perform climate_vote.public_round_cast_v2(
      'p2a-public-active-capability-0001','"yes"','p2a-expired-session');
    raise exception 'P2a expired session public cast accepted';
  exception when others then
    if sqlerrm='P2a expired session public cast accepted' then raise; end if;
  end;
  begin
    perform climate_vote.ballot_submit(
      'p2a-open-ballot-capability-00001','p2a-ballot-expired',
      jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
    raise exception 'P2a expired ballot submit accepted';
  exception when others then
    if sqlerrm='P2a expired ballot submit accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()+interval '36 hours'
   where slug='0912-deliberation';
  if (select count(*) from climate_vote.votes
       where round_id='p2a-public-active-capability-0001')<>v_votes
     or (select count(*) from climate_vote.ballot_response
          where ballot_id='91200000-0000-0000-0000-000000000304')<>v_ballot_responses then
    raise exception 'P2a rejected public lifecycle action changed vote/ballot state';
  end if;
  update climate_vote.session set status='closed' where slug='0912-deliberation';
  if (select count(*) from climate_vote.public_round_get_v2(
       'p2a-public-closed-capability-0001'))<>1
     or (select max(total_votes) from climate_vote.public_round_votes_v2(
       'p2a-public-closed-capability-0001'))<>1 then
    raise exception 'P2a closed historical public read policy failed';
  end if;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.rounds set status='closed'
   where id='p2a-public-active-capability-0001';
end $lifecycle_guards$;

insert into climate_vote.attendance_secret(secret_key,secret_hash) values
  ('hq_password',crypt('P2a shared password',gen_salt('bf',4))),
  ('hq:P2a verify operator',crypt('P2a named password',gen_salt('bf',4))),
  ('hq:P2a poison operator',crypt('P2a poison password',gen_salt('bf',4))),
  ('hq:P2a rate operator',crypt('P2a rate password',gen_salt('bf',4))),
  ('hq:P2a change operator',crypt('P2a change password',gen_salt('bf',4))),
  ('hq:P2a byte operator',crypt('P2a byte password',gen_salt('bf',4)))
on conflict(secret_key) do update set secret_hash=excluded.secret_hash;
insert into climate_vote.hq_operator(name,default_subgroup,active,must_change_password)
values
  ('P2a verify operator','synthetic',true,true),
  ('P2a poison operator','synthetic',true,true),
  ('P2a rate operator','synthetic',true,true),
  ('P2a change operator','synthetic',true,true),
  ('P2a byte operator','synthetic',true,true)
on conflict(name) do update set active=true,must_change_password=true;

do $bootstrap_null_guards$
declare
  v_token text; v_tokens bigint; v_attempts bigint; v_audit bigint;
  v_secret text; v_must_change boolean; v_rate_token text; v_result jsonb; i int;
  v_change_token text; v_change_token_2 text; v_poison_token text;
  v_source_hash text; v_workshop_audit bigint;
  v_byte_token text; v_byte_password text:=repeat('가',24);
begin
  v_tokens:=(select count(*) from climate_vote.attendance_auth_session);
  v_attempts:=(select count(*) from climate_vote.attendance_auth_attempt);
  begin perform climate_vote.attendance_team_unlock('731245',null);
    raise exception 'P2a NULL team PIN unexpectedly minted a token';
  exception when others then
    if sqlerrm='P2a NULL team PIN unexpectedly minted a token' then raise; end if;
  end;
  begin perform climate_vote.attendance_hq_unlock(null,'P2a shared operator');
    raise exception 'P2a NULL shared HQ password unexpectedly minted a token';
  exception when others then
    if sqlerrm='P2a NULL shared HQ password unexpectedly minted a token' then raise; end if;
  end;
  begin perform climate_vote.attendance_hq_unlock_named('P2a verify operator',null);
    raise exception 'P2a NULL named HQ password unexpectedly minted a token';
  exception when others then
    if sqlerrm='P2a NULL named HQ password unexpectedly minted a token' then raise; end if;
  end;
  if (select count(*) from climate_vote.attendance_auth_session)<>v_tokens
     or (select count(*) from climate_vote.attendance_auth_attempt)<>v_attempts then
    raise exception 'P2a NULL bootstrap credentials changed token or attempt state';
  end if;
  v_token:=climate_vote.attendance_hq_unlock_named(
    'P2a missing operator','P2a arbitrary password');
  if v_token is not null
     or (select count(*) from climate_vote.attendance_auth_session)<>v_tokens
     or (select count(*) from climate_vote.attendance_auth_attempt
          where scope='hq' and subject='P2a missing operator' and not succeeded)<>1 then
    raise exception 'missing named HQ dummy bcrypt path minted a token or lost failure evidence';
  end if;

  insert into climate_vote.attendance_auth_attempt(
    scope,subject,succeeded,source_hash)
  select 'hq','P2a poison operator',false,repeat('b',64)
    from generate_series(1,5);
  perform set_config(
    'request.headers','{"x-forwarded-for":"198.51.100.42"}',true);
  v_source_hash:=climate_vote.workshop_request_source_hash();
  v_poison_token:=climate_vote.attendance_hq_unlock_named(
    'P2a poison operator','P2a poison password');
  if length(v_poison_token)<>64
     or (select count(*) from climate_vote.attendance_auth_attempt
          where scope='hq' and subject='P2a poison operator'
            and not succeeded)<>5
     or (select count(*) from climate_vote.attendance_auth_attempt
          where scope='hq' and subject='P2a poison operator' and succeeded
            and source_hash=v_source_hash)<>1 then
    raise exception 'P2a account-name failure poisoning blocked valid recovery';
  end if;
  if climate_vote.workshop_hq_logout_v2(v_poison_token) is not true then
    raise exception 'P2a poisoned-account recovery token could not be revoked';
  end if;

  perform set_config(
    'request.headers','{"x-forwarded-for":"203.0.113.42"}',true);
  v_source_hash:=climate_vote.workshop_request_source_hash();
  insert into climate_vote.attendance_auth_attempt(
    scope,subject,succeeded,source_hash)
  select 'hq','P2a source budget probe',false,v_source_hash
    from generate_series(1,20);
  v_tokens:=(select count(*) from climate_vote.attendance_auth_session);
  v_attempts:=(select count(*) from climate_vote.attendance_auth_attempt);
  if climate_vote.attendance_hq_unlock_named(
       'P2a verify operator','P2a named password') is not null
     or (select count(*) from climate_vote.attendance_auth_session)<>v_tokens
     or (select count(*) from climate_vote.attendance_auth_attempt)<>v_attempts then
    raise exception 'P2a named HQ source budget did not fail closed';
  end if;
  perform set_config(
    'request.headers','{"x-forwarded-for":"198.51.100.45"}',true);

  v_token:=climate_vote.attendance_hq_unlock_named(
    'P2a verify operator','P2a named password');
  select secret_hash into v_secret from climate_vote.attendance_secret
   where secret_key='hq:P2a verify operator';
  select must_change_password into v_must_change from climate_vote.hq_operator
   where name='P2a verify operator';
  v_attempts:=(select count(*) from climate_vote.attendance_auth_attempt);
  v_audit:=(select count(*) from climate_vote.attendance_audit_log);
  begin perform climate_vote.hq_change_password(
      v_token,null,'P2a replacement password');
    raise exception 'P2a NULL current password unexpectedly changed secret';
  exception when others then
    if sqlerrm='P2a NULL current password unexpectedly changed secret' then raise; end if;
  end;
  begin perform climate_vote.hq_change_password(
      v_token,'P2a named password',null);
    raise exception 'P2a NULL new password unexpectedly changed secret';
  exception when others then
    if sqlerrm='P2a NULL new password unexpectedly changed secret' then raise; end if;
  end;
  if (select secret_hash from climate_vote.attendance_secret
       where secret_key='hq:P2a verify operator') is distinct from v_secret
     or (select must_change_password from climate_vote.hq_operator
       where name='P2a verify operator') is distinct from v_must_change
     or (select count(*) from climate_vote.attendance_auth_attempt)<>v_attempts
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit then
    raise exception 'P2a NULL password change mutated secret, flag, attempt, or audit';
  end if;

  if octet_length(v_byte_password)<>72 then
    raise exception 'P2a password byte-boundary fixture is not exactly 72 bytes';
  end if;
  v_byte_token:=climate_vote.attendance_hq_unlock_named(
    'P2a byte operator','P2a byte password');
  select secret_hash into v_secret from climate_vote.attendance_secret
   where secret_key='hq:P2a byte operator';
  begin
    perform climate_vote.hq_change_password(
      v_byte_token,'P2a byte password',v_byte_password||'a');
    raise exception 'P2a 73-byte new password unexpectedly changed secret';
  exception when others then
    if sqlerrm='P2a 73-byte new password unexpectedly changed secret' then raise; end if;
    if sqlerrm<>'새 비밀번호는 UTF-8 기준 72바이트 이하여야 합니다' then raise; end if;
  end;
  if (select secret_hash from climate_vote.attendance_secret
       where secret_key='hq:P2a byte operator') is distinct from v_secret
     or (select id from climate_vote.attendance_token_row(v_byte_token)) is null then
    raise exception 'P2a rejected 73-byte password changed secret or revoked bearer';
  end if;
  v_result:=climate_vote.hq_change_password(
    v_byte_token,'P2a byte password',v_byte_password);
  if v_result->>'changed'<>'true'
     or (select extensions.crypt(v_byte_password,secret_hash)=secret_hash
          from climate_vote.attendance_secret
          where secret_key='hq:P2a byte operator') is not true then
    raise exception 'P2a 72-byte UTF-8 password boundary was rejected: %',v_result;
  end if;

  v_change_token:=climate_vote.attendance_hq_unlock_named(
    'P2a change operator','P2a change password');
  v_change_token_2:=climate_vote.attendance_hq_unlock_named(
    'P2a change operator','P2a change password');
  v_result:=climate_vote.hq_change_password(
    v_change_token,'P2a change password','P2a changed password');
  if v_result->>'changed'<>'true'
     or coalesce((v_result->>'sessions_revoked')::int,0)<2 then
    raise exception 'P2a password change did not revoke every actor session: %',v_result;
  end if;
  begin
    perform climate_vote.attendance_token_row(v_change_token);
    raise exception 'P2a password-changing HQ token remained usable';
  exception when others then
    if sqlerrm='P2a password-changing HQ token remained usable' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_token_row(v_change_token_2);
    raise exception 'P2a second-device HQ token survived password change';
  exception when others then
    if sqlerrm='P2a second-device HQ token survived password change' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;

  v_rate_token:=climate_vote.attendance_hq_unlock_named(
    'P2a rate operator','P2a rate password');
  select secret_hash into v_secret from climate_vote.attendance_secret
   where secret_key='hq:P2a rate operator';
  v_audit:=(select count(*) from climate_vote.attendance_audit_log);
  v_workshop_audit:=(select count(*) from climate_vote.workshop_audit_event
    where action='hq_password_changed' and actor_label='P2a rate operator');
  for i in 1..5 loop
    v_result:=climate_vote.hq_change_password(
      v_rate_token,'wrong current password','P2a replacement password');
    if v_result->>'changed'<>'false'
       or v_result->>'error'<>'current_password_incorrect' then
      raise exception 'P2a wrong password response mismatch at attempt %: %',i,v_result;
    end if;
  end loop;
  v_result:=climate_vote.hq_change_password(
    v_rate_token,'wrong current password','P2a replacement password');
  if v_result->>'changed'<>'false'
     or v_result->>'error'<>'rate_limited' then
    raise exception 'P2a password change budget did not block attempt six: %',v_result;
  end if;
  v_result:=climate_vote.hq_change_password(
    v_rate_token,'P2a rate password','P2a replacement password');
  if v_result->>'changed'<>'false'
     or v_result->>'error'<>'rate_limited'
     or (select extensions.crypt('P2a rate password',secret_hash)=secret_hash
       from climate_vote.attendance_secret
       where secret_key='hq:P2a rate operator') is not true then
    raise exception 'P2a password change budget allowed a correct guess inside the window: %',v_result;
  end if;
  if (select count(*) from climate_vote.attendance_auth_attempt
       where scope='hq' and subject='password-change:P2a rate operator'
         and not succeeded)<>5 then
    raise exception 'P2a password change failure budget was not exact';
  end if;
  update climate_vote.attendance_auth_attempt
     set attempted_at=now()-interval '16 minutes'
   where scope='hq' and subject='password-change:P2a rate operator'
     and not succeeded;
  v_result:=climate_vote.hq_change_password(
    v_rate_token,'P2a rate password','P2a replacement password');
  if v_result->>'changed'<>'true'
     or coalesce((v_result->>'sessions_revoked')::int,0)<1 then
    raise exception 'P2a password recovery did not resume after budget expiry: %',v_result;
  end if;
  if (select count(*) from climate_vote.attendance_auth_attempt
       where scope='hq' and subject='password-change:P2a rate operator'
         and not succeeded)<>5
     or (select extensions.crypt('P2a replacement password',secret_hash)=secret_hash
       from climate_vote.attendance_secret
       where secret_key='hq:P2a rate operator') is not true
     or (select secret_hash from climate_vote.attendance_secret
       where secret_key='hq:P2a rate operator') is not distinct from v_secret
     or (select must_change_password from climate_vote.hq_operator
       where name='P2a rate operator') is not false
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit
     or (select count(*) from climate_vote.workshop_audit_event
       where action='hq_password_changed' and actor_label='P2a rate operator')
          <>v_workshop_audit+1 then
    raise exception 'P2a password recovery lost failures, rotation, or audit evidence';
  end if;
  begin
    perform climate_vote.attendance_token_row(v_rate_token);
    raise exception 'P2a password recovery left old HQ bearer active';
  exception when others then
    if sqlerrm='P2a password recovery left old HQ bearer active' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;
end $bootstrap_null_guards$;

-- v3 mutation contracts are exercised as their real token-scoped callers:
-- exact replay, payload mismatch, stale CAS, bounded reopen, exact bearer
-- logout, named-operator liveness, and source-bound HQ assignments.
do $token_v3_contracts$
declare
  v_team_token text; v_other_team_token text; v_hq text; v_forged_hq text;
  v_round climate_vote.rounds; v_replay_round climate_vote.rounds;
  v_close_key uuid:=gen_random_uuid(); v_reopen_key uuid:=gen_random_uuid();
  v_audit_before bigint; v_ledger_before bigint; v_deadline timestamptz;
  v_updated timestamptz; v_old_updated timestamptz;
  v_category jsonb; v_category_replay jsonb; v_kind jsonb; v_result jsonb;
  v_replacement jsonb;
  v_category_key uuid:=gen_random_uuid(); v_kind_key uuid:=gen_random_uuid();
  v_replacement_key uuid:=gen_random_uuid(); v_event_count bigint;
  v_category_event bigint; v_kind_event bigint; v_source uuid;
begin
  v_team_token:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011','P2a v3 team token A');
  v_other_team_token:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011','P2a v3 team token B');
  update climate_vote.attendance_auth_session
     set purpose='workshop'
   where token_hash in (
     encode(extensions.digest(v_team_token,'sha256'),'hex'),
     encode(extensions.digest(v_other_team_token,'sha256'),'hex'));

  insert into climate_vote.rounds
    (id,title,type,options,status,team_id,session_id,org_id,created_by)
  values('p2a-round-status-v3-contract','P2a round status v3','RADIO',
    '["yes","no"]'::jsonb,'active',
    '91200000-0000-0000-0000-000000000011',
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000001','verify');
  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event
    where action='round_status_changed' and after_value->>'round_id'=
      'p2a-round-status-v3-contract');
  v_round:=climate_vote.mod_set_round_status_v3(v_team_token,
    'p2a-round-status-v3-contract','active','closed',v_close_key);
  if v_round.status<>'closed' then raise exception 'round v3 close failed'; end if;
  v_round:=climate_vote.mod_set_round_status_v3(v_team_token,
    'p2a-round-status-v3-contract','closed','active',v_reopen_key);
  if v_round.status<>'active' then raise exception 'round v3 bounded reopen failed'; end if;
  v_replay_round:=climate_vote.mod_set_round_status_v3(v_team_token,
    'p2a-round-status-v3-contract','active','closed',v_close_key);
  if v_replay_round.status<>'closed'
     or (select status from climate_vote.rounds
          where id='p2a-round-status-v3-contract')<>'active' then
    raise exception 'round status exact replay changed live state';
  end if;
  begin
    perform climate_vote.mod_set_round_status_v3(v_team_token,
      'p2a-round-status-v3-contract','closed','active',v_close_key);
    raise exception 'round status request key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='round status request key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_set_round_status_v3(v_team_token,
      'p2a-round-status-v3-contract','closed','active',gen_random_uuid());
    raise exception 'stale round status CAS unexpectedly accepted';
  exception when others then
    if sqlerrm='stale round status CAS unexpectedly accepted' then raise; end if;
    if position('round status conflict' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.rounds
       where id='p2a-round-status-v3-contract')<>'active'
     or (select count(*) from climate_vote.workshop_audit_event
          where action='round_status_changed' and after_value->>'round_id'=
            'p2a-round-status-v3-contract')<>v_audit_before+2 then
    raise exception 'stale round status changed state or audit history';
  end if;
  update climate_vote.rounds set status='closed',updated_at=now()-interval '61 seconds'
   where id='p2a-round-status-v3-contract';
  begin
    perform climate_vote.mod_set_round_status_v3(v_team_token,
      'p2a-round-status-v3-contract','closed','active',gen_random_uuid());
    raise exception 'expired round reopen window unexpectedly accepted';
  exception when others then
    if sqlerrm='expired round reopen window unexpectedly accepted' then raise; end if;
    if position('within 60 seconds' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.rounds
       where id='p2a-round-status-v3-contract')<>'closed' then
    raise exception 'expired round reopen changed state';
  end if;

  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event
    where action='device_logged_out');
  if climate_vote.workshop_team_logout_v2(v_team_token) is not true then
    raise exception 'team token logout did not revoke exact bearer';
  end if;
  if climate_vote.mod_session_get(v_other_team_token)->>'teamId'
       <>'91200000-0000-0000-0000-000000000011' then
    raise exception 'team logout revoked a different bearer';
  end if;
  begin
    perform climate_vote.workshop_team_logout_v2(v_team_token);
    raise exception 'revoked team bearer logged out twice';
  exception when others then
    if sqlerrm='revoked team bearer logged out twice' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.workshop_audit_event
       where action='device_logged_out')<>v_audit_before+1 then
    raise exception 'team logout audit count mismatch';
  end if;
  -- Leave no extra live device behind for the subsequent real join-code
  -- bootstrap seam in this same rollback-only verifier transaction.
  perform climate_vote.workshop_team_logout_v2(v_other_team_token);

  v_hq:=climate_vote.attendance_issue_token('hq',null,'P2a verify operator');
  select deadline_at into v_deadline from climate_vote.discussion_topic
   where id='91200000-0000-0000-0000-000000000021';
  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event);
  v_ledger_before:=(select count(*) from climate_vote.workshop_request_ledger);
  update climate_vote.hq_operator set active=false where name='P2a verify operator';
  begin
    perform climate_vote.workshop_hq_set_deadline(v_hq,'0912-deliberation',
      '91200000-0000-0000-0000-000000000021',v_deadline,
      clock_timestamp()+interval '5 minutes',gen_random_uuid());
    raise exception 'inactive named HQ bearer unexpectedly mutated state';
  exception when others then
    if sqlerrm='inactive named HQ bearer unexpectedly mutated state' then raise; end if;
    if position('active named HQ authorization required' in sqlerrm)=0 then raise; end if;
  end;
  if (select deadline_at from climate_vote.discussion_topic
       where id='91200000-0000-0000-0000-000000000021') is distinct from v_deadline
     or (select count(*) from climate_vote.workshop_audit_event)<>v_audit_before
     or (select count(*) from climate_vote.workshop_request_ledger)<>v_ledger_before then
    raise exception 'inactive named HQ rejection changed deadline, audit, or ledger';
  end if;
  update climate_vote.hq_operator set active=true where name='P2a verify operator';
  v_forged_hq:=climate_vote.attendance_issue_token('hq',null,'P2a forged shared actor');
  begin
    perform climate_vote.workshop_hq_status(v_forged_hq,'0912-deliberation');
    raise exception 'forged unnamed HQ bearer unexpectedly accepted';
  exception when others then
    if sqlerrm='forged unnamed HQ bearer unexpectedly accepted' then raise; end if;
    if position('active named HQ authorization required' in sqlerrm)=0 then raise; end if;
  end;

  insert into climate_vote.discussion_topic
    (id,session_id,ordinal,block,prompt,guidance,status,org_id)
  values('91200000-0000-0000-0000-000000000360',
    '91200000-0000-0000-0000-000000000003',90,'pm',
    'P2a HQ assignment v3 source identity','Synthetic verifier','open',
    '91200000-0000-0000-0000-000000000001');
  insert into climate_vote.submission
    (id,topic_id,team_id,status,org_id,version,updated_at)
  values('91200000-0000-0000-0000-000000000361',
    '91200000-0000-0000-0000-000000000360',
    '91200000-0000-0000-0000-000000000011','draft',
    '91200000-0000-0000-0000-000000000001',0,now()-interval '1 second');
  insert into climate_vote.submission_item
    (id,submission_id,ordinal,kind,content,rationale,provenance)
  values('91200000-0000-0000-0000-000000000362',
    '91200000-0000-0000-0000-000000000361',1,'core',
    'First source sentence','Synthetic verifier','{}'::jsonb);
  if not exists(select 1 from climate_vote.hq_submissions_v3(
       v_hq,'0912-deliberation') where submission_id=
         '91200000-0000-0000-0000-000000000361'
       and item_id='91200000-0000-0000-0000-000000000362') then
    raise exception 'HQ board did not expose the live source item identity';
  end if;
  select updated_at into v_updated from climate_vote.submission
   where id='91200000-0000-0000-0000-000000000361';
  v_old_updated:=v_updated;
  v_category:=climate_vote.hq_submission_category_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'common',v_updated,null,v_category_key);
  v_kind:=climate_vote.hq_submission_kind_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'Claim',v_updated,null,v_kind_key);
  if v_category->>'status'<>'applied' or v_kind->>'status'<>'applied'
     or v_category->>'source_item_id'<>'91200000-0000-0000-0000-000000000362'
     or v_kind->>'source_item_id'<>'91200000-0000-0000-0000-000000000362' then
    raise exception 'HQ assignment v3 initial result mismatch: %, %',v_category,v_kind;
  end if;
  v_category_event:=(v_category->>'event_id')::bigint;
  v_kind_event:=(v_kind->>'event_id')::bigint;
  v_category_replay:=climate_vote.hq_submission_category_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'common',v_updated,null,v_category_key);
  if v_category_replay<>v_category then
    raise exception 'HQ assignment exact replay changed result';
  end if;
  begin
    perform climate_vote.hq_submission_category_assign_v3(v_hq,
      '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
      'difference',v_updated,null,v_category_key);
    raise exception 'HQ assignment request key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='HQ assignment request key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  v_event_count:=(select count(*) from climate_vote.submission_category_event
    where submission_id='91200000-0000-0000-0000-000000000361');
  v_result:=climate_vote.hq_submission_category_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'difference',v_updated,null,gen_random_uuid());
  if v_result->>'status'<>'conflict'
     or (v_result->>'current_event_id')::bigint<>v_category_event
     or (select count(*) from climate_vote.submission_category_event
          where submission_id='91200000-0000-0000-0000-000000000361')<>v_event_count then
    raise exception 'stale HQ assignment event CAS mutated history: %',v_result;
  end if;

  delete from climate_vote.submission_item
   where id='91200000-0000-0000-0000-000000000362';
  update climate_vote.submission set version=version+1,updated_at=clock_timestamp()
   where id='91200000-0000-0000-0000-000000000361';
  insert into climate_vote.submission_item
    (id,submission_id,ordinal,kind,content,rationale,provenance)
  values('91200000-0000-0000-0000-000000000363',
    '91200000-0000-0000-0000-000000000361',1,'core',
    'Replacement source sentence','Synthetic verifier','{}'::jsonb);
  if exists(select 1 from climate_vote.hq_submission_categories_v3(
       v_hq,'0912-deliberation') where submission_id=
         '91200000-0000-0000-0000-000000000361')
     or exists(select 1 from climate_vote.hq_submission_kinds_v3(
       v_hq,'0912-deliberation') where submission_id=
         '91200000-0000-0000-0000-000000000361') then
    raise exception 'same-ordinal replacement inherited an old HQ assignment';
  end if;
  if not exists(select 1 from climate_vote.hq_submissions_v3(
       v_hq,'0912-deliberation') where submission_id=
         '91200000-0000-0000-0000-000000000361'
       and item_id='91200000-0000-0000-0000-000000000363') then
    raise exception 'HQ board kept a stale source item identity after replacement';
  end if;
  select updated_at into v_updated from climate_vote.submission
   where id='91200000-0000-0000-0000-000000000361';
  v_replacement:=climate_vote.hq_submission_category_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'question',v_updated,null,v_replacement_key);
  if v_replacement->>'status'<>'applied'
     or v_replacement->>'source_item_id'<>'91200000-0000-0000-0000-000000000363' then
    raise exception 'replacement source assignment failed: %',v_replacement;
  end if;
  v_category_event:=(v_replacement->>'event_id')::bigint;
  v_event_count:=(select count(*) from climate_vote.submission_category_event
    where submission_id='91200000-0000-0000-0000-000000000361');
  v_result:=climate_vote.hq_submission_category_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'conflict',v_old_updated,v_category_event,gen_random_uuid());
  if v_result->>'status'<>'conflict'
     or (select count(*) from climate_vote.submission_category_event
          where submission_id='91200000-0000-0000-0000-000000000361')<>v_event_count then
    raise exception 'stale submission updated_at CAS mutated assignment: %',v_result;
  end if;

  delete from climate_vote.submission_item
   where id='91200000-0000-0000-0000-000000000363';
  update climate_vote.submission set version=version+1,updated_at=clock_timestamp()
   where id='91200000-0000-0000-0000-000000000361'
   returning updated_at into v_updated;
  v_event_count:=(select count(*) from climate_vote.submission_kind_event
    where submission_id='91200000-0000-0000-0000-000000000361');
  begin
    perform climate_vote.hq_submission_kind_assign_v3(v_hq,
      '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
      'Evidence',v_updated,null,gen_random_uuid());
    raise exception 'deleted submission item assignment unexpectedly accepted';
  exception when others then
    if sqlerrm='deleted submission item assignment unexpectedly accepted' then raise; end if;
    if position('submission item no longer exists' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.submission_kind_event
       where submission_id='91200000-0000-0000-0000-000000000361')<>v_event_count then
    raise exception 'deleted item rejection appended assignment history';
  end if;
  v_category_replay:=climate_vote.hq_submission_category_assign_v3(v_hq,
    '0912-deliberation','91200000-0000-0000-0000-000000000361',1,
    'question',(v_replacement->>'submission_updated_at')::timestamptz,
    null,v_replacement_key);
  if v_category_replay<>v_replacement
     or (v_category_replay->>'event_id')::bigint<>v_category_event then
    raise exception 'assignment replay failed after source deletion';
  end if;
end $token_v3_contracts$;

update climate_vote.rounds set status='active'
 where id='p2a-public-active-capability-0001';
set local role anon;
do $anon_actual_calls$
declare v_result jsonb; v_bootstrap text; v_rows int;
begin
  v_bootstrap:=climate_vote.attendance_hq_unlock_named(
    'P2a verify operator','P2a named password');
  if length(v_bootstrap)<>64 then raise exception 'named HQ bootstrap failed'; end if;
  begin
    perform climate_vote.mod_join('091201');
    raise exception 'legacy call permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.topic_set_deadline(
      'legacy-hq-token-must-not-run',
      '91200000-0000-0000-0000-000000000021',
      now());
    raise exception 'legacy unscoped deadline permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from climate_vote.attendance_hq_summary();
    raise exception 'legacy unscoped attendance summary permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.attendance_team_unlock_by_code('731245');
    raise exception 'legacy join-code attendance unlock permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.attendance_team_unlock('731245',null);
    raise exception 'legacy PIN attendance unlock permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.org_of_code('731245');
    raise exception 'legacy organization code oracle permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.org_of_token(v_bootstrap);
    raise exception 'legacy token organization oracle permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.readiness_check(
      '91200000-0000-0000-0000-000000000003');
    raise exception 'legacy unscoped readiness permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.attendance_round_eligible_count(
      'p2a-public-active-capability-0001');
    raise exception 'legacy unscoped eligible count permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.submission_finalize_hq(
      'legacy-hq-token-must-not-run',
      '91200000-0000-0000-0000-000000000106',
      'cross-session permission negative');
    raise exception 'legacy unscoped HQ finalize permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from climate_vote.hq_submissions(
      'legacy-hq-token-must-not-run','p2a-other-session');
    raise exception 'legacy unscoped HQ submissions permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from climate_vote.hq_teams();
    raise exception 'legacy unscoped HQ teams permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from climate_vote.rounds;
    raise exception 'direct anonymous rounds read permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from climate_vote.votes;
    raise exception 'direct anonymous votes read permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into climate_vote.votes(round_id,choice,voter_role,client_id,org_id)
    values('p2a-public-active-capability-0001','"yes"'::jsonb,'citizen',
      'direct-anon-must-not-write','91200000-0000-0000-0000-000000000001');
    raise exception 'direct anonymous votes insert permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.cv_rounds;
    raise exception 'legacy owner-rights round view permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.cv_votes;
    raise exception 'legacy owner-rights vote view read permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.cv_votes(round_id,choice,voter_role,client_id,org_id)
    values('p2a-public-active-capability-0001','"yes"'::jsonb,'citizen',
      'legacy-view-must-not-write','91200000-0000-0000-0000-000000000001');
    raise exception 'legacy owner-rights vote view insert permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.cv_tally;
    raise exception 'legacy owner-rights tally view permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.cv_tally_scale;
    raise exception 'legacy owner-rights scale tally view permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.cv_set_active('p2a-public-active-capability-0001');
    raise exception 'retired public round activation RPC permission denied seam failed';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_rows
    from climate_vote.public_round_get_v2('p2a-public-active-capability-0001');
  if v_rows<>1
     or climate_vote.public_round_cast_v2(
       'p2a-public-active-capability-0001','"no"','p2a-public-device-1')<>'ok'
     or climate_vote.public_round_cast_v2(
       'p2a-public-active-capability-0001','"no"','p2a-public-device-1')<>'duplicate' then
    raise exception 'public round capability failed after table revoke';
  end if;
  begin
    perform climate_vote.public_round_cast_v2(
      'p2a-public-active-capability-0001','"tampered"','p2a-public-device-2');
    raise exception 'invalid public round choice unexpectedly accepted after activation';
  exception when others then
    if sqlerrm='invalid public round choice unexpectedly accepted after activation' then raise; end if;
    if position('invalid public vote choice' in sqlerrm)=0 then raise; end if;
  end;
  if (select max(total_votes) from climate_vote.public_round_votes_v2(
       'p2a-public-closed-capability-0001'))<>1
     or climate_vote.public_round_cast_v2(
       'p2a-public-closed-capability-0001','"yes"','p2a-public-device-3')<>'closed' then
    raise exception 'public closed aggregate capability failed after table revoke';
  end if;

  v_result:=climate_vote.ballot_results('p2a-published-ballot-token-0001',null);
  if v_result is null or v_result->>'status'<>'published' then
    raise exception 'public published result was not preserved: %',v_result;
  end if;
  if climate_vote.ballot_results('p2a-draft-ballot-token-00000002',null) is not null then
    raise exception 'unpublished result leaked to public caller';
  end if;
  begin
    perform climate_vote.ballot_results('p2a-draft-ballot-token-00000002','091201');
    raise exception 'legacy ballot p_code bypass unexpectedly succeeded';
  exception when raise_exception then
    if position('legacy moderator code results disabled' in sqlerrm)=0 then raise; end if;
  end;

  v_result:=climate_vote.ballot_get('p2a-open-ballot-capability-00001');
  if v_result is null or v_result->>'status'<>'open' then
    raise exception 'public ballot capability read failed after activation: %',v_result;
  end if;
  v_result:=climate_vote.ballot_submit(
    'p2a-open-ballot-capability-00001','p2a-ballot-client-valid-0001',
    jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
  if v_result->>'ok'<>'true' then
    raise exception 'public ballot capability submit failed after activation: %',v_result;
  end if;
  begin
    perform climate_vote.ballot_submit(
      'p2a-open-ballot-capability-00001','p2a-ballot-client-valid-0001',
      jsonb_build_object('91200000-0000-0000-0000-000000000314',5));
    raise exception 'duplicate public ballot response unexpectedly accepted';
  exception when others then
    if sqlerrm='duplicate public ballot response unexpectedly accepted' then raise; end if;
    if position('already submitted' in sqlerrm)=0 then raise; end if;
  end;

  v_result:=climate_vote.mod_exchange_join_code(
    '731245','91200000-0000-0000-0000-000000000501','P2a positive token');
  if length(v_result->>'accessToken')<>64
     or v_result->>'sessionId'<>'91200000-0000-0000-0000-000000000003' then
    raise exception 'post-cutover token exchange failed: %',v_result;
  end if;
  if climate_vote.mod_session_get(v_result->>'accessToken')->>'deviceId'
       <>'91200000-0000-0000-0000-000000000501' then
    raise exception 'post-cutover token restore failed';
  end if;
  select count(*) into v_rows from climate_vote.attendance_roster_v2(
    v_result->>'accessToken','0912-deliberation');
  if v_rows<1 then
    raise exception 'workshop token attendance read failed after legacy unlock revoke';
  end if;
  if climate_vote.attendance_round_eligible_count_v2(
       v_result->>'accessToken','p2a-public-active-capability-0001') is null then
    raise exception 'workshop token eligible count failed after legacy revoke';
  end if;
  if climate_vote.workshop_hq_logout_v2(v_bootstrap) is not true then
    raise exception 'named HQ logout failed through anon RPC role';
  end if;
  begin
    perform climate_vote.workshop_hq_logout_v2(v_bootstrap);
    raise exception 'revoked named HQ bearer logged out twice';
  exception when others then
    if sqlerrm='revoked named HQ bearer logged out twice' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;
end $anon_actual_calls$;
reset role;

do $public_ballot_org_binding$
begin
  if (select org_id from climate_vote.ballot_response
       where ballot_id='91200000-0000-0000-0000-000000000304'
         and client_id='p2a-ballot-client-valid-0001')
       is distinct from '91200000-0000-0000-0000-000000000001'::uuid then
    raise exception 'public ballot response did not inherit ballot organization';
  end if;
end $public_ballot_org_binding$;

-- Disposable owner-only fixture control. The verifier runs staff calls as the
-- real authenticated role after the cutover has revoked direct table access;
-- this temporary transaction-scoped helper changes only lifecycle fixtures and
-- returns a state/audit snapshot for negative-path invariants.
create or replace function climate_vote.p2a_verify_canvas_fixture(
  p_action text, p_round_id text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
begin
  if p_action='snapshot' then
    return jsonb_build_object(
      'round_count',(select count(*) from climate_vote.rounds
        where team_id is null
          and session_id='91200000-0000-0000-0000-000000000003'),
      'session_event_count',(select count(*)
        from climate_vote.platform_canvas_round_event
        where session_id='91200000-0000-0000-0000-000000000003'),
      'round_status',(select status from climate_vote.rounds where id=p_round_id),
      'round_event_count',(select count(*)
        from climate_vote.platform_canvas_round_event where round_id=p_round_id));
  elsif p_action='session_inactive' then
    update climate_vote.session set status='closed'
     where id='91200000-0000-0000-0000-000000000003';
  elsif p_action='assembly_inactive' then
    update climate_vote.assembly set status='closed'
     where id='91200000-0000-0000-0000-000000000002';
  elsif p_action='assembly_archived' then
    update climate_vote.assembly set archived_at=now()
     where id='91200000-0000-0000-0000-000000000002';
  elsif p_action='org_inactive' then
    update climate_vote.org set status='suspended'
     where id='91200000-0000-0000-0000-000000000001';
  elsif p_action='org_archived' then
    update climate_vote.org set archived_at=now()
     where id='91200000-0000-0000-0000-000000000001';
  elsif p_action='null_expiry' then
    update climate_vote.session set access_expires_at=null
     where id='91200000-0000-0000-0000-000000000003';
  elsif p_action='expired' then
    update climate_vote.session set access_expires_at=now()-interval '1 second'
     where id='91200000-0000-0000-0000-000000000003';
  elsif p_action='restore' then
    update climate_vote.org set status='active',archived_at=null
     where id='91200000-0000-0000-0000-000000000001';
    update climate_vote.assembly set status='active',archived_at=null
     where id='91200000-0000-0000-0000-000000000002';
    update climate_vote.session
       set status='active',access_expires_at=now()+interval '36 hours'
     where id='91200000-0000-0000-0000-000000000003';
  else
    raise exception 'unknown Canvas verifier fixture action: %',p_action;
  end if;
  return jsonb_build_object('ok',true);
end $fn$;
revoke execute on function climate_vote.p2a_verify_canvas_fixture(text,text)
from public, anon, authenticated;
grant execute on function climate_vote.p2a_verify_canvas_fixture(text,text)
to authenticated;

-- Exercise the team save path while the surrounding verifier remains signed in
-- as staff. The helper exists only inside this rollback-only transaction and
-- returns assertions, not a reusable production capability.
create or replace function climate_vote.p2a_verify_same_ordinal_save(
  p_issue_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_team_token text; v_version bigint; v_item_id uuid; v_unchanged_id uuid;
  v_old_kind text; v_old_content text; v_old_rationale text;
  v_old_created_at timestamptz; v_archive_before bigint; v_archive_after bigint;
  v_archive_max_before bigint; v_unchanged_archive_before bigint;
  v_result jsonb; v_replay jsonb;
  v_unchanged_result jsonb;
  v_topic_status text;
  v_items constant jsonb := '[
    {"ordinal":1,"kind":"extra","content":"P2a staff issue source item revised","rationale":"Synthetic verification rationale revised"},
    {"ordinal":2,"kind":"extra","content":"P2a atomic reclassification item","rationale":"Synthetic atomic rationale"}
  ]'::jsonb;
  v_request constant uuid := '91200000-0000-4000-8000-000000000405';
begin
  select dt.status into v_topic_status
    from climate_vote.discussion_topic dt
   where dt.id='91200000-0000-0000-0000-000000000021' for update;
  if not found then raise exception 'same-ordinal verifier topic missing'; end if;
  update climate_vote.discussion_topic set status='open'
   where id='91200000-0000-0000-0000-000000000021';

  select s.version into v_version
    from climate_vote.submission s
   where s.id='91200000-0000-0000-0000-000000000321';
  if not found then raise exception 'same-ordinal verifier submission missing'; end if;

  select si.id,si.kind,si.content,si.rationale,si.created_at
    into v_item_id,v_old_kind,v_old_content,v_old_rationale,v_old_created_at
    from climate_vote.submission_item si
   where si.submission_id='91200000-0000-0000-0000-000000000321'
     and si.ordinal=1;
  if not found then raise exception 'same-ordinal verifier source item missing'; end if;
  select si.id into v_unchanged_id
    from climate_vote.submission_item si
   where si.submission_id='91200000-0000-0000-0000-000000000321'
     and si.ordinal=2;
  if not found then raise exception 'same-ordinal verifier unchanged item missing'; end if;

  perform 1
    from climate_vote.issue i
    join climate_vote.issue_link il on il.issue_id=i.id and il.item_id=v_item_id
   where i.id=p_issue_id and i.review_status='reviewed'
     and i.reviewed_by is not null and i.reviewed_at is not null;
  if not found then raise exception 'same-ordinal verifier reviewed link missing'; end if;

  select count(*),coalesce(max(a.id),0)
    into v_archive_before,v_archive_max_before
    from climate_vote.submission_item_archive a
   where a.submission_id='91200000-0000-0000-0000-000000000321'
     and a.ordinal=1;
  select count(*) into v_unchanged_archive_before
    from climate_vote.submission_item_archive a
   where a.submission_id='91200000-0000-0000-0000-000000000321'
     and a.ordinal=2;

  v_team_token:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011',
    'P2a same-ordinal archive verifier');
  update climate_vote.attendance_auth_session
     set purpose='workshop',device_id='91200000-0000-4000-8000-000000000420'
   where token_hash=encode(extensions.digest(v_team_token,'sha256'),'hex');

  v_result:=climate_vote.submission_save_v3(
    v_team_token,'91200000-0000-0000-0000-000000000021',v_items,
    v_version,v_request,false);
  if v_result->>'status'<>'draft'
     or (v_result->>'version')::bigint<>v_version+1 then
    raise exception 'same-ordinal save result mismatch: %',v_result;
  end if;

  select count(*) into v_archive_after
    from climate_vote.submission_item_archive a
   where a.submission_id='91200000-0000-0000-0000-000000000321'
     and a.ordinal=1;
  if v_archive_after<>v_archive_before+1
     or (select count(*) from climate_vote.submission_item_archive a
          where a.id>v_archive_max_before
            and a.submission_id='91200000-0000-0000-0000-000000000321'
            and a.ordinal=1
            and a.kind is not distinct from v_old_kind
            and a.content=v_old_content
            and a.rationale is not distinct from v_old_rationale
            and a.created_at is not distinct from v_old_created_at)<>1 then
    raise exception 'same-ordinal save did not archive exactly one old row';
  end if;
  if not exists(select 1 from climate_vote.submission_item_archive a
      where a.submission_id='91200000-0000-0000-0000-000000000321'
        and a.ordinal=1
        and a.kind is not distinct from v_old_kind
        and a.content=v_old_content
        and a.rationale is not distinct from v_old_rationale
        and a.created_at is not distinct from v_old_created_at) then
    raise exception 'same-ordinal archive did not preserve old source values';
  end if;
  if not exists(select 1 from climate_vote.submission_item si
      where si.id=v_item_id
        and si.submission_id='91200000-0000-0000-0000-000000000321'
        and si.ordinal=1 and si.kind='extra'
        and si.content='P2a staff issue source item revised'
        and si.rationale='Synthetic verification rationale revised')
     or not exists(select 1 from climate_vote.submission_item si
      where si.id=v_unchanged_id
        and si.submission_id='91200000-0000-0000-0000-000000000321'
        and si.ordinal=2) then
    raise exception 'same-ordinal save did not preserve stable item ids';
  end if;
  if not exists(select 1 from climate_vote.issue_link il
      where il.issue_id=p_issue_id and il.item_id=v_item_id) then
    raise exception 'same-ordinal save did not preserve issue link';
  end if;
  if not exists(select 1 from climate_vote.issue i
      where i.id=p_issue_id and i.review_status='draft'
        and i.reviewed_by is null and i.reviewed_at is null) then
    raise exception 'same-ordinal source change did not invalidate linked review';
  end if;
  if (select count(*) from climate_vote.submission_item_archive a
       where a.submission_id='91200000-0000-0000-0000-000000000321'
         and a.ordinal=2)<>v_unchanged_archive_before then
    raise exception 'same-ordinal save archived an unchanged companion row';
  end if;

  -- An exact idempotent replay and a new, fully unchanged save must not append
  -- another archive row.
  v_replay:=climate_vote.submission_save_v3(
    v_team_token,'91200000-0000-0000-0000-000000000021',v_items,
    v_version,v_request,false);
  if v_replay<>v_result then
    raise exception 'same-ordinal save replay changed result';
  end if;
  v_unchanged_result:=climate_vote.submission_save_v3(
    v_team_token,'91200000-0000-0000-0000-000000000021',v_items,
    (v_result->>'version')::bigint,
    '91200000-0000-4000-8000-000000000406',false);
  if v_unchanged_result->>'status'<>'draft'
     or (v_unchanged_result->>'version')::bigint<>(v_result->>'version')::bigint+1
     or (select count(*) from climate_vote.submission_item_archive a
          where a.submission_id='91200000-0000-0000-0000-000000000321'
            and a.ordinal=1)<>v_archive_after
     or (select count(*) from climate_vote.submission_item_archive a
          where a.submission_id='91200000-0000-0000-0000-000000000321'
            and a.ordinal=2)<>v_unchanged_archive_before then
    raise exception 'same-ordinal unchanged save appended archive: %',v_unchanged_result;
  end if;

  update climate_vote.discussion_topic set status=v_topic_status
   where id='91200000-0000-0000-0000-000000000021';

  return jsonb_build_object(
    'status','verified','item_id',v_item_id,'issue_id',p_issue_id,
    'version',(v_unchanged_result->>'version')::bigint);
end $fn$;
revoke execute on function climate_vote.p2a_verify_same_ordinal_save(uuid)
from public, anon, authenticated;
grant execute on function climate_vote.p2a_verify_same_ordinal_save(uuid)
to authenticated;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','91200000-0000-0000-0000-000000000201',
  'session_id','91200000-0000-0000-0000-000000000202')::text,true);
set local role authenticated;
do $staff_scope$
declare v_selection jsonb; v_context text; v_result jsonb; v_count int;
  v_src uuid; v_dst uuid; v_draft uuid; v_publish jsonb; v_publish_again jsonb;
  v_result_token text; v_implementation jsonb; v_implementation_latest jsonb;
  v_implementation_conflict jsonb; v_canvas_round text; v_public jsonb;
  v_implementation_hash text; v_implementation_latest_hash text;
  v_implementation_key uuid:=gen_random_uuid();
  v_implementation_update_key uuid:=gen_random_uuid();
  v_implementation_stale_key uuid:=gen_random_uuid();
  v_implementation_body_before jsonb;
  v_reclass_plan jsonb; v_reclass_reverse jsonb; v_reclass_result jsonb;
  v_issue_view jsonb; v_issue_state_before jsonb;
  v_src_hash text; v_dst_hash text; v_stale_hash text;
  v_review_key uuid; v_merge_key uuid; v_merge_result jsonb;
  v_upsert_key uuid; v_upsert_result jsonb; v_stale_upsert_key uuid;
  v_reclass_key uuid:='91200000-0000-4000-8000-000000000404';
  v_canvas_snapshot_before jsonb; v_lifecycle_case text;
  v_canvas_create_key uuid:='91200000-0000-4000-8000-000000000401';
  v_canvas_active_key uuid:='91200000-0000-4000-8000-000000000402';
  v_canvas_close_key uuid:='91200000-0000-4000-8000-000000000403';
begin
  v_selection:=climate_vote.org_select('91200000-0000-0000-0000-000000000001');
  v_context:=v_selection->>'context_token';
  perform set_config('request.headers',jsonb_build_object(
    'x-platform-org-context',v_context)::text,true);

  v_result:=climate_vote.platform_readiness_check_v2(
    '91200000-0000-0000-0000-000000000003');
  if v_result is null or jsonb_typeof(v_result->'checks')<>'array' then
    raise exception 'staff scoped readiness contract mismatch: %',v_result;
  end if;
  begin
    perform climate_vote.platform_readiness_check_v2(
      '91200000-0000-0000-0000-000000000103');
    raise exception 'cross-organization readiness unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-organization readiness unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;

  v_canvas_snapshot_before:=climate_vote.p2a_verify_canvas_fixture('snapshot',null);
  foreach v_lifecycle_case in array array[
    'session_inactive','assembly_inactive','assembly_archived','org_inactive',
    'org_archived','null_expiry','expired'
  ] loop
    perform climate_vote.p2a_verify_canvas_fixture(v_lifecycle_case,null);
    begin
      perform * from climate_vote.platform_canvas_round_create_v2(
        '91200000-0000-0000-0000-000000000003','["blocked"]'::jsonb,
        gen_random_uuid());
      raise exception 'Canvas create accepted unavailable lifecycle: %',v_lifecycle_case;
    exception when others then
      if position('Canvas create accepted unavailable lifecycle' in sqlerrm)>0 then raise; end if;
      if position('inactive, archived, or outside' in sqlerrm)=0
         and position('selected organization scope' in sqlerrm)=0 then raise; end if;
    end;
    perform climate_vote.p2a_verify_canvas_fixture('restore',null);
  end loop;
  if climate_vote.p2a_verify_canvas_fixture('snapshot',null)<>v_canvas_snapshot_before then
    raise exception 'rejected Canvas create lifecycle changed round or audit state';
  end if;

  select id into v_canvas_round from climate_vote.platform_canvas_round_create_v2(
    '91200000-0000-0000-0000-000000000003','["Agenda A","Agenda B"]'::jsonb,
    v_canvas_create_key);
  if v_canvas_round!~'^AGV-[0-9a-f]{32}$'
     or (select id from climate_vote.platform_canvas_round_create_v2(
       '91200000-0000-0000-0000-000000000003','["Agenda A","Agenda B"]'::jsonb,
       v_canvas_create_key))<>v_canvas_round then
    raise exception 'Canvas round create/replay contract mismatch: %',v_canvas_round;
  end if;
  if (select id from climate_vote.platform_canvas_round_current_v2(
       '91200000-0000-0000-0000-000000000003'))<>v_canvas_round then
    raise exception 'Canvas current round was not reload-recoverable';
  end if;
  begin
    perform * from climate_vote.platform_canvas_round_create_v2(
      '91200000-0000-0000-0000-000000000003','["Another A","Another B"]'::jsonb,
      gen_random_uuid());
    raise exception 'second open Canvas round unexpectedly accepted';
  exception when others then
    if sqlerrm='second open Canvas round unexpectedly accepted' then raise; end if;
    if position('close the current canvas round' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform * from climate_vote.platform_canvas_round_create_v2(
      '91200000-0000-0000-0000-000000000003','["different"]'::jsonb,
      v_canvas_create_key);
    raise exception 'Canvas create payload conflict unexpectedly accepted';
  exception when others then
    if sqlerrm='Canvas create payload conflict unexpectedly accepted' then raise; end if;
    if position('idempotency conflict' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform * from climate_vote.platform_canvas_round_create_v2(
      '91200000-0000-0000-0000-000000000003','["duplicate"," duplicate "]'::jsonb,
      gen_random_uuid());
    raise exception 'duplicate Canvas labels unexpectedly accepted';
  exception when others then
    if sqlerrm='duplicate Canvas labels unexpectedly accepted' then raise; end if;
    if position('must be unique' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform * from climate_vote.platform_canvas_round_create_v2(
      '91200000-0000-0000-0000-000000000103','["wrong org"]'::jsonb,
      gen_random_uuid());
    raise exception 'cross-org Canvas create unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-org Canvas create unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;
  v_canvas_snapshot_before:=climate_vote.p2a_verify_canvas_fixture(
    'snapshot',v_canvas_round);
  foreach v_lifecycle_case in array array[
    'session_inactive','assembly_inactive','assembly_archived','org_inactive',
    'org_archived','null_expiry','expired'
  ] loop
    perform climate_vote.p2a_verify_canvas_fixture(v_lifecycle_case,v_canvas_round);
    begin
      perform climate_vote.platform_canvas_round_set_status_v2(
        '91200000-0000-0000-0000-000000000003',v_canvas_round,
        'pending','active',gen_random_uuid());
      raise exception 'Canvas start accepted unavailable lifecycle: %',v_lifecycle_case;
    exception when others then
      if position('Canvas start accepted unavailable lifecycle' in sqlerrm)>0 then raise; end if;
      if position('inactive, archived, or outside' in sqlerrm)=0
         and position('selected organization scope' in sqlerrm)=0 then raise; end if;
    end;
    perform climate_vote.p2a_verify_canvas_fixture('restore',v_canvas_round);
  end loop;
  if climate_vote.p2a_verify_canvas_fixture(
       'snapshot',v_canvas_round)<>v_canvas_snapshot_before then
    raise exception 'rejected Canvas start lifecycle changed round or audit state';
  end if;
  begin
    perform climate_vote.platform_canvas_round_set_status_v2(
      '91200000-0000-0000-0000-000000000003',v_canvas_round,null,'active',
      gen_random_uuid());
    raise exception 'NULL Canvas expected status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL Canvas expected status unexpectedly accepted' then raise; end if;
    if position('invalid canvas round status transition' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_canvas_round_set_status_v2(
      '91200000-0000-0000-0000-000000000003',v_canvas_round,'pending',null,
      gen_random_uuid());
    raise exception 'NULL Canvas target status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL Canvas target status unexpectedly accepted' then raise; end if;
    if position('invalid canvas round status transition' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.platform_canvas_round_current_v2(
       '91200000-0000-0000-0000-000000000003'))<>'pending' then
    raise exception 'NULL Canvas status input changed current recovery state';
  end if;
  v_result:=climate_vote.platform_canvas_round_set_status_v2(
    '91200000-0000-0000-0000-000000000003',v_canvas_round,'pending','active',
    v_canvas_active_key);
  if v_result->>'status'<>'active'
     or climate_vote.platform_canvas_round_set_status_v2(
       '91200000-0000-0000-0000-000000000003',v_canvas_round,'pending','active',
       v_canvas_active_key)<>v_result then
    raise exception 'Canvas pending-to-active replay contract mismatch: %',v_result;
  end if;
  v_result:=climate_vote.platform_canvas_round_set_status_v2(
    '91200000-0000-0000-0000-000000000003',v_canvas_round,'pending','active',
    gen_random_uuid());
  if v_result->>'status'<>'conflict' or v_result->>'current_status'<>'active' then
    raise exception 'Canvas new-key stale same-target CAS did not conflict: %',v_result;
  end if;
  begin
    perform climate_vote.platform_canvas_round_set_status_v2(
      '91200000-0000-0000-0000-000000000151',v_canvas_round,'active','closed',
      gen_random_uuid());
    raise exception 'cross-session Canvas status unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-session Canvas status unexpectedly accepted' then raise; end if;
    if position('outside selected staff session' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_canvas_round_set_status_v2(
      '91200000-0000-0000-0000-000000000003',v_canvas_round,'pending','closed',
      v_canvas_active_key);
    raise exception 'Canvas status request payload conflict unexpectedly accepted';
  exception when others then
    if sqlerrm='Canvas status request payload conflict unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  v_result:=climate_vote.platform_canvas_round_set_status_v2(
    '91200000-0000-0000-0000-000000000003',v_canvas_round,'pending','closed',
    gen_random_uuid());
  if v_result->>'status'<>'conflict' or v_result->>'current_status'<>'active' then
    raise exception 'Canvas stale status CAS did not conflict: %',v_result;
  end if;
  begin
    perform climate_vote.public_round_cast_v2(
      v_canvas_round,null,'p2a-canvas-null-choice');
    raise exception 'NULL Canvas public choice unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL Canvas public choice unexpectedly accepted' then raise; end if;
    if position('public vote choice required' in sqlerrm)=0 then raise; end if;
  end;
  select to_jsonb(public_round) into v_public
    from climate_vote.public_round_get_v2(v_canvas_round) public_round;
  if v_public is null or v_public ?| array['team_id','session_id','org_id','created_by']
     or climate_vote.public_round_cast_v2(v_canvas_round,
       '{"Agenda A":5,"Agenda B":3}'::jsonb,'p2a-canvas-device-1')<>'ok'
     or climate_vote.public_round_cast_v2(v_canvas_round,
       '{"Agenda A":5,"Agenda B":3}'::jsonb,'p2a-canvas-device-1')<>'duplicate' then
    raise exception 'Canvas public SCALE_MULTI positive/duplicate contract failed';
  end if;
  begin
    perform climate_vote.public_round_cast_v2(v_canvas_round,
      '{"Agenda A":6,"Agenda B":3}'::jsonb,'p2a-canvas-device-2');
    raise exception 'invalid Canvas scale unexpectedly accepted';
  exception when others then
    if sqlerrm='invalid Canvas scale unexpectedly accepted' then raise; end if;
    if position('invalid public vote choice' in sqlerrm)=0 then raise; end if;
  end;
  perform climate_vote.p2a_verify_canvas_fixture('expired',v_canvas_round);
  if (select status from climate_vote.platform_canvas_round_current_v2(
       '91200000-0000-0000-0000-000000000003'))<>'active' then
    raise exception 'expired Canvas round was not available for operator recovery';
  end if;
  v_result:=climate_vote.platform_canvas_round_set_status_v2(
    '91200000-0000-0000-0000-000000000003',v_canvas_round,'active','closed',
    v_canvas_close_key);
  if v_result->>'status'<>'closed'
     or (select max(total_votes) from climate_vote.public_round_votes_v2(v_canvas_round))<>1
     or (select average_score from climate_vote.public_round_votes_v2(v_canvas_round)
          where choice='"Agenda A"'::jsonb)<>5 then
    raise exception 'Canvas close/aggregate contract mismatch: %',v_result;
  end if;
  perform climate_vote.p2a_verify_canvas_fixture('restore',v_canvas_round);
  if exists(select 1 from climate_vote.platform_canvas_round_current_v2(
       '91200000-0000-0000-0000-000000000003')) then
    raise exception 'closed Canvas round remained in current recovery surface';
  end if;

  select count(*) into v_count
    from climate_vote.platform_ballot_list_v2('91200000-0000-0000-0000-000000000003');
  if v_count<>3 then raise exception 'staff ballot list contract mismatch: %',v_count; end if;
  v_result:=climate_vote.platform_ballot_results_v2(
    'p2a-draft-ballot-token-00000002','91200000-0000-0000-0000-000000000003');
  if v_result is null or v_result->>'status'<>'draft' then
    raise exception 'staff private ballot result unavailable: %',v_result;
  end if;
  if climate_vote.platform_ballot_results_v2(
       'p2a-other-ballot-token-00000003','91200000-0000-0000-0000-000000000003') is not null then
    raise exception 'staff cross-org ballot token disclosed through selected session';
  end if;

  begin
    perform climate_vote.platform_ballot_list_v2('91200000-0000-0000-0000-000000000103');
    raise exception 'staff cross-org session unexpectedly accepted';
  exception when others then
    if sqlerrm='staff cross-org session unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;

  v_upsert_key:=gen_random_uuid();
  v_result:=climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    '{"id":"91200000-0000-0000-0000-000000000331","label":"P2a source issue","stance":"proposal","frequency_class":"majority","summary":"Source"}'::jsonb,
    null,v_upsert_key);
  v_src:=(v_result->>'id')::uuid;
  if v_result->>'status'<>'applied'
     or (v_result->>'created')::boolean is not true
     or length(v_result->>'snapshot_hash')<>64 then
    raise exception 'staff issue create contract mismatch: %',v_result;
  end if;
  v_upsert_result:=climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    '{"id":"91200000-0000-0000-0000-000000000331","label":"P2a source issue","stance":"proposal","frequency_class":"majority","summary":"Source"}'::jsonb,
    null,v_upsert_key);
  if v_upsert_result<>v_result
     or jsonb_array_length((climate_vote.platform_issue_list_v2(
       '91200000-0000-0000-0000-000000000003',
       '91200000-0000-0000-0000-000000000021'))->'issues')<>1 then
    raise exception 'client-id issue create replay was not exact: %',v_upsert_result;
  end if;
  begin
    perform climate_vote.platform_issue_upsert_v3(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021',
      '{"id":"91200000-0000-0000-0000-000000000331","label":"tampered","stance":"proposal"}'::jsonb,
      null,v_upsert_key);
    raise exception 'issue upsert request key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='issue upsert request key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_issue_link_set_v2(
      '91200000-0000-0000-0000-000000000003',v_src,
      array['91200000-0000-0000-0000-000000000322'::uuid],null);
    raise exception 'retired non-atomic issue link RPC remained executable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform climate_vote.platform_issue_merge_v2(
      '91200000-0000-0000-0000-000000000003',v_src,v_src);
    raise exception 'retired non-CAS issue merge RPC remained executable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform climate_vote.platform_issue_review_v2(
      '91200000-0000-0000-0000-000000000003',v_src);
    raise exception 'retired non-CAS issue review RPC remained executable';
  exception when insufficient_privilege then null;
  end;
  v_result:=climate_vote.platform_issue_reclassify_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    jsonb_build_object('calls',jsonb_build_array(jsonb_build_object(
      'issue_id',v_src,
      'item_ids',jsonb_build_array('91200000-0000-0000-0000-000000000322'),
      'cluster_id',null,
      'expected_links','[]'::jsonb,
      'role','target'))),gen_random_uuid());
  if v_result->>'status'<>'applied'
     or (v_result->>'affected_issues')::int<>1
     or (v_result->>'linked_count')::int<>1 then
    raise exception 'atomic issue link seed contract mismatch: %',v_result;
  end if;
  v_result:=climate_vote.platform_issue_items_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  if jsonb_array_length(v_result->'items'->0->'links')<>1 then
    raise exception 'atomic issue link seed was not visible';
  end if;
  v_dst:='91200000-0000-0000-0000-000000000333';
  v_result:=climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    jsonb_build_object('id',v_dst,'label','P2a destination issue',
      'stance','proposal','frequency','consensus','summary','Destination'),
    null,gen_random_uuid());
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_stale_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_src::text;
  if v_stale_hash is null or length(v_stale_hash)<>64 then
    raise exception 'server issue snapshot hash missing from issue list';
  end if;

  -- A semantic edit committed after the browser read must make that browser's
  -- review request conflict without restoring reviewed state.
  v_upsert_result:=climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    jsonb_build_object('id',v_src,'label','P2a source issue',
      'stance','proposal','frequency_class','majority','summary','Source edited'),
    v_stale_hash,gen_random_uuid());
  if v_upsert_result->>'status'<>'applied'
     or (v_upsert_result->>'created')::boolean is not false
     or length(v_upsert_result->>'snapshot_hash')<>64 then
    raise exception 'issue semantic update contract mismatch: %',v_upsert_result;
  end if;
  v_issue_state_before:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  v_stale_upsert_key:=gen_random_uuid();
  v_upsert_result:=climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    jsonb_build_object('id',v_src,'label','P2a stale issue overwrite',
      'stance','proposal','frequency_class','majority','summary','Must not apply'),
    v_stale_hash,v_stale_upsert_key);
  if v_upsert_result->>'status'<>'conflict'
     or v_upsert_result->>'current_snapshot_hash' is null
     or climate_vote.platform_issue_list_v2(
       '91200000-0000-0000-0000-000000000003',
       '91200000-0000-0000-0000-000000000021')<>v_issue_state_before then
    raise exception 'stale issue upsert CAS mutated issue state: %',v_upsert_result;
  end if;
  if climate_vote.platform_issue_upsert_v3(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021',
      jsonb_build_object('id',v_src,'label','P2a stale issue overwrite',
        'stance','proposal','frequency_class','majority','summary','Must not apply'),
      v_stale_hash,v_stale_upsert_key)<>v_upsert_result then
    raise exception 'stale issue upsert conflict replay changed result';
  end if;
  v_review_key:=gen_random_uuid();
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_src,v_stale_hash,v_review_key);
  if v_result->>'status'<>'conflict'
     or v_result->>'conflict_issue_id'<>v_src::text
     or climate_vote.platform_issue_list_v2(
       '91200000-0000-0000-0000-000000000003',
       '91200000-0000-0000-0000-000000000021')<>v_issue_state_before then
    raise exception 'stale semantic-edit review mutated issue state: %',v_result;
  end if;
  if climate_vote.platform_issue_review_v3(
      '91200000-0000-0000-0000-000000000003',v_src,v_stale_hash,v_review_key)
      <>v_result then
    raise exception 'stale issue review replay changed conflict result';
  end if;
  begin
    perform climate_vote.platform_issue_review_v3(
      '91200000-0000-0000-0000-000000000003',v_src,repeat('0',64),v_review_key);
    raise exception 'issue review request key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='issue review request key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;

  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_src_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_src::text;
  select issue->>'snapshot_hash' into v_dst_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_src,v_src_hash,gen_random_uuid());
  if v_result->>'status'<>'applied' or v_result->>'review_status'<>'reviewed' then
    raise exception 'source issue snapshot review failed: %',v_result;
  end if;
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_dst,v_dst_hash,gen_random_uuid());
  if v_result->>'status'<>'applied' or v_result->>'review_status'<>'reviewed' then
    raise exception 'destination issue snapshot review failed: %',v_result;
  end if;
  v_reclass_plan:=jsonb_build_object('calls',jsonb_build_array(
    jsonb_build_object(
      'issue_id',v_dst,'item_ids',jsonb_build_array(
        '91200000-0000-0000-0000-000000000322',
        '91200000-0000-0000-0000-000000000323'),
      'cluster_id',null,'expected_links','[]'::jsonb,'role','target'),
    jsonb_build_object(
      'issue_id',v_src,'item_ids','[]'::jsonb,'cluster_id',null,
      'expected_links',jsonb_build_array(jsonb_build_object(
        'item_id','91200000-0000-0000-0000-000000000322',
        'cluster_id',null,'linked_by','human')),'role','source')));
  v_reclass_result:=climate_vote.platform_issue_reclassify_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',v_reclass_plan,v_reclass_key);
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  if v_reclass_result->>'status'<>'applied'
     or (v_reclass_result->>'affected_issues')::int<>2
     or (v_reclass_result->>'linked_count')::int<>2
     or (select count(*) from jsonb_array_elements(v_issue_view->'issues') issue
          where (issue->>'id')::uuid=any(array[v_src,v_dst]))<>2
     or (select (issue->>'linked_item_count')::int
          from jsonb_array_elements(v_issue_view->'issues') issue
          where issue->>'id'=v_src::text)<>0
     or (select (issue->>'linked_item_count')::int
          from jsonb_array_elements(v_issue_view->'issues') issue
          where issue->>'id'=v_dst::text)<>2
     or exists(select 1 from jsonb_array_elements(v_issue_view->'issues') issue
       where (issue->>'id')::uuid=any(array[v_src,v_dst])
         and (issue->>'review_status'<>'draft'
           or issue->>'reviewed_by' is not null
           or issue->>'reviewed_at' is not null)) then
    raise exception 'atomic issue reclassification contract mismatch: %',v_reclass_result;
  end if;
  if climate_vote.platform_issue_reclassify_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021',v_reclass_plan,v_reclass_key)
      <>v_reclass_result then
    raise exception 'atomic issue reclassification replay changed result';
  end if;
  begin
    perform climate_vote.platform_issue_reclassify_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021',
      v_reclass_plan||jsonb_build_object('tampered',true),v_reclass_key);
    raise exception 'atomic issue reclassification request key reuse unexpectedly accepted';
  exception when others then
    if sqlerrm='atomic issue reclassification request key reuse unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  v_issue_state_before:=jsonb_build_object(
    'issues',climate_vote.platform_issue_list_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'),
    'items',climate_vote.platform_issue_items_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'));
  v_result:=climate_vote.platform_issue_reclassify_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',v_reclass_plan,gen_random_uuid());
  if v_result->>'status'<>'conflict'
     or jsonb_build_object(
       'issues',climate_vote.platform_issue_list_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'),
       'items',climate_vote.platform_issue_items_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'))<>v_issue_state_before then
    raise exception 'stale atomic reclassification CAS changed links: %',v_result;
  end if;
  begin
    perform climate_vote.platform_issue_reclassify_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021',
      jsonb_build_object('calls',jsonb_build_array(
        jsonb_build_object(
          'issue_id',v_dst,'item_ids',jsonb_build_array(
            '91200000-0000-0000-0000-000000000322',
            '91200000-0000-0000-0000-000000000323'),
          'cluster_id',null,'expected_links',jsonb_build_array(
            jsonb_build_object('item_id','91200000-0000-0000-0000-000000000322',
              'cluster_id',null,'linked_by','human'),
            jsonb_build_object('item_id','91200000-0000-0000-0000-000000000323',
              'cluster_id',null,'linked_by','human')),'role','target'),
        jsonb_build_object(
          'issue_id','91200000-0000-0000-0000-000000000108',
          'item_ids','[]'::jsonb,'cluster_id',null,
          'expected_links','[]'::jsonb,'role','source'))),gen_random_uuid());
    raise exception 'cross-organization atomic reclassification unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-organization atomic reclassification unexpectedly accepted' then raise; end if;
    if position('issue not in selected staff topic' in sqlerrm)=0 then raise; end if;
  end;
  if jsonb_build_object(
       'issues',climate_vote.platform_issue_list_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'),
       'items',climate_vote.platform_issue_items_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'))<>v_issue_state_before then
    raise exception 'failed atomic reclassification partially changed destination links';
  end if;
  begin
    perform climate_vote.platform_issue_reclassify_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021',
      jsonb_build_object('calls',jsonb_build_array(jsonb_build_object(
        'issue_id',v_dst,'item_ids',jsonb_build_array(
          '91200000-0000-0000-0000-000000000107'),
        'cluster_id',null,'expected_links',jsonb_build_array(
          jsonb_build_object('item_id','91200000-0000-0000-0000-000000000322',
            'cluster_id',null,'linked_by','human'),
          jsonb_build_object('item_id','91200000-0000-0000-0000-000000000323',
            'cluster_id',null,'linked_by','human')),'role','target'))),gen_random_uuid());
    raise exception 'foreign item atomic reclassification unexpectedly accepted';
  exception when others then
    if sqlerrm='foreign item atomic reclassification unexpectedly accepted' then raise; end if;
    if position('not in selected staff topic' in sqlerrm)=0 then raise; end if;
  end;
  if jsonb_build_object(
       'issues',climate_vote.platform_issue_list_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'),
       'items',climate_vote.platform_issue_items_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'))<>v_issue_state_before then
    raise exception 'failed foreign-item reclassification changed issue state';
  end if;
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_stale_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  v_reclass_reverse:=jsonb_build_object('calls',jsonb_build_array(
    jsonb_build_object(
      'issue_id',v_src,'item_ids',jsonb_build_array(
        '91200000-0000-0000-0000-000000000322'),
      'cluster_id',null,'expected_links','[]'::jsonb,'role','target'),
    jsonb_build_object(
      'issue_id',v_dst,'item_ids',jsonb_build_array(
        '91200000-0000-0000-0000-000000000323'),
      'cluster_id',null,'expected_links',jsonb_build_array(
        jsonb_build_object('item_id','91200000-0000-0000-0000-000000000322',
          'cluster_id',null,'linked_by','human'),
        jsonb_build_object('item_id','91200000-0000-0000-0000-000000000323',
          'cluster_id',null,'linked_by','human')),'role','source')));
  v_result:=climate_vote.platform_issue_reclassify_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',v_reclass_reverse,gen_random_uuid());
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  if v_result->>'status'<>'applied'
     or (select (issue->>'linked_item_count')::int
          from jsonb_array_elements(v_issue_view->'issues') issue
          where issue->>'id'=v_src::text)<>1
     or (select (issue->>'linked_item_count')::int
          from jsonb_array_elements(v_issue_view->'issues') issue
          where issue->>'id'=v_dst::text)<>1 then
    raise exception 'atomic issue reclassification restore mismatch: %',v_result;
  end if;

  -- A link reclassification committed after the browser read must make a
  -- pending review conflict and leave the new draft/link state untouched.
  v_issue_state_before:=jsonb_build_object(
    'issues',climate_vote.platform_issue_list_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'),
    'items',climate_vote.platform_issue_items_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'));
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_dst,v_stale_hash,gen_random_uuid());
  if v_result->>'status'<>'conflict'
     or jsonb_build_object(
       'issues',climate_vote.platform_issue_list_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'),
       'items',climate_vote.platform_issue_items_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'))<>v_issue_state_before then
    raise exception 'stale reclassification review changed issue state: %',v_result;
  end if;

  -- Both sides of merge have independent snapshot CAS. First make the source
  -- stale, then the destination stale, and assert neither conflict moves links
  -- or archives a row.
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_src_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_src::text;
  select issue->>'snapshot_hash' into v_dst_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  perform climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    jsonb_build_object('id',v_src,'label','P2a source issue',
      'stance','proposal','frequency_class','majority','summary','Source changed before merge'),
    v_src_hash,gen_random_uuid());
  v_issue_state_before:=jsonb_build_object(
    'issues',climate_vote.platform_issue_list_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'),
    'items',climate_vote.platform_issue_items_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'));
  v_merge_key:=gen_random_uuid();
  v_result:=climate_vote.platform_issue_merge_v3(
    '91200000-0000-0000-0000-000000000003',v_src,v_dst,
    v_src_hash,v_dst_hash,v_merge_key);
  if v_result->>'status'<>'conflict'
     or v_result->>'conflict_issue_id'<>v_src::text
     or jsonb_build_object(
       'issues',climate_vote.platform_issue_list_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'),
       'items',climate_vote.platform_issue_items_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'))<>v_issue_state_before then
    raise exception 'stale source merge mutated issue state: %',v_result;
  end if;
  if climate_vote.platform_issue_merge_v3(
      '91200000-0000-0000-0000-000000000003',v_src,v_dst,
      v_src_hash,v_dst_hash,v_merge_key)<>v_result then
    raise exception 'stale source merge replay changed result';
  end if;
  begin
    perform climate_vote.platform_issue_merge_v3(
      '91200000-0000-0000-0000-000000000003',v_src,v_dst,
      repeat('0',64),v_dst_hash,v_merge_key);
    raise exception 'merge request key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='merge request key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;

  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_src_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_src::text;
  select issue->>'snapshot_hash' into v_dst_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  perform climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    jsonb_build_object('id',v_dst,'label','P2a destination issue',
      'stance','proposal','frequency_class','consensus','summary','Destination changed before merge'),
    v_dst_hash,gen_random_uuid());
  v_issue_state_before:=jsonb_build_object(
    'issues',climate_vote.platform_issue_list_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'),
    'items',climate_vote.platform_issue_items_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021'));
  v_result:=climate_vote.platform_issue_merge_v3(
    '91200000-0000-0000-0000-000000000003',v_src,v_dst,
    v_src_hash,v_dst_hash,gen_random_uuid());
  if v_result->>'status'<>'conflict'
     or v_result->>'conflict_issue_id'<>v_dst::text
     or jsonb_build_object(
       'issues',climate_vote.platform_issue_list_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'),
       'items',climate_vote.platform_issue_items_v2(
         '91200000-0000-0000-0000-000000000003',
         '91200000-0000-0000-0000-000000000021'))<>v_issue_state_before then
    raise exception 'stale destination merge mutated issue state: %',v_result;
  end if;

  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_src_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_src::text;
  select issue->>'snapshot_hash' into v_dst_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  v_merge_key:=gen_random_uuid();
  v_merge_result:=climate_vote.platform_issue_merge_v3(
    '91200000-0000-0000-0000-000000000003',v_src,v_dst,
    v_src_hash,v_dst_hash,v_merge_key);
  if v_merge_result->>'status'<>'applied'
     or v_merge_result->>'src'<>v_src::text
     or (v_merge_result->>'moved')::int<>1 then
    raise exception 'staff issue merge contract mismatch: %',v_merge_result;
  end if;
  if climate_vote.platform_issue_merge_v3(
      '91200000-0000-0000-0000-000000000003',v_src,v_dst,
      v_src_hash,v_dst_hash,v_merge_key)<>v_merge_result then
    raise exception 'successful merge replay failed after source archive';
  end if;
  begin
    perform climate_vote.platform_issue_merge_v3(
      '91200000-0000-0000-0000-000000000003',v_src,v_dst,
      v_src_hash,repeat('0',64),v_merge_key);
    raise exception 'archived-source merge key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='archived-source merge key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;

  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_dst_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  v_review_key:=gen_random_uuid();
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_dst,v_dst_hash,v_review_key);
  if v_result->>'status'<>'applied' or v_result->>'review_status'<>'reviewed' then
    raise exception 'staff issue review contract mismatch: %',v_result;
  end if;
  if climate_vote.platform_issue_review_v3(
      '91200000-0000-0000-0000-000000000003',v_dst,v_dst_hash,v_review_key)
      <>v_result then
    raise exception 'staff issue review replay changed result';
  end if;
  v_result:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  if (v_result->>'reviewed_count')::int<>1
     or jsonb_array_length(v_result->'issues')<>1 then
    raise exception 'staff issue list contract mismatch: %',v_result;
  end if;
  v_result:=climate_vote.platform_issue_items_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  if jsonb_array_length(v_result->'items')<>2
     or exists(select 1 from jsonb_array_elements(v_result->'items') item
       where jsonb_array_length(item->'links')<>1) then
    raise exception 'staff issue items contract mismatch: %',v_result;
  end if;

  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_stale_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  v_result:=climate_vote.p2a_verify_same_ordinal_save(v_dst);
  if v_result->>'status'<>'verified'
     or v_result->>'item_id'<>'91200000-0000-0000-0000-000000000322'
     or v_result->>'issue_id'<>v_dst::text then
    raise exception 'same-ordinal verifier result mismatch: %',v_result;
  end if;
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  if (v_issue_view->>'reviewed_count')::int<>0
     or not exists(select 1 from jsonb_array_elements(v_issue_view->'issues') issue
       where issue->>'id'=v_dst::text and issue->>'review_status'='draft'
         and issue->>'reviewed_by' is null and issue->>'reviewed_at' is null) then
    raise exception 'same-ordinal invalidation was not visible to staff: %',v_issue_view;
  end if;
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_dst,v_stale_hash,gen_random_uuid());
  if v_result->>'status'<>'conflict'
     or climate_vote.platform_issue_list_v2(
       '91200000-0000-0000-0000-000000000003',
       '91200000-0000-0000-0000-000000000021')<>v_issue_view then
    raise exception 'stale source-edit review restored reviewed state: %',v_result;
  end if;
  begin
    perform climate_vote.platform_result_publish_v2(
      '91200000-0000-0000-0000-000000000003','topic',
      '91200000-0000-0000-0000-000000000021',
      'same-ordinal source changed before review');
    raise exception 'same-ordinal publish unexpectedly succeeded before re-review';
  exception when others then
    if sqlerrm='same-ordinal publish unexpectedly succeeded before re-review' then raise; end if;
    if position('no reviewed issue in scope' in sqlerrm)=0 then raise; end if;
  end;
  v_issue_view:=climate_vote.platform_issue_list_v2(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021');
  select issue->>'snapshot_hash' into v_dst_hash
    from jsonb_array_elements(v_issue_view->'issues') issue
   where issue->>'id'=v_dst::text;
  v_result:=climate_vote.platform_issue_review_v3(
    '91200000-0000-0000-0000-000000000003',v_dst,v_dst_hash,gen_random_uuid());
  if v_result->>'status'<>'applied' or v_result->>'review_status'<>'reviewed' then
    raise exception 'same-ordinal issue could not be re-reviewed: %',v_result;
  end if;

  -- A draft in the same publish scope must remain private even when another
  -- reviewed issue satisfies the publish gate.
  v_result:=climate_vote.platform_issue_upsert_v3(
    '91200000-0000-0000-0000-000000000003',
    '91200000-0000-0000-0000-000000000021',
    '{"id":"91200000-0000-0000-0000-000000000332","label":"P2a draft exclusion issue","stance":"proposal","frequency_class":"minority","summary":"Must not publish"}'::jsonb,
    null,gen_random_uuid());
  v_draft:=(v_result->>'id')::uuid;

  begin
    perform climate_vote.platform_result_publish_v2(
      '91200000-0000-0000-0000-000000000003',null,
      '91200000-0000-0000-0000-000000000021','NULL scope');
    raise exception 'NULL publish scope unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL publish scope unexpectedly accepted' then raise; end if;
    if position('invalid scope' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_result_publish_v2(
      '91200000-0000-0000-0000-000000000003','topic',null,'NULL scope id');
    raise exception 'NULL publish scope id unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL publish scope id unexpectedly accepted' then raise; end if;
    if position('scope id required' in sqlerrm)=0 then raise; end if;
  end;
  v_publish:=climate_vote.platform_result_publish_v2(
    '91200000-0000-0000-0000-000000000003','topic',
    '91200000-0000-0000-0000-000000000021','P2a published staff result');
  v_result_token:=v_publish->>'token';
  if length(v_result_token)<>32 or (v_publish->>'reviewed_count')::int<>1 then
    raise exception 'staff result publish contract mismatch: %',v_publish;
  end if;
  v_result:=climate_vote.result_get(v_result_token);
  if jsonb_array_length(v_result->'body'->'issues')<>1
     or exists(select 1 from jsonb_array_elements(v_result->'body'->'issues') issue_row
       where issue_row->>'review_status'<>'reviewed')
     or exists(select 1 from jsonb_array_elements(v_result->'body'->'issues') issue_row
       where issue_row->>'id'=v_draft::text) then
    raise exception 'published result included a draft issue: %',v_result;
  end if;
  begin
    perform climate_vote.platform_result_implementation_upsert_v2(
      '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
      '{"status":"planned","responsible_body":"retired","updated_at":"2026-09-05T00:00:00.000Z","summary":"Must not execute","evidence_url":null}'::jsonb);
    raise exception 'last-write-wins implementation v2 remained executable';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform climate_vote.platform_result_implementation_upsert_v3(
      '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
      '{"responsible_body":"P2a climate office","updated_at":"2026-09-05T00:00:00.000Z","summary":"Missing status","evidence_url":null}'::jsonb,
      null,gen_random_uuid());
    raise exception 'NULL implementation status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL implementation status unexpectedly accepted' then raise; end if;
    if position('invalid implementation status' in sqlerrm)=0 then raise; end if;
  end;
  v_implementation:=climate_vote.platform_result_implementation_upsert_v3(
    '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
    '{"status":"planned","responsible_body":"P2a climate office","updated_at":"2026-09-05T00:00:00.000Z","summary":"Synthetic implementation plan","evidence_url":null}'::jsonb,
    null,v_implementation_key);
  v_implementation_hash:=v_implementation->>'snapshot_hash';
  if v_implementation->>'status'<>'applied'
     or v_implementation->>'issue_id'<>v_dst::text
     or (v_implementation->>'event_id') is null
     or v_implementation_hash!~'^[0-9a-f]{64}$' then
    raise exception 'staff implementation v3 upsert contract mismatch: %',v_implementation;
  end if;
  v_result:=climate_vote.platform_result_implementation_upsert_v3(
    '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
    '{"status":"planned","responsible_body":"P2a climate office","updated_at":"2026-09-05T00:00:00.000Z","summary":"Synthetic implementation plan","evidence_url":null}'::jsonb,
    null,v_implementation_key);
  if v_result<>v_implementation then
    raise exception 'implementation exact replay changed result or event identity';
  end if;
  begin
    perform climate_vote.platform_result_implementation_upsert_v3(
      '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
      '{"status":"planned","responsible_body":"P2a climate office","updated_at":"2026-09-05T00:00:00.000Z","summary":"Different request payload","evidence_url":null}'::jsonb,
      null,v_implementation_key);
    raise exception 'implementation request key payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='implementation request key payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;

  v_implementation_latest:=climate_vote.platform_result_implementation_upsert_v3(
    '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
    '{"status":"in_progress","responsible_body":"P2a climate office","updated_at":"2026-09-05T01:00:00Z","summary":"Synthetic implementation underway","evidence_url":null}'::jsonb,
    v_implementation_hash,v_implementation_update_key);
  v_implementation_latest_hash:=v_implementation_latest->>'snapshot_hash';
  if v_implementation_latest->>'status'<>'applied'
     or v_implementation_latest_hash!~'^[0-9a-f]{64}$'
     or v_implementation_latest_hash=v_implementation_hash then
    raise exception 'implementation semantic update contract mismatch: %',v_implementation_latest;
  end if;
  -- The first request must remain an exact replay even after a later write.
  v_result:=climate_vote.platform_result_implementation_upsert_v3(
    '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
    '{"status":"planned","responsible_body":"P2a climate office","updated_at":"2026-09-05T00:00:00.000Z","summary":"Synthetic implementation plan","evidence_url":null}'::jsonb,
    null,v_implementation_key);
  if v_result<>v_implementation then
    raise exception 'implementation lost-response replay changed after later update';
  end if;

  v_implementation_body_before:=climate_vote.result_get(v_result_token)->'body';
  v_implementation_conflict:=climate_vote.platform_result_implementation_upsert_v3(
    '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
    '{"status":"implemented","responsible_body":"P2a climate office","updated_at":"2026-09-05T02:00:00.000Z","summary":"Stale write must not land","evidence_url":"https://example.invalid/evidence"}'::jsonb,
    v_implementation_hash,v_implementation_stale_key);
  if v_implementation_conflict->>'status'<>'conflict'
     or v_implementation_conflict->>'current_snapshot_hash'<>v_implementation_latest_hash
     or climate_vote.result_get(v_result_token)->'body'<>v_implementation_body_before then
    raise exception 'stale implementation CAS mutated body or audit history: %',
      v_implementation_conflict;
  end if;
  v_result:=climate_vote.platform_result_implementation_upsert_v3(
    '91200000-0000-0000-0000-000000000003',v_result_token,v_dst,
    '{"status":"implemented","responsible_body":"P2a climate office","updated_at":"2026-09-05T02:00:00.000Z","summary":"Stale write must not land","evidence_url":"https://example.invalid/evidence"}'::jsonb,
    v_implementation_hash,v_implementation_stale_key);
  if v_result<>v_implementation_conflict then
    raise exception 'stale implementation conflict replay changed result';
  end if;
  v_result:=climate_vote.result_get(v_result_token);
  if v_result->'body'->'issues'->0->'implementation'->>'status'<>'in_progress'
     or v_result->'body'->'issues'->0->'implementation'->>'snapshot_hash'
        <>v_implementation_latest_hash then
    raise exception 'implementation snapshot hash was not published: %',v_result;
  end if;
  v_publish_again:=climate_vote.platform_result_publish_v2(
    '91200000-0000-0000-0000-000000000003','topic',
    '91200000-0000-0000-0000-000000000021','P2a republished staff result');
  if v_publish_again->>'token'<>v_result_token
     or climate_vote.result_get(v_result_token)->'body'->'issues'->0
          ->'implementation'->>'status'<>'in_progress'
     or climate_vote.result_get(v_result_token)->'body'->'issues'->0
          ->'implementation'->>'snapshot_hash'<>v_implementation_latest_hash then
    raise exception 'republish did not preserve implementation history';
  end if;
  v_result:=climate_vote.platform_result_publish_v2(
    '91200000-0000-0000-0000-000000000003','assembly',
    '91200000-0000-0000-0000-000000000002','P2a assembly anchored result');
  if length(v_result->>'token')<>32 then
    raise exception 'same-assembly session anchor publish failed: %',v_result;
  end if;

  begin
    perform climate_vote.platform_issue_list_v2(
      '91200000-0000-0000-0000-000000000103',
      '91200000-0000-0000-0000-000000000104');
    raise exception 'staff cross-org issue read unexpectedly accepted';
  exception when others then
    if sqlerrm='staff cross-org issue read unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_issue_upsert_v3(
      '91200000-0000-0000-0000-000000000103',
      '91200000-0000-0000-0000-000000000104',
      '{"id":"91200000-0000-0000-0000-000000000334","label":"cross org"}'::jsonb,
      null,gen_random_uuid());
    raise exception 'staff cross-org issue mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='staff cross-org issue mutation unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_result_publish_v2(
      '91200000-0000-0000-0000-000000000103','assembly',
      '91200000-0000-0000-0000-000000000102','cross org publish');
    raise exception 'staff cross-org result publish unexpectedly accepted';
  exception when others then
    if sqlerrm='staff cross-org result publish unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_result_unpublish_v2(
      '91200000-0000-0000-0000-000000000103',(v_publish->>'id')::uuid);
    raise exception 'staff cross-org result unpublish unexpectedly accepted';
  exception when others then
    if sqlerrm='staff cross-org result unpublish unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.platform_result_implementation_upsert_v3(
      '91200000-0000-0000-0000-000000000103',v_result_token,v_dst,
      '{"status":"planned","responsible_body":"Cross org","updated_at":"2026-09-05T00:00:00.000Z","summary":"Must fail","evidence_url":null}'::jsonb,
      null,gen_random_uuid());
    raise exception 'staff cross-org implementation write unexpectedly accepted';
  exception when others then
    if sqlerrm='staff cross-org implementation write unexpectedly accepted' then raise; end if;
    if position('selected organization scope' in sqlerrm)=0 then raise; end if;
  end;

  v_result:=climate_vote.platform_result_unpublish_v2(
    '91200000-0000-0000-0000-000000000003',(v_publish->>'id')::uuid);
  if v_result->>'published_at' is not null or climate_vote.result_get(v_result_token) is not null then
    raise exception 'staff result unpublish contract mismatch: %',v_result;
  end if;
  if climate_vote.platform_result_unpublish_v2(
      '91200000-0000-0000-0000-000000000003',(v_publish->>'id')::uuid)<>v_result then
    raise exception 'staff result unpublish replay changed result';
  end if;
end $staff_scope$;
reset role;

do $linked_clear_cas$
declare
  v_hq text;
  v_team_token text;
  v_before bigint;
  v_clear jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_stale jsonb;
  v_expected jsonb;
  v_clear_key uuid:=gen_random_uuid();
begin
  select version into v_before from climate_vote.submission
   where id='91200000-0000-0000-0000-000000000321';
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version)
           order by s.id),'[]'::jsonb)
    into v_expected
    from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
   where dt.session_id='91200000-0000-0000-0000-000000000003'
     and s.archived_at is null;
  v_hq:=climate_vote.attendance_issue_token('hq',null,'P2a verify operator');
  begin
    perform climate_vote.hq_clear_submissions_v3(
      v_hq,'0912-deliberation','전체 비우기',v_expected,v_clear_key);
    raise exception 'linked P2a source clear unexpectedly succeeded';
  exception when others then
    if sqlerrm='linked P2a source clear unexpectedly succeeded' then raise; end if;
    if position('분석에 연결된 원문' in sqlerrm)=0 then raise; end if;
  end;
  if not exists(select 1 from climate_vote.submission_item
      where id='91200000-0000-0000-0000-000000000322')
     or (select version from climate_vote.submission
       where id='91200000-0000-0000-0000-000000000321')<>v_before then
    raise exception 'failed linked clear mutated source or CAS version';
  end if;
  delete from climate_vote.issue_link
   where item_id in (
     '91200000-0000-0000-0000-000000000322',
     '91200000-0000-0000-0000-000000000323');
  v_clear:=climate_vote.hq_clear_submissions_v3(
    v_hq,'0912-deliberation','전체 비우기',v_expected,v_clear_key);
  if v_clear->>'status'<>'applied' or (v_clear->>'cleared_items')::int<1
     or (select version from climate_vote.submission
       where id='91200000-0000-0000-0000-000000000321')<>v_before+1
     or exists(select 1 from climate_vote.submission_item
       where id='91200000-0000-0000-0000-000000000322') then
    raise exception 'unlinked clear did not delete source and advance CAS: %',v_clear;
  end if;
  v_replay:=climate_vote.hq_clear_submissions_v3(
    v_hq,'0912-deliberation','전체 비우기',v_expected,v_clear_key);
  if v_replay<>v_clear then
    raise exception 'clear exact replay changed result: first %, replay %',v_clear,v_replay;
  end if;
  begin
    perform climate_vote.hq_clear_submissions_v3(
      v_hq,'0912-deliberation','전체 비우기','[]'::jsonb,v_clear_key);
    raise exception 'clear idempotency payload mismatch unexpectedly accepted';
  exception when others then
    if sqlerrm='clear idempotency payload mismatch unexpectedly accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  v_conflict:=climate_vote.hq_clear_submissions_v3(
    v_hq,'0912-deliberation','전체 비우기',v_expected,gen_random_uuid());
  if v_conflict->>'status'<>'conflict'
     or v_conflict->'expected_submissions'<>v_expected then
    raise exception 'stale exact-set clear did not conflict: %',v_conflict;
  end if;
  update climate_vote.discussion_topic set status='open'
   where id='91200000-0000-0000-0000-000000000021';
  v_team_token:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011','P2a stale clear verifier');
  update climate_vote.attendance_auth_session set purpose='workshop',device_id=gen_random_uuid()
   where token_hash=encode(extensions.digest(v_team_token,'sha256'),'hex');
  v_stale:=climate_vote.submission_save_v3(v_team_token,
    '91200000-0000-0000-0000-000000000021',
    '[{"ordinal":1,"kind":"core","content":"stale restore"}]'::jsonb,
    v_before,gen_random_uuid(),false);
  if v_stale->>'status'<>'conflict'
     or exists(select 1 from climate_vote.submission_item
       where submission_id='91200000-0000-0000-0000-000000000321'
         and content='stale restore') then
    raise exception 'stale pre-clear CAS restored deleted source: %',v_stale;
  end if;
end $linked_clear_cas$;

do $staff_state_owner_assertions$
begin
  if (select count(*) from climate_vote.result_page
      where scope='topic' and scope_id='91200000-0000-0000-0000-000000000021'
        and org_id='91200000-0000-0000-0000-000000000001'
        and archived_at is null)<>1 then
    raise exception 'serialized repeated publish created duplicate result rows';
  end if;
  if (select count(*) from climate_vote.result_implementation_event
      where org_id='91200000-0000-0000-0000-000000000001')<>2 then
    raise exception 'implementation writes did not append exactly two audit events';
  end if;
  if (select count(*) from climate_vote.platform_canvas_round_event
      where round_id='AGV-91200000000040008000000000000401')<>3
     or exists(select 1 from climate_vote.platform_canvas_round_event
       where round_id='AGV-91200000000040008000000000000401'
         and actor_user_id<>'91200000-0000-0000-0000-000000000201') then
    raise exception 'Canvas create/status audit trail mismatch';
  end if;
  begin
    update climate_vote.platform_canvas_round_event set after_status='pending'
     where round_id='AGV-91200000000040008000000000000401';
    raise exception 'Canvas audit update unexpectedly allowed';
  exception when others then
    if sqlerrm='Canvas audit update unexpectedly allowed' then raise; end if;
    if position('append-only' in sqlerrm)=0 then raise; end if;
  end;
end $staff_state_owner_assertions$;

insert into auth.users(id,email,email_confirmed_at,confirmed_at)
values('91200000-0000-0000-0000-000000000204','p2a-facilitator@example.invalid',now(),now());
insert into climate_vote.membership(id,org_id,user_id,role,status)
values('91200000-0000-0000-0000-000000000214','91200000-0000-0000-0000-000000000001',
  '91200000-0000-0000-0000-000000000204','facilitator','active');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','91200000-0000-0000-0000-000000000204',
  'session_id','91200000-0000-0000-0000-000000000205')::text,true);
set local role authenticated;
do $wrong_canvas_role$
declare v_selection jsonb;
begin
  v_selection:=climate_vote.org_select('91200000-0000-0000-0000-000000000001');
  perform set_config('request.headers',jsonb_build_object(
    'x-platform-org-context',v_selection->>'context_token')::text,true);
  begin
    perform * from climate_vote.platform_canvas_round_create_v2(
      '91200000-0000-0000-0000-000000000003','["not allowed"]'::jsonb,
      gen_random_uuid());
    raise exception 'facilitator Canvas create unexpectedly accepted';
  exception when others then
    if sqlerrm='facilitator Canvas create unexpectedly accepted' then raise; end if;
    if position('staff role is not allowed' in sqlerrm)=0 then raise; end if;
  end;
end $wrong_canvas_role$;
reset role;

insert into auth.users(id,email,email_confirmed_at,confirmed_at)
values('91200000-0000-0000-0000-000000000202','p2a-nonmember@example.invalid',now(),now());
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','91200000-0000-0000-0000-000000000202',
  'session_id','91200000-0000-0000-0000-000000000203')::text,true);
select set_config('request.headers','{}',true);
set local role authenticated;
do $nonmember$
begin
  begin
    perform climate_vote.platform_issue_list_v2(
      '91200000-0000-0000-0000-000000000003',
      '91200000-0000-0000-0000-000000000021');
    raise exception 'nonmember staff issue read unexpectedly accepted';
  exception when others then
    if sqlerrm='nonmember staff issue read unexpectedly accepted' then raise; end if;
    if position('active organization membership required' in sqlerrm)=0 then raise; end if;
  end;
end $nonmember$;
reset role;

rollback;

select 'platform P2a token-only activation verification passed' as result;
