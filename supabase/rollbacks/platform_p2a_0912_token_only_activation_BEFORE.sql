-- Emergency rollback for platform_p2a_0912_token_only_activation.sql.
-- Restores legacy PostgREST client behavior without reopening EXECUTE to PUBLIC.
-- DANGER: this intentionally reopens predictable-code and broad vote surfaces.
-- It must be time-boxed and followed by a P2a reapply. Set both session-local
-- acknowledgements in the same psql connection only after incident approval.

do $rollback_guard$
begin
  if current_setting('climate_vote.emergency_rollback_ack',true)
       is distinct from 'I_ACCEPT_LEGACY_ACCESS_REOPEN' then
    raise exception 'emergency rollback blocked: explicit legacy-access acknowledgement required';
  end if;
  if nullif(trim(coalesce(
       current_setting('climate_vote.emergency_rollback_incident',true),'')), '') is null then
    raise exception 'emergency rollback blocked: incident reference required';
  end if;
end $rollback_guard$;

begin;

-- Return to the deliberately narrow P1a pre-cutover surface. HQ status and
-- rotation remain available so operators can inspect/rotate safely.
revoke execute on function
  climate_vote.mod_exchange_join_code(text,uuid,text),
  climate_vote.mod_session_get(text),
  climate_vote.topic_list_v2(text),
  climate_vote.attendance_round_eligible_count_v2(text,text),
  climate_vote.submission_get_v2(text,uuid),
  climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean),
  climate_vote.submission_finalize_v2(text,uuid,bigint),
  climate_vote.submission_reopen_by_team_v2(text,uuid),
  climate_vote.mod_create_round_v2(text,text,text,jsonb),
  climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid),
  climate_vote.mod_set_round_status_v2(text,text,text),
  climate_vote.mod_set_round_status_v3(text,text,text,text,uuid),
  climate_vote.mod_proxy_vote_v2(text,text,jsonb,int),
  climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid),
  climate_vote.mod_log_timer_v2(text,text,int,timestamptz,timestamptz),
  climate_vote.ballot_create_v2(text,text,text,jsonb,text),
  climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid),
  climate_vote.ballot_set_status_v2(text,uuid,text),
  climate_vote.ballot_list_v2(text),
  climate_vote.ballot_results_v2(text,text),
  climate_vote.workshop_hq_open_next_topic(text,text,int,uuid),
  climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid),
  climate_vote.workshop_hq_devices(text,text),
  climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid),
  climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamptz,timestamptz,uuid),
  climate_vote.workshop_team_logout_v2(text),
  climate_vote.hq_submissions_v3(text,text),
  climate_vote.hq_submission_category_assign_v3(
    text,text,uuid,int,text,timestamptz,bigint,uuid),
  climate_vote.hq_submission_categories_v3(text,text),
  climate_vote.hq_submission_kind_assign_v3(
    text,text,uuid,int,text,timestamptz,bigint,uuid),
  climate_vote.hq_submission_kinds_v3(text,text),
  climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid),
  climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid),
  climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid),
  climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid),
  climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid),
  climate_vote.platform_result_implementation_upsert_v3(
    uuid,text,uuid,jsonb,text,uuid)
from anon, authenticated;

-- Re-enable the P1a emergency review adapters only for authenticated staff.
-- P2a's snapshot-CAS review/merge and atomic reclassification stay closed so
-- an old client cannot mix incompatible mutation contracts after rollback.
revoke execute on function
  climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid),
  climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid),
  climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid),
  climate_vote.platform_issue_merge_v2(uuid,uuid,uuid),
  climate_vote.platform_issue_review_v2(uuid,uuid),
  climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid),
  climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid),
  climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb),
  climate_vote.platform_result_implementation_upsert_v3(
    uuid,text,uuid,jsonb,text,uuid)
from public, anon, authenticated;
grant execute on function
  climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb),
  climate_vote.platform_issue_link_set_v2(uuid,uuid,uuid[],uuid),
  climate_vote.platform_issue_merge_v2(uuid,uuid,uuid),
  climate_vote.platform_issue_review_v2(uuid,uuid),
  climate_vote.platform_result_implementation_upsert_v2(uuid,text,uuid,jsonb)
to authenticated;

