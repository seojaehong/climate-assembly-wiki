-- Disposable verification for platform_p1a_0912_event_access.sql.
-- Prerequisite: migrations through P1a (and preferably P1b/P2) plus the 0912 seed.
-- Every fixture mutation is rolled back.

begin;

do $acl$
declare v_name text;
begin
  foreach v_name in array array[
    'climate_vote.workshop_hq_status(text,text)',
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
    if has_function_privilege('public',v_name,'execute') then
      raise exception 'PUBLIC execute leaked: %',v_name;
    end if;
    if not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'PostgREST role grant missing: %',v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'climate_vote.mod_exchange_join_code(text,uuid,text)',
    'climate_vote.mod_session_get(text)',
    'climate_vote.topic_list_v2(text)',
    'climate_vote.attendance_round_eligible_count_v2(text,text)',
    'climate_vote.submission_get_v2(text,uuid)',
    'climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean)',
    'climate_vote.submission_finalize_v2(text,uuid,bigint)',
    'climate_vote.submission_reopen_by_team_v2(text,uuid)',
    'climate_vote.mod_create_round_v2(text,text,text,jsonb)',
    'climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid)',
    'climate_vote.mod_set_round_status_v2(text,text,text)',
    'climate_vote.mod_set_round_status_v3(text,text,text,text,uuid)',
    'climate_vote.mod_proxy_vote_v2(text,text,jsonb,int)',
    'climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid)',
    'climate_vote.mod_log_timer_v2(text,text,int,timestamptz,timestamptz)',
    'climate_vote.ballot_create_v2(text,text,text,jsonb,text)',
    'climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid)',
    'climate_vote.ballot_set_status_v2(text,uuid,text)',
    'climate_vote.ballot_list_v2(text)',
    'climate_vote.ballot_results_v2(text,text)',
    'climate_vote.workshop_hq_open_next_topic(text,text,int,uuid)',
    'climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid)',
    'climate_vote.workshop_hq_devices(text,text)',
    'climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid)',
    'climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamptz,timestamptz,uuid)',
    'climate_vote.workshop_team_logout_v2(text)',
    'climate_vote.hq_submissions_v3(text,text)',
    'climate_vote.hq_submission_category_assign_v3(text,text,uuid,integer,text,timestamptz,bigint,uuid)',
    'climate_vote.hq_submission_categories_v3(text,text)',
    'climate_vote.hq_submission_kind_assign_v3(text,text,uuid,integer,text,timestamptz,bigint,uuid)',
    'climate_vote.hq_submission_kinds_v3(text,text)',
    'climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid)',
    'climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid)',
    'climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid)',
    'climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid)',
    'climate_vote.platform_result_implementation_upsert_v3(uuid,text,uuid,jsonb,text,uuid)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'pre-cutover token RPC executable: %',v_name;
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
    'climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb)',
    'climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid)',
    'climate_vote.platform_issue_merge_v2(uuid,uuid,uuid)',
    'climate_vote.platform_issue_review_v2(uuid,uuid)',
    'climate_vote.platform_result_publish_v2(uuid,text,uuid,text)',
    'climate_vote.platform_result_unpublish_v2(uuid,uuid)',
    'climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'staff ballot RPC privilege mismatch: %',v_name;
    end if;
  end loop;
  if has_function_privilege('public',
       'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)','execute')
     or has_function_privilege('anon',
       'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)','execute')
     or has_function_privilege('authenticated',
       'climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid)','execute') then
    raise exception 'atomic reclassification RPC opened before P2a cutover';
  end if;
  if to_regprocedure('climate_vote.workshop_hq_rotate_join_codes(text,text,text)') is not null then
    raise exception 'three-argument join-code rotation overload remains';
  end if;
  if to_regprocedure('climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,uuid)') is not null then
    raise exception 'topic-status overload without expected-status CAS remains';
  end if;
  if to_regprocedure('climate_vote.workshop_hq_revoke_device(text,text,text,text)') is not null then
    raise exception 'device-revocation overload without stable request id remains';
  end if;
  if has_function_privilege('public','climate_vote.attendance_team_unlock(text,text)','execute')
     or has_function_privilege('anon','climate_vote.attendance_team_unlock(text,text)','execute')
     or has_function_privilege('authenticated','climate_vote.attendance_team_unlock(text,text)','execute') then
    raise exception 'retired attendance PIN bootstrap is executable';
  end if;
  foreach v_name in array array[
    'climate_vote.attendance_team_unlock_by_code(text)',
    'climate_vote.attendance_hq_unlock(text,text)',
    'climate_vote.attendance_hq_unlock_named(text,text)',
    'climate_vote.hq_change_password(text,text,text)',
    'climate_vote.workshop_hq_logout_v2(text)',
    'climate_vote.org_of_code(text)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or not has_function_privilege('anon',v_name,'execute')
       or not has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'pre-cutover bootstrap privilege mismatch: %',v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'climate_vote.attendance_token_row(text)',
    'climate_vote.team_token_row(text)',
    'climate_vote.workshop_hq_session_row(text,text)',
    'climate_vote.attendance_scope_session_row(text,text)',
    'climate_vote.workshop_request_source_hash()',
    'climate_vote.platform_issue_snapshot_hash(uuid)',
    'climate_vote.platform_result_implementation_snapshot_hash(jsonb)',
    'climate_vote.platform_staff_session_row(uuid)',
    'climate_vote.platform_staff_live_session_row(uuid)',
    'climate_vote.platform_staff_session_for_roles(uuid,text[])',
    'climate_vote.result_implementation_append_only_guard()',
    'climate_vote.workshop_request_claim(uuid,text,text,uuid,uuid,uuid)',
    'climate_vote.workshop_audit(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)'
  ] loop
    if has_function_privilege('public',v_name,'execute')
       or has_function_privilege('anon',v_name,'execute')
       or has_function_privilege('authenticated',v_name,'execute') then
      raise exception 'internal helper executable: %',v_name;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class
    where oid='climate_vote.workshop_request_ledger'::regclass)
    or not (select relrowsecurity from pg_class
    where oid='climate_vote.workshop_audit_event'::regclass)
    or not (select relrowsecurity from pg_class
    where oid='climate_vote.platform_canvas_round_event'::regclass) then
    raise exception 'RLS missing on workshop private tables';
  end if;
  if has_table_privilege('public','climate_vote.platform_canvas_round_event','select')
     or has_table_privilege('anon','climate_vote.platform_canvas_round_event','select')
     or has_table_privilege('authenticated','climate_vote.platform_canvas_round_event','select') then
    raise exception 'Canvas round audit table leaked';
  end if;
  if not (select relrowsecurity from pg_class
    where oid='climate_vote.workshop_join_exchange_attempt'::regclass) then
    raise exception 'RLS missing on join exchange attempts';
  end if;
  if not (select relrowsecurity from pg_class
    where oid='climate_vote.result_implementation_event'::regclass) then
    raise exception 'RLS missing on implementation audit events';
  end if;
end $acl$;

-- P1a is definition/preflight only: even a syntactically valid code cannot
-- mint a team token until the P2a revoke+grant cutover transaction.
grant usage on schema climate_vote to anon;
set local role anon;
do $pre_cutover_exchange$
begin
  begin
    perform climate_vote.mod_exchange_join_code('091201',gen_random_uuid(),'pre-cutover');
    raise exception 'pre-cutover anon exchange unexpectedly executable';
  exception when insufficient_privilege then
    null;
  end;
end $pre_cutover_exchange$;
reset role;

-- Every credential comparison must reject SQL NULL before crypt() is called.
-- Otherwise UNKNOWN can bypass an IF predicate and mint or rotate credentials.
do $bootstrap_null_guards$
declare
  v_token text; v_token_count bigint; v_attempt_count bigint; v_audit_count bigint;
  v_secret text; v_must_change boolean; v_rate_token text; v_result jsonb; i int;
  v_change_token text; v_change_token_2 text; v_logout_token text;
  v_poison_token text; v_source_hash text; v_workshop_audit_count bigint;
