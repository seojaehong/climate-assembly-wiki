-- platform P2a: explicit 9/12 token-only activation
-- ORDER: P1 -> reviewed 0912 seed/s20 -> P1a -> P2 -> P1b/P1c -> this P2a -> P3 -> P4
--
-- HOLD: do not apply until the token/staff clients are deployed and rehearsed.
-- P1a deliberately keeps team-token exchange locked. Use the documented
-- maintenance window: rotate codes, deploy the client, then apply this atomic
-- grant-and-legacy-revoke cutover before distributing the rotated codes.

begin;

-- Six-digit join codes bootstrap short-lived workshop tokens only. They are no
-- longer accepted as durable authorization for reads, writes, ballots, rounds,
-- timers, submissions, or the P2 analysis/review surface.
revoke execute on function
  climate_vote.mod_join(text),
  climate_vote.mod_create_round(text,text,text,jsonb),
  climate_vote.mod_set_round_status(text,text,text),
  climate_vote.mod_proxy_vote(text,text,jsonb,int),
  climate_vote.mod_log_timer(text,text,int,timestamptz,timestamptz),
  climate_vote.topic_list(text),
  climate_vote.topic_set_deadline(text,uuid,timestamptz),
  climate_vote.readiness_check(uuid),
  climate_vote.org_of_code(text),
  climate_vote.org_of_token(text),
  climate_vote.attendance_team_unlock(text,text),
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
  climate_vote.result_unpublish(text,uuid),
  climate_vote.mod_proxy_vote_v2(text,text,jsonb,int)
from public, anon, authenticated;

-- Trigger helpers execute only through their owning table triggers. PostgreSQL
-- grants new routines to PUBLIC by default, so close these non-API entry points
-- explicitly before asserting the complete PostgREST routine allowlist.
revoke execute on function
  climate_vote.votes_require_active_round(),
  climate_vote.capture_round_attendance(),
  climate_vote.submission_item_archive_trigger()
from public, anon, authenticated;

-- Scheduled snapshots are an operational service-role task, not a browser
-- capability. Preserve the automation while removing the inherited PUBLIC
-- EXECUTE grant that would otherwise defeat the routine allowlist.
revoke execute on function
  climate_vote.cv_snapshot_now(text,text),
  climate_vote.cv_archive_round(text,text,text)
from public, anon, authenticated;
grant execute on function
  climate_vote.cv_snapshot_now(text,text),
  climate_vote.cv_archive_round(text,text,text)
to service_role;

-- A retired admin page historically called this unscoped SECURITY DEFINER
-- routine from the public schema. It is optional in reconstructed installs, but
-- if present it must stay closed across activation and emergency rollback.
do $optional_public_admin$
begin
  if to_regprocedure('public.cv_set_active(text)') is not null then
    execute 'revoke execute on function public.cv_set_active(text) from public, anon, authenticated';
  end if;
end $optional_public_admin$;

-- Named HQ credentials are the only browser bootstrap into a short-lived,
-- session-bound token. The historical shared-password function accepts a
-- caller-controlled actor label, so leaving it callable would make the audit
-- identity untrustworthy after cutover.
revoke execute on function
  climate_vote.attendance_hq_unlock(text,text),
  climate_vote.attendance_hq_unlock_named(text,text),
  climate_vote.hq_change_password(text,text,text),
  climate_vote.workshop_hq_logout_v2(text)
from public, anon, authenticated;
grant execute on function
  climate_vote.attendance_hq_unlock_named(text,text),
  climate_vote.hq_change_password(text,text,text),
  climate_vote.workshop_hq_logout_v2(text)
to anon, authenticated;

-- A shared-password bearer minted before this transaction must not survive the
-- cutover. Revoke every live HQ bearer and require a fresh named-operator login.
update climate_vote.attendance_auth_session
   set revoked_at=now()
 where scope='hq' and purpose='hq' and revoked_at is null;

-- Named status is revalidated on every HQ operation. Deactivating an operator
-- therefore closes already-issued bearers instead of waiting for token expiry.
create or replace function climate_vote.workshop_hq_session_row(
  p_token text, p_session_slug text)
returns climate_vote.session language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_session climate_vote.session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' or v_auth.purpose <> 'hq'
     or v_auth.session_id is null or v_auth.org_id is null
     or not exists(select 1 from climate_vote.hq_operator op
       where op.name=v_auth.actor_label and op.active) then
    raise exception 'active named HQ authorization required';
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

-- Older migrations exposed every active hq_operator column to the login page.
-- In particular must_change_password identified accounts still using bootstrap
-- credentials. The current client takes an explicit operator name, so no
-- browser role needs direct table access.
revoke all on table climate_vote.hq_operator
from public, anon, authenticated;

-- The voter and moderator clients use the scoped/capability RPCs granted
-- below. Remove broad table access in the same cutover transaction so an anon
-- client cannot enumerate another session's rounds or votes.
revoke all on table climate_vote.rounds, climate_vote.votes
from public, anon, authenticated;

