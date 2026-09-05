-- Disposable verification after the P2a activation rollback.

begin;
grant usage on schema climate_vote to anon, authenticated;

do $acl$
declare v_name text;
begin
  -- Explicitly enumerate the high-risk legacy surface restored for emergency
  -- compatibility. The post-cutover verifier owns the stricter complete
  -- allowlist; rollback must still prove that no routine is exposed to PUBLIC.
  foreach v_name in array array[
    'climate_vote.mod_join(text)',
    'climate_vote.topic_set_deadline(text,uuid,timestamp with time zone)',
    'climate_vote.readiness_check(uuid)',
    'climate_vote.org_of_code(text)',
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
    'climate_vote.submission_save_v2(text,uuid,jsonb)',
    'climate_vote.submission_finalize_hq(text,uuid,text)',
    'climate_vote.issue_review(text,uuid)',
    'climate_vote.result_publish(text,text,uuid,text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'activation rollback privilege mismatch; activation rollback did not restore PostgREST execute: %',v_name;
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
      raise exception 'rollback damaged public ballot/result capability: %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.mod_exchange_join_code(text,uuid,text)',
    'climate_vote.attendance_round_eligible_count_v2(text,text)',
    'climate_vote.mod_create_round_v2(text,text,text,jsonb)',
    'climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid)',
    'climate_vote.mod_set_round_status_v2(text,text,text)',
    'climate_vote.mod_set_round_status_v3(text,text,text,text,uuid)',
    'climate_vote.ballot_create_v2(text,text,text,jsonb,text)',
    'climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid)',
    'climate_vote.mod_proxy_vote_v2(text,text,jsonb,int)',
    'climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid)',
    'climate_vote.workshop_team_logout_v2(text)',
    'climate_vote.hq_submissions_v3(text,text)',
    'climate_vote.hq_submission_category_assign_v3(text,text,uuid,integer,text,timestamp with time zone,bigint,uuid)',
    'climate_vote.hq_submission_categories_v3(text,text)',
    'climate_vote.hq_submission_kind_assign_v3(text,text,uuid,integer,text,timestamp with time zone,bigint,uuid)',
    'climate_vote.hq_submission_kinds_v3(text,text)',
    'climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid)',
    'climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid)',
    'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)',
    'climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid)',
    'climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid)',
    'climate_vote.platform_result_implementation_upsert_v3(uuid,text,uuid,jsonb,text,uuid)'
  ] loop
    if has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'activation rollback left token/non-idempotent RPC executable: %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb)',
    'climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid)',
    'climate_vote.platform_issue_merge_v2(uuid,uuid,uuid)',
    'climate_vote.platform_issue_review_v2(uuid,uuid)',
    'climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'activation rollback did not restore authenticated v2 review adapter: %',v_name;
    end if;
  end loop;
  if not has_function_privilege('anon','climate_vote.workshop_hq_status(text,text)','execute')
     or not has_function_privilege('anon','climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid)','execute') then
    raise exception 'activation rollback removed HQ preflight functions';
  end if;
  if has_function_privilege('public','climate_vote.attendance_team_unlock(text,text)','execute')
     or has_function_privilege('anon','climate_vote.attendance_team_unlock(text,text)','execute')
     or has_function_privilege('authenticated','climate_vote.attendance_team_unlock(text,text)','execute') then
    raise exception 'activation rollback reopened retired attendance PIN endpoint';
  end if;
  if has_function_privilege('public','climate_vote.org_of_token(text)','execute')
     or has_function_privilege('anon','climate_vote.org_of_token(text)','execute')
     or has_function_privilege('authenticated','climate_vote.org_of_token(text)','execute') then
    raise exception 'activation rollback reopened unused token organization oracle';
  end if;
  foreach v_name in array array[
    'climate_vote.attendance_hq_unlock(text,text)',
    'climate_vote.attendance_hq_unlock_named(text,text)',
    'climate_vote.hq_change_password(text,text,text)',
    'climate_vote.workshop_hq_logout_v2(text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'activation rollback damaged HQ bootstrap privilege: %',v_name;
    end if;
  end loop;
  if to_regprocedure('climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,uuid)') is not null
     or to_regprocedure('climate_vote.workshop_hq_revoke_device(text,text,text,text)') is not null then
    raise exception 'activation rollback restored an unsafe mutation overload';
  end if;
  if has_function_privilege('public',
       'climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid)','execute')
     or has_function_privilege('anon',
       'climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated',
       'climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid)','execute') then
    raise exception 'activation rollback failed to revoke strict topic mutation RPC';
  end if;
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
    'climate_vote.hq_submissions_v2(text,text)',
    'climate_vote.submission_reopen_v2(text,text,uuid,text)',
    'climate_vote.hq_submission_history_v2(text,text)',
    'climate_vote.hq_submission_category_assign_v2(text,text,uuid,integer,text)',
    'climate_vote.hq_submission_categories_v2(text,text)',
    'climate_vote.hq_submission_kind_assign_v2(text,text,uuid,integer,text)',
    'climate_vote.hq_submission_kinds_v2(text,text)',
    'climate_vote.hq_topic_deadlines_v2(text,text)',
    'climate_vote.hq_clear_submissions_v2(text,text,text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'activation rollback damaged safe scoped RPC privilege: %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'climate_vote.platform_readiness_check_v2(uuid)',
    'climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid)',
    'climate_vote.platform_canvas_round_current_v2(uuid)',
    'climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)',
    'climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'activation rollback damaged Canvas staff RPC privilege: %',v_name;
    end if;
  end loop;
  if has_function_privilege('public',
       'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)','execute')
     or has_function_privilege('anon',
       'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)','execute')
     or has_function_privilege('authenticated',
       'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)','execute') then
    raise exception 'activation rollback left atomic issue reclassification executable';
  end if;
  if not has_table_privilege('anon','climate_vote.rounds','select')
     or not has_table_privilege('authenticated','climate_vote.rounds','select')
     or not has_table_privilege('anon','climate_vote.votes','select')
     or not has_table_privilege('anon','climate_vote.votes','insert') then
    raise exception 'activation rollback did not restore legacy round/vote table grants';
  end if;
  if to_regclass('public.cv_rounds') is not null
     and not has_table_privilege('anon','public.cv_rounds','select') then
    raise exception 'activation rollback did not restore legacy round view grant';
  end if;
  if to_regclass('public.cv_votes') is not null
     and (not has_table_privilege('anon','public.cv_votes','select')
       or not has_table_privilege('anon','public.cv_votes','insert')) then
    raise exception 'activation rollback did not restore legacy vote view grants';
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
      raise exception 'rollback reopened internal trigger helper: %',v_name;
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
      raise exception 'rollback damaged service-role-only operational RPC: %',v_name;
    end if;
  end loop;
  if to_regprocedure('public.cv_set_active(text)') is not null
     and (has_function_privilege('public','public.cv_set_active(text)','execute')
       or has_function_privilege('anon','public.cv_set_active(text)','execute')
       or has_function_privilege('authenticated','public.cv_set_active(text)','execute')) then
    raise exception 'rollback reopened retired public round activation RPC';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='climate_vote' and p.prokind in ('f','p')
       and has_function_privilege('public',p.oid,'execute')
  ) then
    raise exception 'rollback exposed a climate_vote routine to PUBLIC';
  end if;
  if exists(
    select 1 from climate_vote.result_page rp
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(rp.body->'issues')='array' then rp.body->'issues'
      else '[]'::jsonb end) issue
    where jsonb_typeof(issue->'implementation')='object'
      and (issue->'implementation') ? 'snapshot_hash'
  ) then
    raise exception 'activation rollback left implementation CAS metadata in public body';
  end if;