begin
  insert into climate_vote.attendance_secret(secret_key,secret_hash) values
    ('hq_password',crypt('P1a shared password',gen_salt('bf',4))),
    ('hq:P1a verify operator',crypt('P1a named password',gen_salt('bf',4))),
    ('hq:P1a poison operator',crypt('P1a poison password',gen_salt('bf',4))),
    ('hq:P1a rate operator',crypt('P1a rate password',gen_salt('bf',4))),
    ('hq:P1a change operator',crypt('P1a change password',gen_salt('bf',4))),
    ('hq:P1a logout operator',crypt('P1a logout password',gen_salt('bf',4)))
  on conflict(secret_key) do update set secret_hash=excluded.secret_hash;
  insert into climate_vote.hq_operator(name,default_subgroup,active,must_change_password)
  values
    ('P1a verify operator','synthetic',true,true),
    ('P1a poison operator','synthetic',true,true),
    ('P1a rate operator','synthetic',true,true),
    ('P1a change operator','synthetic',true,true),
    ('P1a logout operator','synthetic',true,true)
  on conflict(name) do update set active=true,must_change_password=true;

  v_token_count:=(select count(*) from climate_vote.attendance_auth_session);
  v_attempt_count:=(select count(*) from climate_vote.attendance_auth_attempt);
  begin
    perform climate_vote.attendance_team_unlock('091201',null);
    raise exception 'NULL team PIN unexpectedly minted a token';
  exception when others then
    if sqlerrm='NULL team PIN unexpectedly minted a token' then raise; end if;
    if position('credentials required' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_hq_unlock(null,'P1a shared operator');
    raise exception 'NULL shared HQ password unexpectedly minted a token';
  exception when others then
    if sqlerrm='NULL shared HQ password unexpectedly minted a token' then raise; end if;
    if position('credentials required' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_hq_unlock_named('P1a verify operator',null);
    raise exception 'NULL named HQ password unexpectedly minted a token';
  exception when others then
    if sqlerrm='NULL named HQ password unexpectedly minted a token' then raise; end if;
    if position('credentials required' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.attendance_auth_session)<>v_token_count
     or (select count(*) from climate_vote.attendance_auth_attempt)<>v_attempt_count then
    raise exception 'NULL bootstrap credentials changed token or attempt state';
  end if;

  -- Filling the public account-name bucket must not let an anonymous caller
  -- deny the real operator. The trusted request-source bucket still bounds
  -- bcrypt work and the successful recovery is retained in the attempt audit.
  insert into climate_vote.attendance_auth_attempt(
    scope,subject,succeeded,source_hash)
  select 'hq','P1a poison operator',false,repeat('a',64)
    from generate_series(1,5);
  perform set_config(
    'request.headers','{"x-forwarded-for":"198.51.100.41"}',true);
  v_source_hash:=climate_vote.workshop_request_source_hash();
  v_poison_token:=climate_vote.attendance_hq_unlock_named(
    'P1a poison operator','P1a poison password');
  if length(v_poison_token)<>64
     or (select count(*) from climate_vote.attendance_auth_attempt
          where scope='hq' and subject='P1a poison operator'
            and not succeeded)<>5
     or (select count(*) from climate_vote.attendance_auth_attempt
          where scope='hq' and subject='P1a poison operator' and succeeded
            and source_hash=v_source_hash)<>1 then
    raise exception 'account-name failure poisoning blocked valid named HQ recovery';
  end if;
  if climate_vote.workshop_hq_logout_v2(v_poison_token) is not true then
    raise exception 'poisoned-account recovery token could not be revoked';
  end if;

  perform set_config(
    'request.headers','{"x-forwarded-for":"203.0.113.41"}',true);
  v_source_hash:=climate_vote.workshop_request_source_hash();
  insert into climate_vote.attendance_auth_attempt(
    scope,subject,succeeded,source_hash)
  select 'hq','P1a source budget probe',false,v_source_hash
    from generate_series(1,20);
  v_token_count:=(select count(*) from climate_vote.attendance_auth_session);
  v_attempt_count:=(select count(*) from climate_vote.attendance_auth_attempt);
  if climate_vote.attendance_hq_unlock_named(
       'P1a verify operator','P1a named password') is not null
     or (select count(*) from climate_vote.attendance_auth_session)<>v_token_count
     or (select count(*) from climate_vote.attendance_auth_attempt)<>v_attempt_count then
    raise exception 'named HQ source budget did not stop bcrypt/token work fail closed';
  end if;
  perform set_config(
    'request.headers','{"x-forwarded-for":"198.51.100.44"}',true);

  v_token:=climate_vote.attendance_hq_unlock_named(
    'P1a verify operator','P1a named password');
  if length(v_token)<>64 then raise exception 'named HQ fixture login failed'; end if;
  select secret_hash into v_secret from climate_vote.attendance_secret
   where secret_key='hq:P1a verify operator';
  select must_change_password into v_must_change from climate_vote.hq_operator
   where name='P1a verify operator';
  v_attempt_count:=(select count(*) from climate_vote.attendance_auth_attempt);
  v_audit_count:=(select count(*) from climate_vote.attendance_audit_log);
  begin
    perform climate_vote.hq_change_password(v_token,null,'P1a replacement password');
    raise exception 'NULL current password unexpectedly changed HQ password';
  exception when others then
    if sqlerrm='NULL current password unexpectedly changed HQ password' then raise; end if;
    if position('current and new passwords are required' in sqlerrm)=0 then raise; end if;
  end;
  if (select secret_hash from climate_vote.attendance_secret
       where secret_key='hq:P1a verify operator') is distinct from v_secret
     or (select must_change_password from climate_vote.hq_operator
       where name='P1a verify operator') is distinct from v_must_change
     or (select count(*) from climate_vote.attendance_auth_attempt)<>v_attempt_count
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit_count then
    raise exception 'NULL password change mutated secret, flag, attempt, or audit state';
  end if;

  -- Password rotation invalidates every bearer for the named actor, not just
  -- the browser that submitted the change.
  v_change_token:=climate_vote.attendance_hq_unlock_named(
    'P1a change operator','P1a change password');
  v_change_token_2:=climate_vote.attendance_hq_unlock_named(
    'P1a change operator','P1a change password');
  v_result:=climate_vote.hq_change_password(
    v_change_token,'P1a change password','P1a changed password');
  if v_result->>'changed'<>'true'
     or coalesce((v_result->>'sessions_revoked')::int,0)<2
     or (select must_change_password from climate_vote.hq_operator
          where name='P1a change operator') is not false then
    raise exception 'password change did not revoke every actor session: %',v_result;
  end if;
  begin
    perform climate_vote.attendance_token_row(v_change_token);
    raise exception 'password-changing HQ token remained usable';
  exception when others then
    if sqlerrm='password-changing HQ token remained usable' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_token_row(v_change_token_2);
    raise exception 'second-device HQ token survived password change';
  exception when others then
    if sqlerrm='second-device HQ token survived password change' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;

  -- Explicit logout revokes the exact server-side bearer and cannot be replayed.
  v_logout_token:=climate_vote.attendance_hq_unlock_named(
    'P1a logout operator','P1a logout password');
  if climate_vote.workshop_hq_logout_v2(v_logout_token) is not true then
    raise exception 'HQ logout did not revoke its bearer';
  end if;
  begin
    perform climate_vote.workshop_hq_logout_v2(v_logout_token);
    raise exception 'revoked HQ token logged out twice';
  exception when others then
    if sqlerrm='revoked HQ token logged out twice' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;

  -- Wrong-current-password responses commit audit rows, but public login
  -- failures for the same name cannot lock an already authenticated operator
  -- out of a correct recovery. The bearer is the trust/cost boundary here.
  v_rate_token:=climate_vote.attendance_hq_unlock_named(
    'P1a rate operator','P1a rate password');
  select secret_hash into v_secret from climate_vote.attendance_secret
   where secret_key='hq:P1a rate operator';
  v_audit_count:=(select count(*) from climate_vote.attendance_audit_log);
  v_workshop_audit_count:=(select count(*) from climate_vote.workshop_audit_event
    where action='hq_password_changed' and actor_label='P1a rate operator');
  for i in 1..5 loop
    v_result:=climate_vote.hq_change_password(
      v_rate_token,'wrong current password','P1a replacement password');
    if v_result->>'changed'<>'false'
       or v_result->>'error'<>'current_password_incorrect' then
      raise exception 'wrong current password response mismatch at attempt %: %',i,v_result;
    end if;
  end loop;
  v_result:=climate_vote.hq_change_password(
    v_rate_token,'P1a rate password','P1a replacement password');
  if v_result->>'changed'<>'true'
     or coalesce((v_result->>'sessions_revoked')::int,0)<1 then
    raise exception 'correct password recovery was blocked by account failures: %',v_result;
  end if;
  if (select count(*) from climate_vote.attendance_auth_attempt
       where scope='hq' and subject='P1a rate operator' and not succeeded)<>5
     or (select extensions.crypt('P1a replacement password',secret_hash)=secret_hash
       from climate_vote.attendance_secret
       where secret_key='hq:P1a rate operator') is not true
     or (select secret_hash from climate_vote.attendance_secret
       where secret_key='hq:P1a rate operator') is not distinct from v_secret
     or (select must_change_password from climate_vote.hq_operator
       where name='P1a rate operator') is not false
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit_count
     or (select count(*) from climate_vote.workshop_audit_event
       where action='hq_password_changed' and actor_label='P1a rate operator')
          <>v_workshop_audit_count+1 then
    raise exception 'password recovery did not preserve failures, rotate secret, or append audit';
  end if;
  begin
    perform climate_vote.attendance_token_row(v_rate_token);
    raise exception 'password recovery left the old HQ bearer active';
  exception when others then
    if sqlerrm='password recovery left the old HQ bearer active' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;
end $bootstrap_null_guards$;

do $behavior$
declare
  v_hq text; v_rotate jsonb; v_status jsonb; v_open jsonb; v_repeat jsonb;
  v_code text; v_code_b text; v_team uuid; v_topic uuid; v_topic_ord int;
  v_d1 uuid:=gen_random_uuid(); v_d2 uuid:=gen_random_uuid(); v_d3 uuid:=gen_random_uuid();
  v_t1 text; v_t1b text; v_t2 text; v_tb text; v_attendance text;
  v_pre_rotation_attendance text;
  v_row jsonb; v_saved jsonb;
  v_duplicate jsonb; v_conflict jsonb; v_forced_conflict jsonb; v_forced jsonb; v_final jsonb;
  v_key uuid:=gen_random_uuid(); v_open_key uuid:=gen_random_uuid();
  v_rotate_key uuid:=gen_random_uuid(); v_proxy_key uuid:=gen_random_uuid();
  v_round_key uuid:=gen_random_uuid(); v_ballot_key uuid:=gen_random_uuid();
  v_topic_status_key uuid:=gen_random_uuid(); v_topic_stale_key uuid:=gen_random_uuid();
  v_hash text; v_audit_before bigint; v_audit_after bigint; v_other_slug text;
  v_configured_expiry timestamptz; v_source_hash text; v_round_id text;
  v_vote_before bigint; v_vote_after bigint; v_count_before bigint; v_count_after bigint;
  v_ballot jsonb; v_ballot_replay jsonb;
  v_old_codes text[]; v_codes_after text[]; v_round_status text; v_ballot_status text;
  v_submission_status text; v_version_before bigint;
begin
  if not exists(select 1 from climate_vote.session where slug='0912-deliberation') then
    raise exception 'verification fixture missing: 0912-deliberation';
  end if;
  select access_expires_at into v_configured_expiry from climate_vote.session
   where slug='0912-deliberation';
  if v_configured_expiry is distinct from '2026-09-13 22:00:00 Asia/Seoul'::timestamptz then
    raise exception '0912 hard expiry is not configured';
  end if;
  insert into climate_vote.session(slug,title,config,status,assembly_id,ordinal,held_on,org_id,access_expires_at)
  select 'p1a-hq-fallback-decoy','P1a fallback decoy','{}'::jsonb,'active',
    assembly_id,99,held_on,org_id,now()+interval '36 hours'
  from climate_vote.session where slug='0912-deliberation';
  v_count_before:=(select count(*) from climate_vote.attendance_auth_session);
  update climate_vote.session set slug='p1a-hidden-0912-target'
   where slug='0912-deliberation';
  begin
    perform climate_vote.attendance_issue_token('hq',null,'missing-target verifier');
    raise exception 'missing 0912 target fell back to another active session';
  exception when others then
    if sqlerrm='missing 0912 target fell back to another active session' then raise; end if;
  end;
  update climate_vote.session set slug='0912-deliberation'
   where slug='p1a-hidden-0912-target';
  foreach v_round_status in array array['draft','closed','archived'] loop
    update climate_vote.session set status=v_round_status
     where slug='0912-deliberation';
    begin
      perform climate_vote.attendance_issue_token('hq',null,'inactive-status HQ verifier');
      raise exception 'inactive session status minted an HQ token: %',v_round_status;
    exception when others then
      if sqlerrm like 'inactive session status minted an HQ token:%' then raise; end if;
    end;
    begin
      perform climate_vote.attendance_issue_token(
        'team','91200000-0000-0000-0000-000000000011','inactive-status team verifier');
      raise exception 'inactive session status minted a team token: %',v_round_status;
    exception when others then
      if sqlerrm like 'inactive session status minted a team token:%' then raise; end if;
    end;
  end loop;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.org set status='suspended'
   where id='91200000-0000-0000-0000-000000000001';
  begin
    perform climate_vote.attendance_issue_token('hq',null,'inactive-org HQ verifier');
    raise exception 'inactive organization minted an HQ token';
  exception when others then
    if sqlerrm='inactive organization minted an HQ token' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_issue_token(
      'team','91200000-0000-0000-0000-000000000011','inactive-org team verifier');
    raise exception 'inactive organization minted a team token';
  exception when others then
    if sqlerrm='inactive organization minted a team token' then raise; end if;
  end;
  update climate_vote.org set status='active'
   where id='91200000-0000-0000-0000-000000000001';
  update climate_vote.assembly set archived_at=now()
   where id='91200000-0000-0000-0000-000000000002';
  begin
    perform climate_vote.attendance_issue_token('hq',null,'archived-assembly HQ verifier');
    raise exception 'archived assembly minted an HQ token';
  exception when others then
    if sqlerrm='archived assembly minted an HQ token' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_issue_token(
      'team','91200000-0000-0000-0000-000000000011','archived-assembly team verifier');
    raise exception 'archived assembly minted a team token';
  exception when others then
    if sqlerrm='archived assembly minted a team token' then raise; end if;
  end;
  update climate_vote.assembly set archived_at=null
   where id='91200000-0000-0000-0000-000000000002';
  update climate_vote.session set access_expires_at=null
   where slug='0912-deliberation';
  begin
    perform climate_vote.attendance_issue_token('hq',null,'NULL-expiry HQ verifier');
    raise exception 'NULL expiry minted an HQ token';
  exception when others then
    if sqlerrm='NULL expiry minted an HQ token' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_issue_token(
      'team','91200000-0000-0000-0000-000000000011','NULL-expiry team verifier');
    raise exception 'NULL expiry minted a team token';
  exception when others then
    if sqlerrm='NULL expiry minted a team token' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()-interval '1 minute'
   where slug='0912-deliberation';
  begin
    perform climate_vote.attendance_issue_token('hq',null,'expired-target verifier');
    raise exception 'expired 0912 target minted an HQ token';
  exception when others then
    if sqlerrm='expired 0912 target minted an HQ token' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_issue_token(
      'team','91200000-0000-0000-0000-000000000011','expired-team verifier');
    raise exception 'expired team session minted a token';
  exception when others then
    if sqlerrm='expired team session minted a token' then raise; end if;
  end;
  if (select count(*) from climate_vote.attendance_auth_session)<>v_count_before then
    raise exception 'invalid session/org bootstrap changed token state';
  end if;
  update climate_vote.session set access_expires_at=v_configured_expiry
   where slug='0912-deliberation';
  -- Keep behavior tests independent of wall-clock time without weakening the
  -- fixed configuration assertion above. The enclosing transaction rolls this back.
  update climate_vote.session set access_expires_at=now()+interval '36 hours'
   where slug='0912-deliberation';

  v_hq:=climate_vote.attendance_issue_token('hq',null,'P1a verify HQ');
  if (climate_vote.attendance_token_row(v_hq)).purpose<>'hq' then
    raise exception 'HQ token purpose separation failed';
  end if;
  v_status:=climate_vote.workshop_hq_status(v_hq,'0912-deliberation');
  if v_status->>'session_slug'<>'0912-deliberation'
     or jsonb_typeof(v_status->'topics')<>'array' then
    raise exception 'HQ status contract mismatch: %',v_status;
  end if;

  -- Fixed provisioning codes must be unusable until the explicit, audited rotation.
  if exists(select 1 from climate_vote.team t join climate_vote.session s on s.id=t.session_id
    where s.slug='0912-deliberation' and t.join_code~'^0912(0[1-9]|1[0-5])$') then
    begin
      perform climate_vote.mod_exchange_join_code('091201',v_d1,'verify-fixed');
      raise exception 'fixed-code exchange unexpectedly succeeded';
    exception when others then
      if sqlerrm='fixed-code exchange unexpectedly succeeded' then raise; end if;
    end;
  end if;

  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event);
  select array_agg(t.join_code order by t.id) into v_old_codes
    from climate_vote.team t join climate_vote.session s on s.id=t.session_id
   where s.slug='0912-deliberation' and t.status='active';
  -- A code-only attendance token minted before cutover is also derived from the
  -- old join code. Rotation must revoke it, not only purpose=workshop tokens.
  v_pre_rotation_attendance:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011','pre-rotation attendance verifier');
  if not exists(select 1 from climate_vote.attendance_auth_session
      where token_hash=encode(extensions.digest(v_pre_rotation_attendance,'sha256'),'hex')
        and purpose='attendance' and revoked_at is null) then
    raise exception 'pre-rotation attendance token fixture was not issued';
  end if;
  begin
    perform climate_vote.workshop_hq_rotate_join_codes(
      v_hq,'0912-deliberation',null,gen_random_uuid());
    raise exception 'NULL rotation confirmation unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL rotation confirmation unexpectedly accepted' then raise; end if;
    if position('rotation confirmation mismatch' in sqlerrm)=0 then raise; end if;
  end;
  select array_agg(t.join_code order by t.id) into v_codes_after
    from climate_vote.team t join climate_vote.session s on s.id=t.session_id
   where s.slug='0912-deliberation' and t.status='active';
  if v_codes_after is distinct from v_old_codes then
    raise exception 'NULL rotation confirmation changed join codes';
  end if;
  v_rotate:=climate_vote.workshop_hq_rotate_join_codes(
    v_hq,'0912-deliberation','ROTATE 0912-deliberation',v_rotate_key);
  if v_rotate->>'status'<>'rotated' or jsonb_array_length(v_rotate->'codes')<2 then
    raise exception 'join-code rotation contract mismatch: %',v_rotate;
  end if;
  v_repeat:=climate_vote.workshop_hq_rotate_join_codes(
    v_hq,'0912-deliberation','ROTATE 0912-deliberation',v_rotate_key);
  if v_repeat<>v_rotate then
    raise exception 'join-code rotation idempotency changed codes: % <> %',v_repeat,v_rotate;
  end if;
  if (select count(*) from climate_vote.workshop_audit_event
      where request_id=v_rotate_key and action='join_codes_rotated')<>1 then
    raise exception 'join-code rotation retry duplicated audit';
  end if;
  v_code:=v_rotate->'codes'->0->>'join_code';
  v_code_b:=v_rotate->'codes'->1->>'join_code';
  if v_code!~'^[0-9]{6}$' or v_code_b!~'^[0-9]{6}$' or v_code=v_code_b
     or v_code~'^0912(0[1-9]|1[0-5])$' or v_code_b~'^0912(0[1-9]|1[0-5])$' then
    raise exception 'random join-code contract failed';
  end if;
  if exists(select 1 from jsonb_array_elements(v_rotate->'codes') item
    where item->>'join_code'=any(v_old_codes)) then
    raise exception 'rotated join code reused a pre-rotation code';
  end if;
  if not exists(select 1 from climate_vote.attendance_auth_session
      where token_hash=encode(extensions.digest(v_pre_rotation_attendance,'sha256'),'hex')
        and purpose='attendance' and revoked_at is not null) then
    raise exception 'join-code rotation left a legacy attendance token active';
  end if;
  begin
    perform climate_vote.attendance_scope_session_row(
      v_pre_rotation_attendance,'0912-deliberation');
    raise exception 'revoked pre-rotation attendance token remained usable';
  exception when others then
    if sqlerrm='revoked pre-rotation attendance token remained usable' then raise; end if;
    if position('expired or revoked' in sqlerrm)=0 then raise; end if;
  end;

  v_count_before:=(select count(*) from climate_vote.attendance_auth_session);
  foreach v_round_status in array array['draft','closed','archived'] loop
    update climate_vote.session set status=v_round_status
     where slug='0912-deliberation';
    if climate_vote.mod_exchange_join_code(
         v_code,gen_random_uuid(),'inactive-session exchange verifier') is not null then
      raise exception 'inactive session exchange minted a token: %',v_round_status;
    end if;
  end loop;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.org set status='suspended'
   where id='91200000-0000-0000-0000-000000000001';
  if climate_vote.mod_exchange_join_code(
       v_code,gen_random_uuid(),'inactive-org exchange verifier') is not null then
    raise exception 'inactive organization exchange minted a token';
  end if;
  update climate_vote.org set status='active'
   where id='91200000-0000-0000-0000-000000000001';
  update climate_vote.assembly set archived_at=now()
   where id='91200000-0000-0000-0000-000000000002';
  if climate_vote.mod_exchange_join_code(
       v_code,gen_random_uuid(),'archived-assembly exchange verifier') is not null then
    raise exception 'archived assembly exchange minted a token';
  end if;
  update climate_vote.assembly set archived_at=null
   where id='91200000-0000-0000-0000-000000000002';
  update climate_vote.session set access_expires_at=null
   where slug='0912-deliberation';
  if climate_vote.mod_exchange_join_code(
       v_code,gen_random_uuid(),'NULL-expiry exchange verifier') is not null then
    raise exception 'NULL expiry exchange minted a token';
  end if;
  update climate_vote.session set access_expires_at=now()-interval '1 minute'
   where slug='0912-deliberation';
  if climate_vote.mod_exchange_join_code(
       v_code,gen_random_uuid(),'expired exchange verifier') is not null then
    raise exception 'expired session exchange minted a token';
  end if;
  update climate_vote.session set access_expires_at=now()+interval '36 hours'
   where slug='0912-deliberation';
  if (select count(*) from climate_vote.attendance_auth_session)<>v_count_before then
    raise exception 'invalid session/org exchange changed token state';
  end if;

  v_row:=climate_vote.mod_exchange_join_code(v_code,v_d1,'verify-one');
  v_t1:=v_row->>'accessToken';
  if v_row->>'deviceId'<>v_d1::text or v_row->>'sessionSlug'<>'0912-deliberation'
     or length(v_t1)<>64 then raise exception 'exchange response contract mismatch: %',v_row; end if;
  if exists(select 1 from climate_vote.attendance_auth_session where token_hash=v_t1) then
    raise exception 'plaintext token was persisted';
  end if;
  if not exists(select 1 from climate_vote.attendance_auth_session
    where token_hash=encode(extensions.digest(v_t1,'sha256'),'hex')
      and expires_at=(select access_expires_at from climate_vote.session
                       where slug='0912-deliberation')) then
    raise exception 'hashed token/event expiry missing';
  end if;

  -- Same device rotates its token; a second device is accepted; a third is blocked.
  v_t1b:=climate_vote.mod_exchange_join_code(v_code,v_d1,'verify-one')->>'accessToken';
  begin perform climate_vote.attendance_token_row(v_t1);
    raise exception 'rotated token remained valid';
  exception when others then if sqlerrm='rotated token remained valid' then raise; end if; end;
  v_t2:=climate_vote.mod_exchange_join_code(v_code,v_d2,'verify-two')->>'accessToken';
  select t.id into v_team from climate_vote.team t where t.join_code=v_code;
  v_attendance:=climate_vote.attendance_issue_token('team',v_team,'verify attendance');
  begin perform climate_vote.team_token_row(v_attendance);
    raise exception 'attendance token entered workshop RPC scope';
  exception when others then
    if sqlerrm='attendance token entered workshop RPC scope' then raise; end if;
  end;
  begin
    perform climate_vote.mod_exchange_join_code(v_code,v_d3,'verify-three');
    raise exception 'third active device unexpectedly accepted';
  exception when others then
    if sqlerrm='third active device unexpectedly accepted' then raise; end if;
  end;
  if (select count(*) from climate_vote.attendance_auth_session a
      join climate_vote.team t on t.id=a.team_id
      where t.join_code=v_code and a.purpose='workshop'
        and a.revoked_at is null and a.expires_at>now())<>2 then
    raise exception 'two-device invariant failed';
  end if;

  -- Creation requests use the ledger: replay returns the same object, while a
  -- key reused for another payload is rejected and creates no duplicate/audit.
  select count(*) into v_count_before from climate_vote.rounds where team_id=v_team;
  v_round_id:=(climate_vote.mod_create_round_v3(
    v_t1b,'verify idempotent proxy','RADIO','["yes","no"]'::jsonb,v_round_key)).id;
  if (climate_vote.mod_create_round_v3(
      v_t1b,'verify idempotent proxy','RADIO','["yes","no"]'::jsonb,v_round_key)).id
      <>v_round_id then raise exception 'round create replay changed result'; end if;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'competing active round','RADIO','["yes","no"]'::jsonb,
      gen_random_uuid());
    raise exception 'second active team round unexpectedly created';
  exception when others then
    if sqlerrm='second active team round unexpectedly created' then raise; end if;
    if position('active round conflict: existing round '||v_round_id in sqlerrm)=0 then
      raise;
    end if;
  end;
  if (select count(*) from climate_vote.rounds
       where team_id=v_team and status='active')<>1
     or (select count(*) from climate_vote.workshop_audit_event
          where action='round_created' and team_id=v_team)<>1 then
    raise exception 'active round conflict mutated round or audit state';
  end if;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'different payload','RADIO','["yes","no"]'::jsonb,v_round_key);
    raise exception 'round create key payload mismatch accepted';
  exception when others then
    if sqlerrm='round create key payload mismatch accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'invalid object','RADIO','{}'::jsonb,gen_random_uuid());
    raise exception 'non-array round options unexpectedly accepted';
  exception when others then
    if sqlerrm='non-array round options unexpectedly accepted' then raise; end if;
    if position('round options must be' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'invalid empty','RADIO','[]'::jsonb,gen_random_uuid());
    raise exception 'empty round options unexpectedly accepted';
  exception when others then
    if sqlerrm='empty round options unexpectedly accepted' then raise; end if;
    if position('round options must be' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'invalid label','RADIO','["valid",""]'::jsonb,gen_random_uuid());
    raise exception 'empty round option label unexpectedly accepted';
  exception when others then
    if sqlerrm='empty round option label unexpectedly accepted' then raise; end if;
    if position('round options must be' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'duplicate label','RADIO','["same"," same "]'::jsonb,gen_random_uuid());
    raise exception 'duplicate round option label unexpectedly accepted';
  exception when others then
    if sqlerrm='duplicate round option label unexpectedly accepted' then raise; end if;
    if position('must be unique' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_create_round_v3(
      v_t1b,'NULL type',null,'["yes"]'::jsonb,gen_random_uuid());
    raise exception 'NULL round type unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL round type unexpectedly accepted' then raise; end if;
    if position('invalid round type' in sqlerrm)=0 then raise; end if;
  end;
  select count(*) into v_count_after from climate_vote.rounds where team_id=v_team;
  if v_count_after-v_count_before<>1 or (select count(*) from climate_vote.workshop_audit_event
      where request_id=v_round_key and action='round_created')<>1 then
    raise exception 'round create idempotency duplicated state or audit';
  end if;
  if v_round_id !~ '^m-[0-9a-f]{32}$' then
    raise exception 'new public round id lacks UUID-grade entropy: %',v_round_id;
  end if;

  select count(*) into v_count_before from climate_vote.ballot
   where session_id=(select session_id from climate_vote.team where id=v_team);
  v_ballot:=climate_vote.ballot_create_v3(v_t1b,'verify ballot','instructions',
    '[{"statement":"verify statement","scale":5,"required":true}]'::jsonb,
    null,v_ballot_key);
  v_ballot_replay:=climate_vote.ballot_create_v3(v_t1b,'verify ballot','instructions',
    '[{"statement":"verify statement","scale":5,"required":true}]'::jsonb,
    null,v_ballot_key);
  if v_ballot_replay<>v_ballot then raise exception 'ballot create replay changed result'; end if;
  begin
    perform climate_vote.ballot_create_v3(v_t1b,'different ballot','instructions',
      '[{"statement":"verify statement"}]'::jsonb,null,v_ballot_key);
    raise exception 'ballot create key payload mismatch accepted';
  exception when others then
    if sqlerrm='ballot create key payload mismatch accepted' then raise; end if;
    if position('different request' in sqlerrm)=0 then raise; end if;
  end;
  select count(*) into v_count_after from climate_vote.ballot
   where session_id=(select session_id from climate_vote.team where id=v_team);
  if v_count_after-v_count_before<>1 or (select count(*) from climate_vote.workshop_audit_event
      where request_id=v_ballot_key and action='ballot_created')<>1 then
    raise exception 'ballot create idempotency duplicated state or audit';
  end if;

  -- Retrying the same proxy-vote request must not duplicate anonymous votes.
  select count(*) into v_vote_before from climate_vote.votes where round_id=v_round_id;
  if climate_vote.mod_proxy_vote_v3(
       v_t1b,v_round_id,'"yes"'::jsonb,2,v_proxy_key)<>2 then
    raise exception 'proxy vote v3 first request failed';
  end if;
  if climate_vote.mod_proxy_vote_v3(
       v_t1b,v_round_id,'"yes"'::jsonb,2,v_proxy_key)<>2 then
    raise exception 'proxy vote v3 replay result changed';
  end if;
  select count(*) into v_vote_after from climate_vote.votes where round_id=v_round_id;
  if v_vote_after-v_vote_before<>2 then
    raise exception 'proxy vote idempotency duplicated votes';
  end if;
  if (select count(*) from climate_vote.workshop_audit_event
      where request_id=v_proxy_key and action='proxy_vote_recorded')<>1 then
    raise exception 'proxy vote idempotency duplicated audit';
  end if;
  select count(*) into v_vote_before from climate_vote.votes where round_id=v_round_id;
  begin
    perform climate_vote.mod_proxy_vote_v3(
      v_t1b,v_round_id,'"tampered"'::jsonb,1,gen_random_uuid());
    raise exception 'invalid proxy vote choice unexpectedly accepted';
  exception when others then
    if sqlerrm='invalid proxy vote choice unexpectedly accepted' then raise; end if;
    if position('invalid proxy vote choice' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.votes where round_id=v_round_id)<>v_vote_before then
    raise exception 'invalid proxy vote choice changed state';
  end if;
  begin
    perform climate_vote.mod_proxy_vote_v3(
      v_t1b,v_round_id,null,1,gen_random_uuid());
    raise exception 'NULL proxy vote choice unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL proxy vote choice unexpectedly accepted' then raise; end if;
    if position('proxy choice required' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_proxy_vote_v3(
      v_t1b,v_round_id,'"yes"'::jsonb,null,gen_random_uuid());
    raise exception 'NULL proxy vote count unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL proxy vote count unexpectedly accepted' then raise; end if;
    if position('proxy 1..5 only' in sqlerrm)=0 then raise; end if;
  end;
  select status into v_round_status from climate_vote.rounds where id=v_round_id;
  begin
    perform climate_vote.mod_set_round_status_v2(v_t1b,v_round_id,null);
    raise exception 'NULL round status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL round status unexpectedly accepted' then raise; end if;
    if position('invalid status' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.rounds where id=v_round_id) is distinct from v_round_status then
    raise exception 'NULL round status changed round state';
  end if;
  perform climate_vote.mod_set_round_status_v2(v_t1b,v_round_id,'closed');
  perform climate_vote.mod_set_round_status_v2(v_t1b,v_round_id,'closed');
  if (select count(*) from climate_vote.workshop_audit_event
      where action='round_status_changed' and after_value->>'round_id'=v_round_id)<>1 then
    raise exception 'round status retry duplicated audit';
  end if;
  select status into v_ballot_status from climate_vote.ballot
   where id=(v_ballot->>'id')::uuid;
  begin
    perform climate_vote.ballot_set_status_v2(v_t1b,(v_ballot->>'id')::uuid,null);
    raise exception 'NULL ballot status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL ballot status unexpectedly accepted' then raise; end if;
    if position('invalid status' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.ballot where id=(v_ballot->>'id')::uuid)
       is distinct from v_ballot_status then
    raise exception 'NULL ballot status changed ballot state';
  end if;
  begin
    perform climate_vote.mod_log_timer_v2(v_t1b,null,60,now(),null);
    raise exception 'NULL timer kind unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL timer kind unexpectedly accepted' then raise; end if;
    if position('invalid timer kind' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_log_timer_v2(v_t1b,'speech',null,now(),null);
    raise exception 'NULL timer duration unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL timer duration unexpectedly accepted' then raise; end if;
    if position('duration out of range' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.mod_log_timer_v2(v_t1b,'speech',60,null,null);
    raise exception 'NULL timer start unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL timer start unexpectedly accepted' then raise; end if;
    if position('timer start required' in sqlerrm)=0 then raise; end if;
  end;
  perform climate_vote.ballot_set_status_v2(v_t1b,(v_ballot->>'id')::uuid,'open');
  perform climate_vote.ballot_set_status_v2(v_t1b,(v_ballot->>'id')::uuid,'open');
  if (select count(*) from climate_vote.workshop_audit_event
      where action='ballot_status_changed'
        and after_value->>'ballot_id'=v_ballot->>'id')<>1 then
    raise exception 'ballot status retry duplicated audit';
  end if;

  -- A different team token cannot see the first team's submission.
  v_tb:=climate_vote.mod_exchange_join_code(v_code_b,gen_random_uuid(),'verify-other')->>'accessToken';
  select dt.id,dt.ordinal into v_topic,v_topic_ord from climate_vote.discussion_topic dt
    join climate_vote.session s on s.id=dt.session_id
    where s.slug='0912-deliberation' order by dt.ordinal limit 1;
  update climate_vote.discussion_topic set status='open' where id=v_topic;

  v_saved:=climate_vote.submission_save_v3(v_t1b,v_topic,
    '[{"ordinal":1,"kind":"core","content":"verify line","rationale":null}]'::jsonb,
    0,v_key,false);
  if v_saved->>'status' not in ('draft','reopened') or (v_saved->>'version')::int<>1 then
    raise exception 'first OCC save failed: %',v_saved;
  end if;
  v_duplicate:=climate_vote.submission_save_v3(v_t1b,v_topic,
    '[{"ordinal":1,"kind":"core","content":"verify line","rationale":null}]'::jsonb,
    0,v_key,false);
  if v_duplicate<>v_saved then raise exception 'idempotent replay changed response'; end if;
  v_conflict:=climate_vote.submission_save_v3(v_t1b,v_topic,
    '[{"ordinal":1,"kind":"core","content":"stale","rationale":null}]'::jsonb,
    0,gen_random_uuid(),false);
  if v_conflict->>'status'<>'conflict' or (v_conflict->>'version')::int<>1 then
    raise exception 'stale OCC write did not conflict: %',v_conflict;
  end if;
  v_forced_conflict:=climate_vote.submission_save_v3(v_t1b,v_topic,
    '[{"ordinal":1,"kind":"core","content":"explicit replacement","rationale":null}]'::jsonb,
    0,gen_random_uuid(),true);
  if v_forced_conflict->>'status'<>'conflict' or (v_forced_conflict->>'version')::int<>1 then
    raise exception 'explicit force bypassed stale CAS: %',v_forced_conflict;
  end if;
  v_forced:=climate_vote.submission_save_v3(v_t1b,v_topic,
    '[{"ordinal":1,"kind":"core","content":"explicit replacement","rationale":null}]'::jsonb,
    1,gen_random_uuid(),true);
  if (v_forced->>'version')::int<>2 or (v_forced->>'forced')::boolean is not true then
    raise exception 'explicit force replacement failed: %',v_forced;
  end if;
  if climate_vote.submission_get_v2(v_tb,v_topic)->>'id' is not null then
    raise exception 'cross-team submission disclosure';
  end if;

  select status,version into v_submission_status,v_version_before
    from climate_vote.submission where topic_id=v_topic and team_id=v_team;
  begin
    perform climate_vote.submission_finalize_v2(v_t1b,v_topic,null);
    raise exception 'NULL finalize expected version unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL finalize expected version unexpectedly accepted' then raise; end if;
    if position('expected version must be nonnegative' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.submission where topic_id=v_topic and team_id=v_team)
       is distinct from v_submission_status
     or (select version from climate_vote.submission where topic_id=v_topic and team_id=v_team)
       is distinct from v_version_before then
    raise exception 'NULL finalize expected version changed submission state';
  end if;
  v_final:=climate_vote.submission_finalize_v2(v_t1b,v_topic,1);
  if v_final->>'status'<>'conflict' then raise exception 'finalize stale CAS missing'; end if;
  v_final:=climate_vote.submission_finalize_v2(v_t1b,v_topic,2);
  if v_final->>'status'<>'final' or (v_final->>'version')::int<>3 then
    raise exception 'finalize failed: %',v_final;
  end if;
  v_duplicate:=climate_vote.submission_finalize_v2(v_t1b,v_topic,3);
  if v_duplicate<>v_final or (select count(*) from climate_vote.workshop_audit_event
      where action='submission_finalized' and team_id=v_team)<>1 then
    raise exception 'finalize retry changed result or duplicated audit';
  end if;
  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event);
  v_count_before:=(select count(*) from climate_vote.submission_lock_event
    where submission_id=(v_final->>'id')::uuid and action='finalize');
  v_conflict:=climate_vote.submission_finalize_v2(v_t1b,v_topic,2);
  if v_conflict->>'status'<>'conflict'
     or (v_conflict->>'version')::int<>3
     or (select status from climate_vote.submission where id=(v_final->>'id')::uuid)<>'final'
     or (select count(*) from climate_vote.workshop_audit_event)<>v_audit_before
     or (select count(*) from climate_vote.submission_lock_event
       where submission_id=(v_final->>'id')::uuid and action='finalize')<>v_count_before then
    raise exception 'stale post-finalize CAS changed state or audit: %',v_conflict;
  end if;
  v_final:=climate_vote.submission_reopen_by_team_v2(v_t1b,v_topic);
  v_duplicate:=climate_vote.submission_reopen_by_team_v2(v_t1b,v_topic);
  if v_duplicate<>v_final or (select count(*) from climate_vote.workshop_audit_event
      where action='submission_reopened' and team_id=v_team)<>1 then
    raise exception 'reopen retry changed result or duplicated audit';
  end if;
  v_saved:=climate_vote.submission_save_v3(v_t1b,v_topic,
    '[{"ordinal":1,"kind":"core","content":"final before topic close","rationale":null}]'::jsonb,
    (v_final->>'version')::bigint,gen_random_uuid(),false);
  v_final:=climate_vote.submission_finalize_v2(
    v_t1b,v_topic,(v_saved->>'version')::bigint);
  if v_final->>'status'<>'final' then
    raise exception 'pre-close finalization fixture failed: %',v_final;
  end if;
  if (select ae.before_value->>'status'
        from climate_vote.workshop_audit_event ae
       where ae.action='submission_finalized' and ae.team_id=v_team
       order by ae.id desc limit 1) is distinct from 'reopened' then
    raise exception 'reopened submission finalization audit lost the actual before status';
  end if;

  -- HQ next-topic operation is idempotent and its audit row is singular.
  select count(*) into v_count_before from climate_vote.workshop_request_ledger;
  begin
    perform climate_vote.workshop_hq_open_next_topic(
      v_hq,'0912-deliberation',null,gen_random_uuid());
    raise exception 'NULL expected topic ordinal unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL expected topic ordinal unexpectedly accepted' then raise; end if;
    if position('expected topic ordinal required' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.workshop_request_ledger)<>v_count_before then
    raise exception 'NULL expected topic ordinal claimed an idempotency key';
  end if;
  update climate_vote.discussion_topic dt set status='draft'
   from climate_vote.session s where s.id=dt.session_id and s.slug='0912-deliberation';
  v_open:=climate_vote.workshop_hq_open_next_topic(v_hq,'0912-deliberation',v_topic_ord,v_open_key);
  v_repeat:=climate_vote.workshop_hq_open_next_topic(v_hq,'0912-deliberation',v_topic_ord,v_open_key);
  if v_open<>v_repeat or v_open->>'status'<>'opened' then raise exception 'HQ idempotency failed'; end if;
  if (select count(*) from climate_vote.workshop_audit_event
    where request_id=v_open_key and action='topic_opened')<>1 then
    raise exception 'HQ idempotency duplicated audit';
  end if;
  select status into v_round_status from climate_vote.discussion_topic where id=v_topic;
  begin
    perform climate_vote.workshop_hq_set_topic_status(
      v_hq,'0912-deliberation',v_topic,null,'closed',gen_random_uuid());
    raise exception 'NULL expected topic status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL expected topic status unexpectedly accepted' then raise; end if;
    if position('invalid topic status' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.workshop_hq_set_topic_status(
      v_hq,'0912-deliberation',v_topic,'open',null,gen_random_uuid());
    raise exception 'NULL target topic status unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL target topic status unexpectedly accepted' then raise; end if;
    if position('invalid topic status' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.discussion_topic where id=v_topic)
       is distinct from v_round_status then
    raise exception 'NULL topic status input changed topic state';
  end if;
  v_row:=climate_vote.workshop_hq_set_topic_status(
    v_hq,'0912-deliberation',v_topic,'open','closed',v_topic_status_key);
  v_repeat:=climate_vote.workshop_hq_set_topic_status(
    v_hq,'0912-deliberation',v_topic,'open','closed',v_topic_status_key);
  if v_row<>v_repeat or v_row->>'status'<>'updated'
     or v_row->>'current_status'<>'closed' then
    raise exception 'strict topic status replay contract failed: % / %',v_row,v_repeat;
  end if;
  if (select count(*) from climate_vote.workshop_audit_event
       where request_id=v_topic_status_key and action='topic_status_changed')<>1 then
    raise exception 'strict topic status replay duplicated audit';
  end if;
  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event);
  v_status:=climate_vote.workshop_hq_set_topic_status(
    v_hq,'0912-deliberation',v_topic,'open','closed',v_topic_stale_key);
  if v_status->>'status'<>'conflict' or v_status->>'current_status'<>'closed'
     or (select status from climate_vote.discussion_topic where id=v_topic)<>'closed'
     or (select count(*) from climate_vote.workshop_audit_event)<>v_audit_before then
    raise exception 'strict topic status stale CAS changed state or audit: %',v_status;
  end if;

  -- Once HQ closes a topic, a team cannot demote a final submission into an
  -- uneditable reopened state. The rejection must leave submission and audit
  -- generations unchanged.
  v_version_before:=(select version from climate_vote.submission
    where topic_id=v_topic and team_id=v_team);
  v_audit_before:=(select count(*) from climate_vote.workshop_audit_event);
  v_count_before:=(select count(*) from climate_vote.submission_lock_event
    where submission_id=(v_final->>'id')::uuid);
  begin
    perform climate_vote.submission_reopen_by_team_v2(v_t1b,v_topic);
    raise exception 'closed-topic team reopen unexpectedly succeeded';
  exception when others then
    if sqlerrm='closed-topic team reopen unexpectedly succeeded' then raise; end if;
    if position('nothing to reopen in open authorization scope' in sqlerrm)=0 then raise; end if;
  end;
  if (select status from climate_vote.submission where id=(v_final->>'id')::uuid)<>'final'
     or (select version from climate_vote.submission where id=(v_final->>'id')::uuid)
       is distinct from v_version_before
     or (select count(*) from climate_vote.workshop_audit_event)<>v_audit_before
     or (select count(*) from climate_vote.submission_lock_event
       where submission_id=(v_final->>'id')::uuid)<>v_count_before then
    raise exception 'closed-topic team reopen changed submission or audit state';
  end if;

  v_row:=climate_vote.workshop_hq_set_deadline(v_hq,'0912-deliberation',v_topic,
    (select deadline_at from climate_vote.discussion_topic where id=v_topic),
    now()+interval '20 minutes',gen_random_uuid());
  if v_row->>'status'<>'updated' then raise exception 'deadline CAS update failed'; end if;
  v_row:=climate_vote.workshop_hq_set_deadline(v_hq,'0912-deliberation',v_topic,
    null,now()+interval '30 minutes',gen_random_uuid());
  if v_row->>'status'<>'conflict' then raise exception 'deadline stale CAS missing'; end if;

  -- A token is bound to exactly one session, even inside the same org.
  insert into climate_vote.session(slug,title,config,status,org_id,assembly_id,held_on,access_expires_at)
  select 'p1a-verify-other','verify other',config,status,org_id,assembly_id,held_on,
    now()+interval '1 hour' from climate_vote.session where slug='0912-deliberation'
  returning slug into v_other_slug;
  begin
    perform climate_vote.workshop_hq_status(v_hq,v_other_slug);
    raise exception 'cross-session HQ token unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-session HQ token unexpectedly accepted' then raise; end if;
  end;

  -- Revoke by hash immediately invalidates that capability.
  v_hash:=encode(extensions.digest(v_t2,'sha256'),'hex');
  perform climate_vote.workshop_hq_revoke_device(
    v_hq,'0912-deliberation',v_hash,'verify revoke',gen_random_uuid());
  begin perform climate_vote.mod_session_get(v_t2);
    raise exception 'revoked token remained valid';
  exception when others then if sqlerrm='revoked token remained valid' then raise; end if; end;

  -- A caller cannot reset the source-layer budget by rotating arbitrary device UUIDs.
  perform set_config('request.headers','{"x-forwarded-for":"203.0.113.42"}',true);
  v_source_hash:=climate_vote.workshop_request_source_hash();
  if v_source_hash is null or length(v_source_hash)<>64 then
    raise exception 'request source hashing failed';
  end if;
  insert into climate_vote.workshop_join_exchange_attempt
    (device_id,source_hash,succeeded,attempted_at)
  select gen_random_uuid(),v_source_hash,false,now()
    from generate_series(1,60);
  if climate_vote.mod_exchange_join_code(
       v_code_b,gen_random_uuid(),'verify-source-rate') is not null then
    raise exception 'source rate limit bypassed by device UUID rotation';
  end if;
  if exists(select 1 from climate_vote.workshop_join_exchange_attempt
      where source_hash like '%203.0.113.42%') then
    raise exception 'raw request source was persisted';
  end if;
  perform set_config('request.headers','{}',true);

  -- Audit is append-only, including owner-level accidental writes.
  begin update climate_vote.workshop_audit_event set action='tampered'
    where id=(select min(id) from climate_vote.workshop_audit_event);
    raise exception 'audit update unexpectedly allowed';
  exception when others then if sqlerrm='audit update unexpectedly allowed' then raise; end if; end;
  begin delete from climate_vote.workshop_audit_event
    where id=(select min(id) from climate_vote.workshop_audit_event);
    raise exception 'audit delete unexpectedly allowed';
  exception when others then if sqlerrm='audit delete unexpectedly allowed' then raise; end if; end;
  v_audit_after:=(select count(*) from climate_vote.workshop_audit_event);
  if v_audit_after<=v_audit_before then raise exception 'audit trail was not appended'; end if;

  insert into climate_vote.result_implementation_event(
    org_id,session_id,result_id,result_token_hash,issue_id,actor_user_id,
    status,responsible_body,effective_at,summary)
  select s.org_id,s.id,gen_random_uuid(),repeat('a',64),gen_random_uuid(),
    gen_random_uuid(),'planned','verify body',now(),'verify implementation'
    from climate_vote.session s where s.slug='0912-deliberation';
  begin update climate_vote.result_implementation_event set summary='tampered'
    where id=(select max(id) from climate_vote.result_implementation_event);
    raise exception 'implementation audit update unexpectedly allowed';
  exception when others then
    if sqlerrm='implementation audit update unexpectedly allowed' then raise; end if;
  end;
  begin delete from climate_vote.result_implementation_event
    where id=(select max(id) from climate_vote.result_implementation_event);
    raise exception 'implementation audit delete unexpectedly allowed';
  exception when others then
    if sqlerrm='implementation audit delete unexpectedly allowed' then raise; end if;
  end;
end $behavior$;

-- Exercise every currently used attendance/HQ v2 client path, then prove that
-- both a same-org foreign session and a foreign organization are rejected.
do $scoped_attendance_hq$
declare
  v_hq text; v_team_token text; v_current_submission uuid; v_linked_item uuid;
  v_issue uuid:=gen_random_uuid(); v_version bigint; v_stale jsonb; v_reopen jsonb;
  v_current_round text:='p1a-current-round-capability-000001';
  v_checkbox_round text:='p1a-checkbox-round-capability-0001';
  v_other_team_round text:='p1a-other-team-round-capability-01';
  v_other_round text:='p1a-other-session-round-capability1';
  v_foreign_round text:='p1a-foreign-round-capability-00001';
  v_unbound_round text:='p1a-legacy-unbound-read-only-0001';
  v_current_assignment uuid:='91200000-0000-0000-0000-000000000601';
  v_other_assignment uuid:='91200000-0000-0000-0000-000000000611';
  v_foreign_team uuid:='91200000-0000-0000-0000-000000000621';
  v_foreign_submission uuid:='91200000-0000-0000-0000-000000000622';
  v_clear jsonb; v_table_before text; v_count int; v_audit_count int;
  v_attendance_before jsonb; v_member_name_before text; v_pin_before text;
  v_lifecycle_status text; v_topic_status text; v_updated_at timestamptz;
begin
  v_hq:=climate_vote.attendance_issue_token('hq',null,'Scoped HQ verifier');
  v_team_token:=climate_vote.attendance_issue_token(
    'team','91200000-0000-0000-0000-000000000011','Scoped team verifier');
  update climate_vote.attendance_auth_session set purpose='workshop',device_id=gen_random_uuid()
   where token_hash=encode(extensions.digest(v_team_token,'sha256'),'hex');

  insert into climate_vote.assembly_member(id,official_id,name,active,source_hash,org_id)
  values
    ('91200000-0000-0000-0000-000000000600','P1A-CURRENT','Current synthetic member',true,'verify',
     '91200000-0000-0000-0000-000000000001'),
    ('91200000-0000-0000-0000-000000000610','P1A-OTHER','Other-session synthetic member',true,'verify',
     '91200000-0000-0000-0000-000000000001');

  insert into climate_vote.team(id,session_id,name,subgroup,join_code,capacity,status,table_no,org_id)
  select '91200000-0000-0000-0000-000000000612',s.id,'Other session team','other','761231',8,
    'active','O-01',s.org_id from climate_vote.session s where s.slug='p1a-verify-other';
  insert into climate_vote.team_assignment(id,session_id,team_id,member_id,active,org_id)
  values
    (v_current_assignment,'91200000-0000-0000-0000-000000000003',
     '91200000-0000-0000-0000-000000000011','91200000-0000-0000-0000-000000000600',true,
     '91200000-0000-0000-0000-000000000001'),
    (v_other_assignment,(select id from climate_vote.session where slug='p1a-verify-other'),
     '91200000-0000-0000-0000-000000000612','91200000-0000-0000-0000-000000000610',true,
     '91200000-0000-0000-0000-000000000001');
  insert into climate_vote.attendance(assignment_id,base_status,org_id)
  values
    (v_current_assignment,'unconfirmed','91200000-0000-0000-0000-000000000001'),
    (v_other_assignment,'unconfirmed','91200000-0000-0000-0000-000000000001');

  insert into climate_vote.org(id,slug,name,status) values
    ('91200000-0000-0000-0000-000000000701','p1a-foreign-org','P1a foreign org','active');
  insert into climate_vote.assembly_member(id,official_id,name,active,source_hash,org_id)
  values('91200000-0000-0000-0000-000000000620','P1A-FOREIGN',
    'Foreign-org synthetic member',true,'verify',
    '91200000-0000-0000-0000-000000000701');
  insert into climate_vote.assembly(id,slug,title,purpose,mode,config,status,org_id) values
    ('91200000-0000-0000-0000-000000000702','p1a-foreign-assembly','P1a foreign assembly',
     'Cross-org negative verification','consensus','{}','active',
     '91200000-0000-0000-0000-000000000701');
  insert into climate_vote.session(id,slug,title,config,status,assembly_id,ordinal,held_on,org_id,access_expires_at)
  values('91200000-0000-0000-0000-000000000703','p1a-foreign-session','P1a foreign session',
    '{}','active','91200000-0000-0000-0000-000000000702',1,'2026-09-12',
    '91200000-0000-0000-0000-000000000701',now()+interval '1 hour');
  insert into climate_vote.team(id,session_id,name,subgroup,join_code,capacity,status,table_no,org_id)
  values(v_foreign_team,'91200000-0000-0000-0000-000000000703','Foreign team','foreign',
    '761232',8,'active','F-01','91200000-0000-0000-0000-000000000701');
  insert into climate_vote.team_assignment(id,session_id,team_id,member_id,active,org_id)
  values('91200000-0000-0000-0000-000000000623','91200000-0000-0000-0000-000000000703',
    v_foreign_team,'91200000-0000-0000-0000-000000000620',true,
    '91200000-0000-0000-0000-000000000701');
  insert into climate_vote.attendance(assignment_id,base_status,org_id)
  values('91200000-0000-0000-0000-000000000623','unconfirmed',
    '91200000-0000-0000-0000-000000000701');
  insert into climate_vote.discussion_topic
    (id,session_id,ordinal,block,prompt,guidance,status,org_id)
  values('91200000-0000-0000-0000-000000000624','91200000-0000-0000-0000-000000000703',
    1,'am','Foreign topic','Must remain isolated','open',
    '91200000-0000-0000-0000-000000000701');
  insert into climate_vote.submission(id,topic_id,team_id,status,org_id,version)
  values(v_foreign_submission,'91200000-0000-0000-0000-000000000624',v_foreign_team,
    'draft','91200000-0000-0000-0000-000000000701',1);
  insert into climate_vote.submission_item
    (id,submission_id,ordinal,kind,content,rationale,provenance)
  values('91200000-0000-0000-0000-000000000625',v_foreign_submission,1,'core',
    'Foreign content must survive current-session clear',null,'{}');
  update climate_vote.submission set status='final' where id=v_foreign_submission;

  insert into climate_vote.rounds(id,title,type,options,status,team_id,created_by) values
    (v_current_round,'Current public round','RADIO','["yes","no"]','active',
     '91200000-0000-0000-0000-000000000011','verify'),
    (v_checkbox_round,'Checkbox public round','CHECKBOX','["yes","no"]','closed',
     '91200000-0000-0000-0000-000000000011','verify'),
    (v_other_team_round,'Other team round','RADIO','["yes","no"]','active',
     '91200000-0000-0000-0000-000000000012','verify'),
    (v_other_round,'Other session round','RADIO','["yes","no"]','active',
     '91200000-0000-0000-0000-000000000612','verify'),
    (v_foreign_round,'Foreign round','RADIO','["yes","no"]','active',
     v_foreign_team,'verify'),
    (v_unbound_round,'Legacy unbound read-only round','RADIO','["yes","no"]','active',
     null,'verify');
  insert into climate_vote.votes(round_id,choice,voter_role,client_id,org_id) values
    (v_current_round,'"yes"','citizen','verify-existing',
     '91200000-0000-0000-0000-000000000001'),
    (v_other_round,'"yes"','citizen','verify-other',
     '91200000-0000-0000-0000-000000000001'),
    (v_foreign_round,'"yes"','citizen','verify-foreign',
     '91200000-0000-0000-0000-000000000701');

  if (select count(*) from climate_vote.attendance_roster_v2(v_hq,'0912-deliberation'))<>1
     or (select count(*) from climate_vote.attendance_roster_v2(v_team_token,'0912-deliberation'))<>1 then
    raise exception 'scoped attendance roster positive contract failed';
  end if;
  select to_jsonb(a) into v_attendance_before from climate_vote.attendance a
   where a.assignment_id=v_current_assignment;
  v_audit_count:=(select count(*) from climate_vote.attendance_audit_log);
  update climate_vote.session set status='archived' where slug='0912-deliberation';
  begin
    perform * from climate_vote.attendance_roster_v2(v_team_token,'0912-deliberation');
    raise exception 'archived session attendance read unexpectedly accepted';
  exception when others then
    if sqlerrm='archived session attendance read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_set_v2(
      v_team_token,'0912-deliberation',v_current_assignment,'present',now());
    raise exception 'archived session attendance mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='archived session attendance mutation unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.session set access_expires_at=null where slug='0912-deliberation';
  begin
    perform * from climate_vote.attendance_roster_v2(v_team_token,'0912-deliberation');
    raise exception 'NULL-expiry attendance read unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL-expiry attendance read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_set_v2(
      v_team_token,'0912-deliberation',v_current_assignment,'present',now());
    raise exception 'NULL-expiry attendance mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL-expiry attendance mutation unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()-interval '1 minute'
   where slug='0912-deliberation';
  begin
    perform * from climate_vote.attendance_roster_v2(v_team_token,'0912-deliberation');
    raise exception 'expired session attendance read unexpectedly accepted';
  exception when others then
    if sqlerrm='expired session attendance read unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()+interval '36 hours'
   where slug='0912-deliberation';
  if (select to_jsonb(a) from climate_vote.attendance a
       where a.assignment_id=v_current_assignment) is distinct from v_attendance_before
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit_count then
    raise exception 'rejected attendance lifecycle access changed state or audit';
  end if;
  if (select count(*) from climate_vote.attendance_hq_summary_v2(v_hq,'0912-deliberation'))<>2 then
    raise exception 'scoped HQ attendance summary positive contract failed';
  end if;
  if (select count(*) from climate_vote.hq_teams_v2(v_hq,'0912-deliberation'))<>2
     or (select count(*) from climate_vote.hq_rounds_v2(v_hq,'0912-deliberation'))<2
     or (select sum(vote_count) from climate_vote.hq_vote_counts_v2(
       v_hq,'0912-deliberation',array[v_current_round]))<>1
     or (select count(*) from climate_vote.hq_votes_v2(
       v_hq,'0912-deliberation',array[v_current_round]))<>1 then
    raise exception 'scoped HQ grid positive contract failed';
  end if;
  if (select count(*) from climate_vote.mod_session_teams_v2(v_team_token))<>2
     or (select count(*) from climate_vote.mod_rounds_v2(v_team_token))<1
     or (select sum(vote_count) from climate_vote.mod_vote_counts_v2(
       v_team_token,array[v_current_round]))<>1
     or (select count(*) from climate_vote.mod_votes_v2(v_team_token,v_current_round))<>1
     or climate_vote.attendance_round_eligible_count_v2(v_team_token,v_current_round)
          is distinct from climate_vote.attendance_round_eligible_count(v_current_round) then
    raise exception 'scoped team grid positive contract failed';
  end if;
  if (select count(*) from climate_vote.public_round_get_v2(v_current_round))<>1
     or climate_vote.public_round_cast_v2(v_current_round,'"no"','public-device-1')<>'ok'
     or climate_vote.public_round_cast_v2(v_current_round,'"no"','public-device-1')<>'duplicate' then
    raise exception 'public round capability positive/duplicate contract failed';
  end if;
  if (select count(*) from climate_vote.public_round_get_v2(v_unbound_round))<>1 then
    raise exception 'legacy unbound public round read compatibility failed';
  end if;
  begin
    perform climate_vote.public_round_cast_v2(
      v_unbound_round,'"yes"','public-unbound-write-device');
    raise exception 'legacy unbound public round accepted a new vote';
  exception when others then
    if sqlerrm='legacy unbound public round accepted a new vote' then raise; end if;
    if position('public round not found' in sqlerrm)=0 then raise; end if;
  end;
  if exists(select 1 from climate_vote.votes where round_id=v_unbound_round) then
    raise exception 'rejected legacy unbound public cast changed vote state';
  end if;
  select count(*) into v_count from climate_vote.votes where round_id=v_current_round;
  foreach v_lifecycle_status in array array['draft','closed','archived'] loop
    update climate_vote.session set status=v_lifecycle_status
     where slug='0912-deliberation';
    begin
      perform climate_vote.public_round_cast_v2(
        v_current_round,'"yes"','public-lifecycle-'||v_lifecycle_status);
      raise exception 'inactive session public cast unexpectedly accepted: %',v_lifecycle_status;
    exception when others then
      if sqlerrm like 'inactive session public cast unexpectedly accepted:%' then raise; end if;
    end;
  end loop;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.org set status='suspended'
   where id='91200000-0000-0000-0000-000000000001';
  begin
    perform climate_vote.public_round_cast_v2(
      v_current_round,'"yes"','public-inactive-org');
    raise exception 'inactive organization public cast unexpectedly accepted';
  exception when others then
    if sqlerrm='inactive organization public cast unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.org set status='active'
   where id='91200000-0000-0000-0000-000000000001';
  update climate_vote.assembly set status='closed'
   where id='91200000-0000-0000-0000-000000000002';
  begin
    perform climate_vote.public_round_cast_v2(
      v_current_round,'"yes"','public-inactive-assembly');
    raise exception 'inactive assembly public cast unexpectedly accepted';
  exception when others then
    if sqlerrm='inactive assembly public cast unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.assembly set status='active',archived_at=now()
   where id='91200000-0000-0000-0000-000000000002';
  begin
    perform climate_vote.public_round_cast_v2(
      v_current_round,'"yes"','public-archived-assembly');
    raise exception 'archived assembly public cast unexpectedly accepted';
  exception when others then
    if sqlerrm='archived assembly public cast unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.assembly set archived_at=null
   where id='91200000-0000-0000-0000-000000000002';
  update climate_vote.session set access_expires_at=null where slug='0912-deliberation';
  begin
    perform climate_vote.public_round_cast_v2(
      v_current_round,'"yes"','public-NULL-expiry');
    raise exception 'NULL-expiry public cast unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL-expiry public cast unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()-interval '1 minute'
   where slug='0912-deliberation';
  begin
    perform climate_vote.public_round_cast_v2(
      v_current_round,'"yes"','public-expired-session');
    raise exception 'expired session public cast unexpectedly accepted';
  exception when others then
    if sqlerrm='expired session public cast unexpectedly accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()+interval '36 hours'
   where slug='0912-deliberation';
  if (select count(*) from climate_vote.votes where round_id=v_current_round)<>v_count then
    raise exception 'rejected public lifecycle cast changed vote state';
  end if;
  -- Closed aggregates and metadata are intentionally historical read-only
  -- capabilities after a session closes; only new casts require an active window.
  update climate_vote.rounds set status='closed' where id=v_current_round;
  update climate_vote.session set status='closed' where slug='0912-deliberation';
  if (select count(*) from climate_vote.public_round_get_v2(v_current_round))<>1
     or (select max(total_votes) from climate_vote.public_round_votes_v2(v_current_round))<>v_count then
    raise exception 'closed historical public read policy failed';
  end if;
  update climate_vote.session set status='active' where slug='0912-deliberation';
  update climate_vote.rounds set status='active' where id=v_current_round;
  begin
    perform climate_vote.public_round_cast_v2(v_current_round,'"tampered"','public-device-2');
    raise exception 'invalid public vote choice unexpectedly accepted';
  exception when others then
    if sqlerrm='invalid public vote choice unexpectedly accepted' then raise; end if;
    if position('invalid public vote choice' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.votes where round_id=v_current_round)<>v_count then
    raise exception 'invalid public vote choice changed state';
  end if;
  begin
    perform climate_vote.public_round_cast_v2(v_current_round,null,'public-device-null');
    raise exception 'NULL public vote choice unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL public vote choice unexpectedly accepted' then raise; end if;
    if position('public vote choice required' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.votes where round_id=v_current_round)<>v_count then
    raise exception 'NULL public vote choice changed state';
  end if;
  update climate_vote.rounds set status='closed' where id=v_current_round;
  update climate_vote.rounds set status='active' where id=v_checkbox_round;
  if climate_vote.public_round_cast_v2(
       v_checkbox_round,'["yes","no"]','public-checkbox-device-1')<>'ok' then
    raise exception 'valid checkbox public vote was rejected';
  end if;
  select count(*) into v_count from climate_vote.votes where round_id=v_checkbox_round;
  begin
    perform climate_vote.public_round_cast_v2(
      v_checkbox_round,'["yes","tampered"]','public-checkbox-device-2');
    raise exception 'invalid checkbox public vote choice unexpectedly accepted';
  exception when others then
    if sqlerrm='invalid checkbox public vote choice unexpectedly accepted' then raise; end if;
    if position('invalid public vote choice' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.votes where round_id=v_checkbox_round)<>v_count then
    raise exception 'invalid checkbox public vote choice changed state';
  end if;
  update climate_vote.rounds set status='closed' where id=v_checkbox_round;
  if (select max(total_votes) from climate_vote.public_round_votes_v2(v_current_round))<>2
     or climate_vote.public_round_cast_v2(v_current_round,'"yes"','public-device-3')<>'closed' then
    raise exception 'public aggregate/closed contract failed';
  end if;
  select to_jsonb(a) into v_attendance_before from climate_vote.attendance a
   where a.assignment_id=v_current_assignment;
  select count(*) into v_audit_count from climate_vote.attendance_audit_log;
  begin
    perform climate_vote.attendance_set_v2(v_team_token,'0912-deliberation',
      v_current_assignment,null,now());
    raise exception 'NULL attendance action unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL attendance action unexpectedly accepted' then raise; end if;
    if position('invalid attendance action' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_set_v2(v_team_token,'0912-deliberation',
      v_current_assignment,'present',null);
    raise exception 'NULL attendance time unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL attendance time unexpectedly accepted' then raise; end if;
    if position('attendance occurrence time required' in sqlerrm)=0 then raise; end if;
  end;
  if (select to_jsonb(a) from climate_vote.attendance a
       where a.assignment_id=v_current_assignment) is distinct from v_attendance_before
     or (select count(*) from climate_vote.attendance_audit_log)<>v_audit_count then
    raise exception 'NULL attendance input changed state or audit';
  end if;
  perform climate_vote.attendance_set_v2(v_team_token,'0912-deliberation',
    v_current_assignment,'present',now());
  if climate_vote.attendance_bulk_present_v2(v_team_token,'0912-deliberation',
      array[v_current_assignment])<>1 then
    raise exception 'scoped attendance bulk positive contract failed';
  end if;
  perform climate_vote.attendance_set_v2(v_team_token,'0912-deliberation',
    v_current_assignment,'unconfirmed',now());
  if climate_vote.attendance_finalize_absent_v2(v_team_token,'0912-deliberation')<>1 then
    raise exception 'scoped attendance finalize positive contract failed';
  end if;
  select m.name into v_member_name_before from climate_vote.team_assignment ta
    join climate_vote.assembly_member m on m.id=ta.member_id
   where ta.id=v_current_assignment;
  begin
    perform climate_vote.attendance_member_save_v2(v_team_token,'0912-deliberation',
      v_current_assignment,null,'Should not save',null,true);
    raise exception 'NULL official id unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL official id unexpectedly accepted' then raise; end if;
    if position('invalid member fields' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_member_save_v2(v_team_token,'0912-deliberation',
      v_current_assignment,'P1A-CURRENT',null,null,true);
    raise exception 'NULL member name unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL member name unexpectedly accepted' then raise; end if;
    if position('invalid member fields' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_member_save_v2(v_team_token,'0912-deliberation',
      v_current_assignment,'P1A-CURRENT','Should not save',null,null);
    raise exception 'NULL member active flag unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL member active flag unexpectedly accepted' then raise; end if;
    if position('member active flag required' in sqlerrm)=0 then raise; end if;
  end;
  if (select m.name from climate_vote.team_assignment ta
      join climate_vote.assembly_member m on m.id=ta.member_id
      where ta.id=v_current_assignment) is distinct from v_member_name_before then
    raise exception 'NULL member input changed member state';
  end if;
  perform climate_vote.attendance_member_save_v2(v_team_token,'0912-deliberation',
    v_current_assignment,'P1A-CURRENT','Current synthetic member updated',null,true);
  select attendance_pin_hash into v_pin_before from climate_vote.team
   where id='91200000-0000-0000-0000-000000000011';
  begin
    perform climate_vote.attendance_hq_set_team_pin_v2(v_hq,'0912-deliberation',
      '91200000-0000-0000-0000-000000000011',null);
    raise exception 'NULL team PIN unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL team PIN unexpectedly accepted' then raise; end if;
    if position('PIN must be 6 to 10 digits' in sqlerrm)=0 then raise; end if;
  end;
  if (select attendance_pin_hash from climate_vote.team
       where id='91200000-0000-0000-0000-000000000011') is distinct from v_pin_before then
    raise exception 'NULL team PIN changed PIN state';
  end if;
  perform climate_vote.attendance_hq_set_team_pin_v2(v_hq,'0912-deliberation',
    '91200000-0000-0000-0000-000000000011','123456');
  perform climate_vote.attendance_hq_set_table_no_v2(v_hq,'0912-deliberation',
    '91200000-0000-0000-0000-000000000011','A-02');
  if (select count(*) from climate_vote.attendance_hq_audit_v2(
      v_hq,'0912-deliberation',200))<5 then
    raise exception 'scoped attendance audit positive contract failed';
  end if;

  select s.id into v_current_submission from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id=s.topic_id
   where dt.session_id='91200000-0000-0000-0000-000000000003'
     and s.team_id='91200000-0000-0000-0000-000000000011' limit 1;
  select version,updated_at into v_version,v_updated_at
    from climate_vote.submission where id=v_current_submission;
  update climate_vote.submission set status='final' where id=v_current_submission;
  v_reopen:=climate_vote.submission_reopen_v2(v_hq,'0912-deliberation',
    v_current_submission,'Scoped reopen verification');
  if v_reopen->>'status'<>'reopened'
     or (v_reopen->>'version')::bigint<>v_version+1
     or (select version from climate_vote.submission where id=v_current_submission)<>v_version+1
     or (v_reopen->>'updated_at')::timestamptz is distinct from
        (select updated_at from climate_vote.submission where id=v_current_submission)
     or (select updated_at from climate_vote.submission where id=v_current_submission)<v_updated_at then
    raise exception 'HQ reopen did not advance the submission generation: %',v_reopen;
  end if;
  select dt.status into v_topic_status from climate_vote.discussion_topic dt
   where dt.id=(select topic_id from climate_vote.submission where id=v_current_submission);
  update climate_vote.discussion_topic set status='open'
   where id=(select topic_id from climate_vote.submission where id=v_current_submission);
  v_stale:=climate_vote.submission_save_v3(v_team_token,
    (select topic_id from climate_vote.submission where id=v_current_submission),
    '[{"ordinal":1,"kind":"core","content":"pre-reopen stale overwrite"}]'::jsonb,
    v_version,gen_random_uuid(),false);
  if v_stale->>'status'<>'conflict'
     or (v_stale->>'version')::bigint<>v_version+1
     or exists(select 1 from climate_vote.submission_item
       where submission_id=v_current_submission and content='pre-reopen stale overwrite') then
    raise exception 'pre-reopen stale save crossed the HQ generation boundary: %',v_stale;
  end if;
  update climate_vote.discussion_topic set status=v_topic_status
   where id=(select topic_id from climate_vote.submission where id=v_current_submission);
  select count(*) into v_count from climate_vote.submission_category_event;
  begin
    perform climate_vote.hq_submission_category_assign_v2(v_hq,'0912-deliberation',
      v_current_submission,null,'common');
    raise exception 'NULL category ordinal unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL category ordinal unexpectedly accepted' then raise; end if;
    if position('invalid item ordinal' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.submission_category_event)<>v_count then
    raise exception 'NULL category ordinal appended an event';
  end if;
  select count(*) into v_count from climate_vote.submission_kind_event;
  begin
    perform climate_vote.hq_submission_kind_assign_v2(v_hq,'0912-deliberation',
      v_current_submission,null,'Claim');
    raise exception 'NULL kind ordinal unexpectedly accepted';
  exception when others then
    if sqlerrm='NULL kind ordinal unexpectedly accepted' then raise; end if;
    if position('invalid item ordinal' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from climate_vote.submission_kind_event)<>v_count then
    raise exception 'NULL kind ordinal appended an event';
  end if;
  perform climate_vote.hq_submission_category_assign_v2(v_hq,'0912-deliberation',
    v_current_submission,1,'common');
  perform climate_vote.hq_submission_kind_assign_v2(v_hq,'0912-deliberation',
    v_current_submission,1,'Claim');
  if (select count(*) from climate_vote.hq_submissions_v2(v_hq,'0912-deliberation'))<2
     or (select count(*) from climate_vote.hq_submission_history_v2(v_hq,'0912-deliberation'))<1
     or (select count(*) from climate_vote.hq_submission_categories_v2(v_hq,'0912-deliberation'))<>1
     or (select count(*) from climate_vote.hq_submission_kinds_v2(v_hq,'0912-deliberation'))<>1
     or (select count(*) from climate_vote.hq_topic_deadlines_v2(v_hq,'0912-deliberation'))<1 then
    raise exception 'scoped HQ submission reader positive contract failed';
  end if;

  begin
    perform * from climate_vote.attendance_roster_v2(v_hq,'p1a-verify-other');
    raise exception 'same-org cross-session attendance read unexpectedly accepted';
  exception when others then
    if sqlerrm='same-org cross-session attendance read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_submissions_v2(v_hq,'p1a-foreign-session');
    raise exception 'cross-org HQ submission read unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-org HQ submission read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_rounds_v2(v_hq,'p1a-verify-other');
    raise exception 'same-org cross-session HQ grid read unexpectedly accepted';
  exception when others then
    if sqlerrm='same-org cross-session HQ grid read unexpectedly accepted' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_votes_v2(
      v_hq,'0912-deliberation',array[v_other_round]);
    raise exception 'cross-session round id unexpectedly accepted by HQ grid';
  exception when others then
    if sqlerrm='cross-session round id unexpectedly accepted by HQ grid' then raise; end if;
  end;
  begin
    perform * from climate_vote.hq_vote_counts_v2(
      v_hq,'0912-deliberation',array[v_foreign_round]);
    raise exception 'cross-org round id unexpectedly accepted by HQ grid';
  exception when others then
    if sqlerrm='cross-org round id unexpectedly accepted by HQ grid' then raise; end if;
  end;
  begin
    perform * from climate_vote.mod_votes_v2(v_team_token,v_other_team_round);
    raise exception 'cross-team round id unexpectedly accepted by team read';
  exception when others then
    if sqlerrm='cross-team round id unexpectedly accepted by team read' then raise; end if;
  end;
  begin
    perform climate_vote.attendance_round_eligible_count_v2(
      v_team_token,v_other_team_round);
    raise exception 'cross-team eligible count unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-team eligible count unexpectedly accepted' then raise; end if;
    if position('round not in token team/session scope' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform climate_vote.attendance_set_v2(v_hq,'0912-deliberation',
      v_other_assignment,'present',now());
    raise exception 'cross-session attendance mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-session attendance mutation unexpectedly accepted' then raise; end if;
  end;
  select table_no into v_table_before from climate_vote.team where id=v_foreign_team;
  begin
    perform climate_vote.attendance_hq_set_table_no_v2(v_hq,'0912-deliberation',
      v_foreign_team,'COMPROMISED');
    raise exception 'cross-org attendance admin mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-org attendance admin mutation unexpectedly accepted' then raise; end if;
  end;
  if (select table_no from climate_vote.team where id=v_foreign_team) is distinct from v_table_before then
    raise exception 'cross-org attendance target changed after rejection';
  end if;
  begin
    perform climate_vote.submission_reopen_v2(v_hq,'0912-deliberation',
      v_foreign_submission,'Must be rejected');
    raise exception 'cross-org submission reopen unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-org submission reopen unexpectedly accepted' then raise; end if;
  end;
  begin
    perform climate_vote.hq_submission_category_assign_v2(v_hq,'0912-deliberation',
      v_foreign_submission,1,'common');
    raise exception 'cross-org category mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-org category mutation unexpectedly accepted' then raise; end if;
  end;
  begin
    perform climate_vote.hq_submission_kind_assign_v2(v_hq,'0912-deliberation',
      v_foreign_submission,1,'Claim');
    raise exception 'cross-org kind mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-org kind mutation unexpectedly accepted' then raise; end if;
  end;

  select i.id,s.version into v_linked_item,v_version
    from climate_vote.submission_item i
    join climate_vote.submission s on s.id=i.submission_id
   where s.id=v_current_submission order by i.ordinal limit 1;
  if to_regclass('climate_vote.issue_link') is not null then
    insert into climate_vote.issue(id,topic_id,label,origin,review_status,org_id)
    select v_issue,s.topic_id,'Clear guard verification','human','draft',s.org_id
      from climate_vote.submission s where s.id=v_current_submission;
    insert into climate_vote.issue_link(issue_id,item_id,linked_by)
    values(v_issue,v_linked_item,'human');
    begin
      perform climate_vote.hq_clear_submissions_v2(
        v_hq,'0912-deliberation','전체 비우기');
      raise exception 'linked submission clear unexpectedly succeeded';
    exception when others then
      if sqlerrm='linked submission clear unexpectedly succeeded' then raise; end if;
      if position('분석에 연결된 원문' in sqlerrm)=0 then raise; end if;
    end;
    if not exists(select 1 from climate_vote.submission_item where id=v_linked_item)
       or (select version from climate_vote.submission where id=v_current_submission)<>v_version then
      raise exception 'failed linked clear changed source or submission version';
    end if;
    delete from climate_vote.issue_link where issue_id=v_issue and item_id=v_linked_item;
  end if;

  v_clear:=climate_vote.hq_clear_submissions_v2(
    v_hq,'0912-deliberation','전체 비우기');
  if (v_clear->>'cleared_submissions')::int<1
     or not exists(select 1 from climate_vote.submission_item where submission_id=v_foreign_submission) then
    raise exception 'scoped clear crossed the session/org boundary: %',v_clear;
  end if;
  if (select version from climate_vote.submission where id=v_current_submission)<>v_version+1 then
    raise exception 'clear did not increment submission CAS version';
  end if;
  -- The earlier HQ transition test intentionally closed this topic. Re-open it
  -- so this assertion reaches the submission version CAS instead of failing at
  -- the independent topic-lifecycle guard.
  update climate_vote.discussion_topic set status='open'
   where id=(select topic_id from climate_vote.submission where id=v_current_submission);
  v_stale:=climate_vote.submission_save_v3(v_team_token,
    (select topic_id from climate_vote.submission where id=v_current_submission),
    '[{"ordinal":1,"kind":"core","content":"stale restore"}]'::jsonb,
    v_version,gen_random_uuid(),false);
  if v_stale->>'status'<>'conflict'
     or exists(select 1 from climate_vote.submission_item
       where submission_id=v_current_submission and content='stale restore') then
    raise exception 'pre-clear stale save restored cleared content: %',v_stale;
  end if;
end $scoped_attendance_hq$;

-- The anonymous ballot token is a narrow participation capability, not a
-- tenancy bypass. It may write only while ballot, session, assembly, and
-- organization are all active and the event hard window is still open.
do $public_ballot_lifecycle$
declare
  v_ballot_id uuid:='91200000-0000-0000-0000-000000000801';
  v_item_id uuid:='91200000-0000-0000-0000-000000000802';
  v_session_id uuid:='91200000-0000-0000-0000-000000000003';
  v_assembly_id uuid:='91200000-0000-0000-0000-000000000002';
  v_org_id uuid:='91200000-0000-0000-0000-000000000001';
  v_token text:='p1a-open-ballot-capability-00001';
  v_status text; v_before bigint; v_expiry timestamptz; v_result jsonb;
begin
  insert into climate_vote.ballot(
    id,session_id,title,status,token,created_by,org_id,subgroup)
  values(v_ballot_id,v_session_id,'P1a public ballot lifecycle','open',v_token,
    'verify',v_org_id,null);
  insert into climate_vote.ballot_item(
    id,ballot_id,ordinal,statement,scale,required)
  values(v_item_id,v_ballot_id,1,'P1a public ballot item',5,true);
  v_before:=(select count(*) from climate_vote.ballot_response
    where ballot_id=v_ballot_id);
  select access_expires_at into v_expiry from climate_vote.session
    where id=v_session_id;

  foreach v_status in array array['draft','closed','archived'] loop
    update climate_vote.session set status=v_status where id=v_session_id;
    begin
      perform climate_vote.ballot_submit(v_token,'p1a-ballot-session-'||v_status,
        jsonb_build_object(v_item_id::text,5));
      raise exception 'inactive session ballot submit accepted: %',v_status;
    exception when others then
      if sqlerrm like 'inactive session ballot submit accepted:%' then raise; end if;
    end;
  end loop;
  update climate_vote.session set status='active' where id=v_session_id;

  update climate_vote.assembly set status='closed' where id=v_assembly_id;
  begin
    perform climate_vote.ballot_submit(v_token,'p1a-ballot-assembly-closed',
      jsonb_build_object(v_item_id::text,5));
    raise exception 'inactive assembly ballot submit accepted';
  exception when others then
    if sqlerrm='inactive assembly ballot submit accepted' then raise; end if;
  end;
  update climate_vote.assembly set status='active',archived_at=now()
    where id=v_assembly_id;
  begin
    perform climate_vote.ballot_submit(v_token,'p1a-ballot-assembly-archive',
      jsonb_build_object(v_item_id::text,5));
    raise exception 'archived assembly ballot submit accepted';
  exception when others then
    if sqlerrm='archived assembly ballot submit accepted' then raise; end if;
  end;
  update climate_vote.assembly set archived_at=null where id=v_assembly_id;

  update climate_vote.org set status='suspended' where id=v_org_id;
  begin
    perform climate_vote.ballot_submit(v_token,'p1a-ballot-org-suspended',
      jsonb_build_object(v_item_id::text,5));
    raise exception 'suspended organization ballot submit accepted';
  exception when others then
    if sqlerrm='suspended organization ballot submit accepted' then raise; end if;
  end;
  update climate_vote.org set status='active' where id=v_org_id;

  update climate_vote.session set access_expires_at=null where id=v_session_id;
  begin
    perform climate_vote.ballot_submit(v_token,'p1a-ballot-null-expiry',
      jsonb_build_object(v_item_id::text,5));
    raise exception 'NULL-expiry ballot submit accepted';
  exception when others then
    if sqlerrm='NULL-expiry ballot submit accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=now()-interval '1 minute'
    where id=v_session_id;
  begin
    perform climate_vote.ballot_submit(v_token,'p1a-ballot-expired',
      jsonb_build_object(v_item_id::text,5));
    raise exception 'expired ballot submit accepted';
  exception when others then
    if sqlerrm='expired ballot submit accepted' then raise; end if;
  end;
  update climate_vote.session set access_expires_at=v_expiry where id=v_session_id;

  if (select count(*) from climate_vote.ballot_response
       where ballot_id=v_ballot_id)<>v_before then
    raise exception 'rejected ballot lifecycle submit changed response state';
  end if;
  v_result:=climate_vote.ballot_submit(v_token,'p1a-ballot-client-valid-0001',
    jsonb_build_object(v_item_id::text,5));
  if v_result->>'ok'<>'true'
     or (select org_id from climate_vote.ballot_response
          where ballot_id=v_ballot_id and client_id='p1a-ballot-client-valid-0001')
        is distinct from v_org_id then
    raise exception 'valid ballot submit did not preserve owning organization';
  end if;
end $public_ballot_lifecycle$;

rollback;

select 'platform_p1a_0912_event_access verification passed' as result;