-- P1C staff views are read-only. Keep all core lifecycle writes behind the
-- scoped RPC surface so direct PostgREST calls cannot bypass OCC,
-- idempotency, audit, or state-transition validation.
revoke insert, update, delete, truncate, references, trigger on
  climate_vote.assembly,
  climate_vote.session,
  climate_vote.discussion_topic,
  climate_vote.submission,
  climate_vote.ballot
from public, anon, authenticated;

-- Existing published implementation entries predate the snapshot-CAS client.
-- Bind them to the same semantic digest v3 uses so the first post-cutover edit
-- has an explicit expected value instead of falling back to last-write-wins.
with implementation_snapshots as (
  select rp.id,
    jsonb_agg(
      case when jsonb_typeof(issue->'implementation')='object' then
        jsonb_set(issue,'{implementation,snapshot_hash}',to_jsonb(
          climate_vote.platform_result_implementation_snapshot_hash(
            issue->'implementation')),true)
      else issue end order by ordinality) as issues
  from climate_vote.result_page rp
  cross join lateral jsonb_array_elements(case
    when jsonb_typeof(rp.body->'issues')='array' then rp.body->'issues'
    else '[]'::jsonb end)
    with ordinality as x(issue,ordinality)
  where rp.published_at is not null and rp.archived_at is null
    and exists(select 1 from jsonb_array_elements(case
      when jsonb_typeof(rp.body->'issues')='array' then rp.body->'issues'
      else '[]'::jsonb end) candidate
      where jsonb_typeof(candidate->'implementation')='object')
  group by rp.id
)
update climate_vote.result_page rp
   set body=jsonb_set(rp.body,'{issues}',s.issues,true)
  from implementation_snapshots s where s.id=rp.id;

-- Legacy owner-rights compatibility views bypass underlying RLS/ACLs. Retire
-- their PostgREST grants atomically with the base tables; public/v now calls
-- the validated, least-data public_round_* RPCs instead.
do $legacy_vote_views$
declare v_view text;
begin
  foreach v_view in array array[
    'public.cv_votes','public.cv_rounds','public.cv_tally','public.cv_tally_scale'
  ] loop
    if to_regclass(v_view) is not null then
      execute format('revoke all on table %s from public, anon, authenticated',v_view);
    end if;
  end loop;
end $legacy_vote_views$;

-- A7 was previously a separately approved dormant contract and may not exist
-- in every install. If present, remove its bearer-token write capability too;
-- authenticated staff use the selected-org/session-scoped replacement.
do $optional_legacy$
begin
  if to_regprocedure(
    'climate_vote.result_implementation_upsert(text,text,uuid,jsonb)') is not null then
    execute 'revoke execute on function climate_vote.result_implementation_upsert(text,text,uuid,jsonb) from public, anon, authenticated';
  end if;
end $optional_legacy$;

-- This grant and the legacy revoke above are one transaction: there is no
-- interval in which predictable join codes can mint durable workshop tokens.
-- The non-idempotent mod_proxy_vote_v2 is intentionally never granted.
revoke execute on function
  climate_vote.mod_set_round_status_v2(text,text,text),
  climate_vote.hq_submissions_v2(text,text),
  climate_vote.hq_submission_category_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_categories_v2(text,text),
  climate_vote.hq_submission_kind_assign_v2(text,text,uuid,int,text),
  climate_vote.hq_submission_kinds_v2(text,text),
  climate_vote.hq_clear_submissions_v2(text,text,text)
from public, anon, authenticated;