-- Restore the pre-cutover public body shape. Immutable implementation audit
-- events remain intact, so reapplying P2a can deterministically add the CAS
-- token again without losing staff history.
with implementation_snapshots as (
  select rp.id,
    jsonb_agg(
      case when jsonb_typeof(issue->'implementation')='object' then
        jsonb_set(issue,'{implementation}',
          (issue->'implementation')-'snapshot_hash',true)
      else issue end order by ordinality) as issues
  from climate_vote.result_page rp
  cross join lateral jsonb_array_elements(case
    when jsonb_typeof(rp.body->'issues')='array' then rp.body->'issues'
    else '[]'::jsonb end)
    with ordinality as x(issue,ordinality)
  where exists(select 1 from jsonb_array_elements(case
      when jsonb_typeof(rp.body->'issues')='array' then rp.body->'issues'
      else '[]'::jsonb end) candidate
    where jsonb_typeof(candidate->'implementation')='object'
      and (candidate->'implementation') ? 'snapshot_hash')
  group by rp.id
)
update climate_vote.result_page rp
   set body=jsonb_set(rp.body,'{issues}',s.issues,true)
  from implementation_snapshots s where s.id=rp.id;

-- Restore the P1a read/compatibility HQ surface that P2a replaced with v3.
grant execute on function
  climate_vote.hq_submissions_v2(text,text),
  climate_vote.hq_submission_category_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_categories_v2(text,text),
  climate_vote.hq_submission_kind_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_kinds_v2(text,text),
  climate_vote.hq_clear_submissions_v2(text,text,text)
to anon, authenticated;

grant execute on function
  climate_vote.mod_join(text),
  climate_vote.mod_create_round(text,text,text,jsonb),
  climate_vote.mod_set_round_status(text,text,text),
  climate_vote.mod_proxy_vote(text,text,jsonb,int),
  climate_vote.mod_log_timer(text,text,int,timestamptz,timestamptz),
  climate_vote.topic_list(text),
  climate_vote.topic_set_deadline(text,uuid,timestamptz),
  climate_vote.readiness_check(uuid),
  climate_vote.org_of_code(text),
  climate_vote.attendance_team_unlock_by_code(text),
  climate_vote.attendance_round_eligible_count(text),
  climate_vote.attendance_roster(text),
  climate_vote.attendance_hq_summary(),
  climate_vote.attendance_set(text,uuid,text,timestamptz),
  climate_vote.attendance_bulk_present(text,uuid[]),
  climate_vote.attendance_finalize_absent(text),
  climate_vote.attendance_member_save(text,uuid,text,text,uuid,boolean),
  climate_vote.attendance_hq_audit(text,int),
  climate_vote.attendance_hq_set_team_pin(text,uuid,text),
  climate_vote.attendance_hq_set_table_no(text,uuid,text),
  climate_vote.hq_teams(),
  climate_vote.hq_submissions(text,text),
  climate_vote.submission_reopen(text,uuid,text),
  climate_vote.hq_submission_history(text,text),
  climate_vote.hq_submission_category_assign(text,uuid,int,text),
  climate_vote.hq_submission_categories(text,text),
  climate_vote.hq_submission_kind_assign(text,uuid,int,text),
  climate_vote.hq_submission_kinds(text,text),
  climate_vote.hq_topic_deadlines(text,text),
  climate_vote.hq_clear_submissions(text,text,text),
  climate_vote.submission_get(text,uuid),
  climate_vote.submission_save(text,uuid,jsonb),
  climate_vote.submission_save_v2(text,uuid,jsonb),
  climate_vote.submission_finalize(text,uuid),
  climate_vote.submission_finalize_hq(text,uuid,text),
  climate_vote.submission_reopen_by_team(text,uuid),
  climate_vote.ballot_create(text,text,text,jsonb,text),
  climate_vote.ballot_set_status(text,uuid,text),
  climate_vote.ballot_list(text),
  climate_vote.issue_items(text,uuid),
  climate_vote.issue_list(text,uuid),
  climate_vote.issue_upsert(text,uuid,jsonb),
  climate_vote.issue_link_set(text,uuid,uuid[],uuid),
  climate_vote.issue_merge(text,uuid,uuid),
  climate_vote.issue_review(text,uuid),
  climate_vote.result_publish(text,text,uuid,text),
  climate_vote.result_unpublish(text,uuid)
to anon, authenticated;

-- Emergency rollback restores the historical code-only attendance client and
-- org-code lookup, but not the retired PIN endpoint or unused token-to-org
-- oracle. HQ bootstrap and scoped staff readiness stay explicit.
revoke execute on function climate_vote.attendance_team_unlock(text,text)
from public, anon, authenticated;
revoke execute on function climate_vote.org_of_token(text)
from public, anon, authenticated;
revoke execute on function
  climate_vote.attendance_hq_unlock(text,text),
  climate_vote.attendance_hq_unlock_named(text,text),
  climate_vote.hq_change_password(text,text,text),
  climate_vote.workshop_hq_logout_v2(text)
from public, anon, authenticated;
grant execute on function
  climate_vote.attendance_hq_unlock(text,text),
  climate_vote.attendance_hq_unlock_named(text,text),
  climate_vote.hq_change_password(text,text,text),
  climate_vote.workshop_hq_logout_v2(text)