end $acl$;

insert into climate_vote.ballot
  (id,session_id,title,status,token,created_by,org_id,subgroup)
values('91200000-0000-0000-0000-000000000401',
  '91200000-0000-0000-0000-000000000003','P2a rollback draft','draft',
  'p2a-rollback-ballot-token-00001','verify',
  '91200000-0000-0000-0000-000000000001',null);
insert into climate_vote.ballot_item(id,ballot_id,ordinal,statement,scale,required)
values('91200000-0000-0000-0000-000000000411',
  '91200000-0000-0000-0000-000000000401',1,
  'Rollback verification statement',5,true);

insert into climate_vote.attendance_secret(secret_key,secret_hash) values
  ('hq_password',crypt('P2a rollback password',gen_salt('bf',4)))
on conflict(secret_key) do update set secret_hash=excluded.secret_hash;
insert into climate_vote.submission(id,topic_id,team_id,status,org_id,version)
values('91200000-0000-0000-0000-000000000421',
  '91200000-0000-0000-0000-000000000021',
  '91200000-0000-0000-0000-000000000011','draft',
  '91200000-0000-0000-0000-000000000001',0);
insert into climate_vote.submission_item(
  id,submission_id,ordinal,kind,content,rationale,provenance)
values('91200000-0000-0000-0000-000000000422',
  '91200000-0000-0000-0000-000000000421',1,'core',
  'Rollback legacy finalization source','Synthetic rollback rationale','{}'::jsonb);