grant execute on function
  climate_vote.mod_exchange_join_code(text,uuid,text),
  climate_vote.mod_session_get(text),
  climate_vote.topic_list_v2(text),
  climate_vote.attendance_round_eligible_count_v2(text,text),
  climate_vote.submission_get_v2(text,uuid),
  climate_vote.submission_save_v3(text,uuid,jsonb,bigint,uuid,boolean),
  climate_vote.submission_finalize_v2(text,uuid,bigint),
  climate_vote.submission_reopen_by_team_v2(text,uuid),
  climate_vote.workshop_team_logout_v2(text),
  climate_vote.mod_create_round_v3(text,text,text,jsonb,uuid),
  climate_vote.mod_set_round_status_v3(text,text,text,text,uuid),
  climate_vote.mod_proxy_vote_v3(text,text,jsonb,int,uuid),
  climate_vote.mod_log_timer_v2(text,text,int,timestamptz,timestamptz),
  climate_vote.ballot_create_v3(text,text,text,jsonb,text,uuid),
  climate_vote.ballot_set_status_v2(text,uuid,text),
  climate_vote.ballot_list_v2(text),
  climate_vote.ballot_results_v2(text,text),
  climate_vote.workshop_hq_status(text,text),
  climate_vote.workshop_hq_open_next_topic(text,text,int,uuid),
  climate_vote.workshop_hq_set_topic_status(text,text,uuid,text,text,uuid),
  climate_vote.workshop_hq_devices(text,text),
  climate_vote.workshop_hq_revoke_device(text,text,text,text,uuid),
  climate_vote.workshop_hq_set_deadline(text,text,uuid,timestamptz,timestamptz,uuid),
  climate_vote.workshop_hq_rotate_join_codes(text,text,text,uuid),
  climate_vote.attendance_roster_v2(text,text),
  climate_vote.attendance_hq_summary_v2(text,text),
  climate_vote.attendance_set_v2(text,text,uuid,text,timestamptz),
  climate_vote.attendance_bulk_present_v2(text,text,uuid[]),
  climate_vote.attendance_finalize_absent_v2(text,text),
  climate_vote.attendance_member_save_v2(text,text,uuid,text,text,uuid,boolean),
  climate_vote.attendance_hq_audit_v2(text,text,int),
  climate_vote.attendance_hq_set_team_pin_v2(text,text,uuid,text),
  climate_vote.attendance_hq_set_table_no_v2(text,text,uuid,text),
  climate_vote.hq_teams_v2(text,text),
  climate_vote.hq_rounds_v2(text,text),
  climate_vote.hq_vote_counts_v2(text,text,text[]),
  climate_vote.hq_votes_v2(text,text,text[]),
  climate_vote.mod_rounds_v2(text),
  climate_vote.mod_session_teams_v2(text),
  climate_vote.mod_vote_counts_v2(text,text[]),
  climate_vote.mod_votes_v2(text,text),
  climate_vote.public_round_get_v2(text),
  climate_vote.public_round_votes_v2(text),
  climate_vote.public_round_cast_v2(text,jsonb,text),
  climate_vote.hq_submissions_v3(text,text),
  climate_vote.submission_reopen_v2(text,text,uuid,text),
  climate_vote.hq_submission_history_v2(text,text),
  climate_vote.hq_submission_category_assign_v3(
    text,text,uuid,int,text,timestamptz,bigint,uuid),
  climate_vote.hq_submission_categories_v3(text,text),
  climate_vote.hq_submission_kind_assign_v3(
    text,text,uuid,int,text,timestamptz,bigint,uuid),
  climate_vote.hq_submission_kinds_v3(text,text),
  climate_vote.hq_topic_deadlines_v2(text,text),
  climate_vote.hq_clear_submissions_v3(text,text,text,jsonb,uuid)
to anon, authenticated;

-- Switch review mutations to the snapshot-CAS and idempotent staff surface in
-- the same cutover as the atomic reclassification client. The v2 review and
-- merge endpoints have no browser-observed CAS and must not remain callable.
revoke execute on function
  climate_vote.platform_issue_upsert_v2(uuid,uuid,jsonb),
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
  climate_vote.platform_issue_upsert_v3(uuid,uuid,jsonb,text,uuid),
  climate_vote.platform_issue_reclassify_v2(uuid,uuid,jsonb,uuid),
  climate_vote.platform_issue_merge_v3(uuid,uuid,uuid,text,text,uuid),
  climate_vote.platform_issue_review_v3(uuid,uuid,text,uuid),
  climate_vote.platform_result_implementation_upsert_v3(
    uuid,text,uuid,jsonb,text,uuid)
to authenticated;

-- Canvas is an authenticated staff surface. Keep it out of anon while making
-- its session/org-scoped idempotent creator explicit at the activation seam.
revoke execute on function climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid)
from public, anon, authenticated;
revoke execute on function climate_vote.platform_canvas_round_current_v2(uuid)
from public, anon, authenticated;
revoke execute on function climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)
from public, anon, authenticated;
revoke execute on function climate_vote.platform_readiness_check_v2(uuid)
from public, anon, authenticated;
grant execute on function
  climate_vote.platform_readiness_check_v2(uuid),
  climate_vote.platform_canvas_round_create_v2(uuid,jsonb,uuid),
  climate_vote.platform_canvas_round_current_v2(uuid),
  climate_vote.platform_canvas_round_set_status_v2(uuid,text,text,text,uuid)
to authenticated;

-- The one-argument public result URL remains available after publish. Supplying
-- a join code can no longer reveal draft/closed aggregates. Authenticated staff
-- use platform_ballot_results_v2; workshop moderators use ballot_results_v2.
create or replace function climate_vote.ballot_results(
  p_token text, p_code text default null)
returns jsonb language plpgsql stable security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_ballot climate_vote.ballot; v_out jsonb;
begin
  if p_code is not null then
    raise exception 'legacy moderator code results disabled; use a scoped v2 RPC';
  end if;
  select * into v_ballot from climate_vote.ballot
   where token=p_token and status='published';
  if not found then return null; end if;

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

-- Normalize the complete anonymous ballot/result capability as an explicit
-- allowlist. ballot_submit is the P1a tenancy/window/row-lock override; the
-- remaining readers expose only the existing public ballot contract.
revoke execute on function
  climate_vote.ballot_get(text),
  climate_vote.ballot_submit(text,text,jsonb),
  climate_vote.ballot_results(text,text),
  climate_vote.result_get(text)
from public, anon, authenticated;
grant execute on function
  climate_vote.ballot_get(text),
  climate_vote.ballot_submit(text,text,jsonb),
  climate_vote.ballot_results(text,text),
  climate_vote.result_get(text)
to anon, authenticated;

comment on function climate_vote.ballot_results(text,text) is
  'Published result reader. p_code is retained only for API shape compatibility and is rejected.';

commit;