to anon, authenticated;

-- Emergency compatibility only: restore the historical broad voter/HQ table
-- surface together with the legacy RPCs. Normal operation must keep it closed.
grant select on table climate_vote.rounds to anon, authenticated;
grant select, insert on table climate_vote.votes to anon, authenticated;

do $legacy_vote_views$
begin
  if to_regclass('public.cv_votes') is not null then
    execute 'grant select, insert on table public.cv_votes to anon, authenticated';
  end if;
  if to_regclass('public.cv_rounds') is not null then
    execute 'grant select on table public.cv_rounds to anon, authenticated';
  end if;
  if to_regclass('public.cv_tally') is not null then
    execute 'grant select on table public.cv_tally to anon, authenticated';
  end if;
  if to_regclass('public.cv_tally_scale') is not null then
    execute 'grant select on table public.cv_tally_scale to anon, authenticated';
  end if;
end $legacy_vote_views$;

do $optional_legacy$
begin
  if to_regprocedure(
    'climate_vote.result_implementation_upsert(text,text,uuid,jsonb)') is not null then
    execute 'grant execute on function climate_vote.result_implementation_upsert(text,text,uuid,jsonb) to anon, authenticated';
  end if;
end $optional_legacy$;

-- Restore the pre-activation moderator-code bypass for emergency old-client
-- operation. Reapplying P2a removes it again.
create or replace function climate_vote.ballot_results(
  p_token text, p_code text default null)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_ballot climate_vote.ballot; v_is_mod boolean:=false; v_out jsonb;
begin
  select * into v_ballot from climate_vote.ballot where token=p_token;
  if not found then return null; end if;
  if p_code is not null then
    select true into v_is_mod from climate_vote.team
     where join_code=p_code and status='active' and session_id=v_ballot.session_id;
    v_is_mod:=coalesce(v_is_mod,false);
  end if;
  if not v_is_mod and v_ballot.status<>'published' then return null; end if;

  select jsonb_build_object(
    'id',v_ballot.id,'title',v_ballot.title,'status',v_ballot.status,
    'subgroup',v_ballot.subgroup,
    'responses',(select count(*) from climate_vote.ballot_response br
                 where br.ballot_id=v_ballot.id),
    'items',coalesce(jsonb_agg(item_agg order by item_ord),'[]'::jsonb))
  into v_out
  from (
    select bi.ordinal item_ord,
      jsonb_build_object(
        'id',bi.id,'ordinal',bi.ordinal,'statement',bi.statement,'scale',bi.scale,
        'n',count(v.val),'avg',round(avg(v.val)::numeric,2),
        'dist',(select coalesce(jsonb_object_agg(d.k,d.c),'{}'::jsonb)
          from (select (br2.answers->>(bi.id::text))::int k,count(*) c
            from climate_vote.ballot_response br2
            where br2.ballot_id=bi.ballot_id
              and (br2.answers->>(bi.id::text)) is not null group by 1)d)
      ) item_agg
    from climate_vote.ballot_item bi
    left join lateral(
      select (br.answers->>(bi.id::text))::int val
      from climate_vote.ballot_response br
      where br.ballot_id=bi.ballot_id
        and (br.answers->>(bi.id::text)) is not null
    )v on true
    where bi.ballot_id=v_ballot.id
    group by bi.id,bi.ordinal,bi.statement,bi.scale,bi.ballot_id
  )agg;
  return v_out;
end $fn$;

revoke execute on function climate_vote.ballot_results(text,text) from public;
grant execute on function climate_vote.ballot_results(text,text) to anon, authenticated;

-- Restore the pre-cutover shared-HQ compatibility validator. Bearers revoked
-- by the activation stay revoked; a rollback can only mint new shared tokens.
create or replace function climate_vote.workshop_hq_session_row(
  p_token text, p_session_slug text)
returns climate_vote.session language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' or v_auth.purpose <> 'hq'
     or v_auth.session_id is null or v_auth.org_id is null then
    raise exception 'HQ authorization required';
  end if;
  select s.* into v_session from climate_vote.session s
    join climate_vote.assembly a on a.id=s.assembly_id
    join climate_vote.org o on o.id=a.org_id
   where s.slug = p_session_slug and s.id = v_auth.session_id
     and s.org_id = v_auth.org_id and a.org_id=v_auth.org_id
     and o.id=v_auth.org_id and o.status='active' and o.archived_at is null
     and a.status='active' and a.archived_at is null and s.status='active'
     and s.access_expires_at is not null and s.access_expires_at>now();
  if not found then raise exception 'HQ authorization session mismatch'; end if;
  return v_session;
end $fn$;

commit;