set local role anon;
do $actual$
declare
  v_join_code text; v_attendance_token text; v_hq text; v_result jsonb;
  v_count int;
begin
  select join_code into v_join_code from climate_vote.mod_join('091201') limit 1;
  if v_join_code<>'091201' then raise exception 'legacy mod_join rollback call failed'; end if;
  v_attendance_token:=climate_vote.attendance_team_unlock_by_code('091201');
  if length(v_attendance_token)<>64 then
    raise exception 'legacy join-code attendance unlock rollback call failed';
  end if;
  if climate_vote.org_of_code('091201')
       is distinct from '91200000-0000-0000-0000-000000000001'::uuid then
    raise exception 'legacy organization code lookup rollback call failed';
  end if;
  if climate_vote.readiness_check(
       '91200000-0000-0000-0000-000000000003') is null then
    raise exception 'legacy readiness rollback call failed';
  end if;
  if climate_vote.attendance_round_eligible_count(
       (select id from climate_vote.rounds order by id limit 1)) is null then
    raise exception 'legacy eligible-count rollback call failed';
  end if;
  begin
    perform climate_vote.attendance_round_eligible_count_v2(
      v_attendance_token,(select id from climate_vote.rounds order by id limit 1));
    raise exception 'token eligible-count RPC executable after activation rollback';
  exception when insufficient_privilege then null;
  end;
  begin
    perform climate_vote.attendance_team_unlock('091201',null);
    raise exception 'retired attendance PIN endpoint executable after rollback';
  exception when insufficient_privilege then null;
  end;
  v_hq:=climate_vote.attendance_hq_unlock(
    'P2a rollback password','P2a rollback operator');
  if length(v_hq)<>64 then raise exception 'HQ bootstrap failed after rollback'; end if;
  begin
    perform climate_vote.org_of_token(v_hq);
    raise exception 'unused token organization oracle executable after rollback';
  exception when insufficient_privilege then null;
  end;
  v_result:=climate_vote.submission_finalize_hq(
    v_hq,'91200000-0000-0000-0000-000000000421','rollback emergency verify');
  if v_result->>'status'<>'final' then
    raise exception 'legacy HQ finalize rollback call failed: %',v_result;
  end if;
  select count(*) into v_count from climate_vote.attendance_hq_summary();
  if v_count<2 then raise exception 'legacy attendance rollback call failed'; end if;
  perform * from climate_vote.hq_teams();
  perform * from climate_vote.rounds limit 1;
  perform * from climate_vote.votes limit 1;
  if to_regclass('public.cv_rounds') is not null then perform * from public.cv_rounds limit 1; end if;
  if to_regclass('public.cv_votes') is not null then perform * from public.cv_votes limit 1; end if;
  v_result:=climate_vote.ballot_results('p2a-rollback-ballot-token-00001','091201');
  if v_result is null or v_result->>'status'<>'draft' then
    raise exception 'legacy ballot moderator result rollback failed: %',v_result;
  end if;
end $actual$;
reset role;

rollback;
select 'platform P2a activation rollback verification passed' as result;
