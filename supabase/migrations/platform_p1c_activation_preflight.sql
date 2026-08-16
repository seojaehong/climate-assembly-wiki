-- Draft only. Do not apply without separate production approval.
-- Returns count-only activation readiness from one database statement.

begin;

create or replace function climate_vote.platform_activation_preflight()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, climate_vote, auth
set row_security = off
as $function$
declare
  v_checked_at timestamptz := statement_timestamp();
  v_checked_at_text text;
  v_active_organization_count bigint;
  v_active_membership_count bigint;
  v_organizations_without_admin_count bigint;
  v_organizations_without_hq_count bigint;
  v_multi_organization_user_count bigint;
  v_unavailable_membership_organization_count bigint;
  v_unavailable_auth_user_count bigint;
  v_hierarchy_mismatch_count bigint;
  v_total_null_org_count bigint;
  v_unbound_active_hq_session_count bigint;
  v_tables jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  v_checked_at_text := to_char(
    v_checked_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  select count(*) into v_active_organization_count
  from climate_vote.org o
  where o.status = 'active';

  select count(*) into v_active_membership_count
  from climate_vote.membership m
  where m.status = 'active';

  select count(*) into v_organizations_without_admin_count
  from climate_vote.org o
  where o.status = 'active'
    and not exists (
      select 1
      from climate_vote.membership m
      where m.org_id = o.id
        and m.status = 'active'
        and m.role = 'org_admin'
    );

  select count(*) into v_organizations_without_hq_count
  from climate_vote.org o
  where o.status = 'active'
    and not exists (
      select 1
      from climate_vote.membership m
      where m.org_id = o.id
        and m.status = 'active'
        and m.role = 'hq'
    );

  select count(*) into v_multi_organization_user_count
  from (
    select m.user_id
    from climate_vote.membership m
    where m.status = 'active'
    group by m.user_id
    having count(distinct m.org_id) > 1
  ) users_with_multiple_organizations;

  select count(*) into v_unavailable_membership_organization_count
  from climate_vote.membership m
  left join climate_vote.org o
    on o.id = m.org_id
   and o.status = 'active'
  where m.status = 'active'
    and o.id is null;

  select count(distinct m.user_id) into v_unavailable_auth_user_count
  from climate_vote.membership m
  left join auth.users u on u.id = m.user_id
  where m.status = 'active'
    and (
      u.id is null
      or u.deleted_at is not null
      or coalesce(u.is_anonymous, false)
      or nullif(u.email, '') is null
      or coalesce(u.email_confirmed_at, u.confirmed_at) is null
      or coalesce(u.email_confirmed_at, u.confirmed_at) > v_checked_at
      or (u.banned_until is not null and u.banned_until > v_checked_at)
    );

  select count(*) into v_hierarchy_mismatch_count
  from (
    select a.id::text as row_key
    from climate_vote.assembly a
    left join climate_vote.org o on o.id = a.org_id
    where a.org_id is not null and o.id is null

    union all
    select am.id::text
    from climate_vote.assembly_member am
    left join climate_vote.org o on o.id = am.org_id
    where am.org_id is not null and o.id is null

    union all
    select s.id::text
    from climate_vote.session s
    left join climate_vote.assembly a on a.id = s.assembly_id
    where s.org_id is not null and (a.id is null or s.org_id is distinct from a.org_id)

    union all
    select dt.id::text
    from climate_vote.discussion_topic dt
    left join climate_vote.session s on s.id = dt.session_id
    where dt.org_id is not null and (s.id is null or dt.org_id is distinct from s.org_id)

    union all
    select t.id::text
    from climate_vote.team t
    left join climate_vote.session s on s.id = t.session_id
    where t.org_id is not null and (s.id is null or t.org_id is distinct from s.org_id)

    union all
    select sub.id::text
    from climate_vote.submission sub
    left join climate_vote.discussion_topic dt on dt.id = sub.topic_id
    left join climate_vote.team t on t.id = sub.team_id
    where sub.org_id is not null
      and (
        dt.id is null or t.id is null
        or sub.org_id is distinct from dt.org_id
        or sub.org_id is distinct from t.org_id
      )

    union all
    select b.id::text
    from climate_vote.ballot b
    left join climate_vote.session s on s.id = b.session_id
    where b.org_id is not null and (s.id is null or b.org_id is distinct from s.org_id)

    union all
    select i.id::text
    from climate_vote.issue i
    left join climate_vote.discussion_topic dt on dt.id = i.topic_id
    where i.org_id is not null and (dt.id is null or i.org_id is distinct from dt.org_id)

    union all
    select rp.id::text
    from climate_vote.result_page rp
    left join climate_vote.assembly a on rp.scope = 'assembly' and a.id = rp.scope_id
    left join climate_vote.session s on rp.scope = 'session' and s.id = rp.scope_id
    left join climate_vote.discussion_topic dt on rp.scope = 'topic' and dt.id = rp.scope_id
    where rp.org_id is not null
      and case rp.scope
        when 'assembly' then a.id is null or rp.org_id is distinct from a.org_id
        when 'session' then s.id is null or rp.org_id is distinct from s.org_id
        when 'topic' then dt.id is null or rp.org_id is distinct from dt.org_id
        else true
      end

    union all
    select ta.id::text
    from climate_vote.team_assignment ta
    left join climate_vote.session s on s.id = ta.session_id
    left join climate_vote.team t on t.id = ta.team_id
    left join climate_vote.assembly_member am on am.id = ta.member_id
    where ta.org_id is not null
      and (
        s.id is null or t.id is null or am.id is null
        or ta.org_id is distinct from s.org_id
        or ta.org_id is distinct from t.org_id
        or ta.org_id is distinct from am.org_id
      )

    union all
    select att.id::text
    from climate_vote.attendance att
    left join climate_vote.team_assignment ta on ta.id = att.assignment_id
    where att.org_id is not null and (ta.id is null or att.org_id is distinct from ta.org_id)

    union all
    select aas.token_hash
    from climate_vote.attendance_auth_session aas
    left join climate_vote.team t on t.id = aas.team_id
    left join climate_vote.org o on o.id = aas.org_id
    where aas.org_id is not null
      and (
        o.id is null
        or (aas.expires_at > v_checked_at and o.status <> 'active')
        or (aas.scope = 'team' and (t.id is null or aas.org_id is distinct from t.org_id))
        or (aas.scope = 'hq' and aas.team_id is not null)
        or aas.scope not in ('team', 'hq')
      )
  ) mismatches;

  select count(*) into v_unbound_active_hq_session_count
  from climate_vote.attendance_auth_session aas
  where aas.scope = 'hq'
    and aas.org_id is null
    and aas.expires_at > v_checked_at;

  with table_counts(ordinal, table_name, total_count, null_org_count) as (
    values
      (1, 'assembly', (select count(*) from climate_vote.assembly), (select count(*) from climate_vote.assembly where org_id is null)),
      (2, 'session', (select count(*) from climate_vote.session), (select count(*) from climate_vote.session where org_id is null)),
      (3, 'discussion_topic', (select count(*) from climate_vote.discussion_topic), (select count(*) from climate_vote.discussion_topic where org_id is null)),
      (4, 'submission', (select count(*) from climate_vote.submission), (select count(*) from climate_vote.submission where org_id is null)),
      (5, 'ballot', (select count(*) from climate_vote.ballot), (select count(*) from climate_vote.ballot where org_id is null)),
      (6, 'team', (select count(*) from climate_vote.team), (select count(*) from climate_vote.team where org_id is null)),
      (7, 'assembly_member', (select count(*) from climate_vote.assembly_member), (select count(*) from climate_vote.assembly_member where org_id is null)),
      (8, 'team_assignment', (select count(*) from climate_vote.team_assignment), (select count(*) from climate_vote.team_assignment where org_id is null)),
      (9, 'issue', (select count(*) from climate_vote.issue), (select count(*) from climate_vote.issue where org_id is null)),
      (10, 'result_page', (select count(*) from climate_vote.result_page), (select count(*) from climate_vote.result_page where org_id is null)),
      (11, 'attendance', (select count(*) from climate_vote.attendance), (select count(*) from climate_vote.attendance where org_id is null)),
      (12, 'attendance_auth_session', (select count(*) from climate_vote.attendance_auth_session), (select count(*) from climate_vote.attendance_auth_session where org_id is null))
  )
  select
    coalesce(sum(null_org_count), 0),
    jsonb_agg(jsonb_build_object(
      'table', table_name,
      'totalCount', total_count,
      'nullOrgCount', null_org_count
    ) order by ordinal)
  into v_total_null_org_count, v_tables
  from table_counts;

  if v_hierarchy_mismatch_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'hierarchy_org_mismatch', 'count', v_hierarchy_mismatch_count));
  end if;
  if v_active_organization_count = 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'no_active_organization', 'count', 1));
  end if;
  if v_organizations_without_admin_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'organization_without_admin', 'count', v_organizations_without_admin_count));
  end if;
  if v_organizations_without_hq_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'organization_without_hq', 'count', v_organizations_without_hq_count));
  end if;
  if v_multi_organization_user_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'multi_organization_user', 'count', v_multi_organization_user_count));
  end if;
  if v_unavailable_membership_organization_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'membership_unavailable_organization', 'count', v_unavailable_membership_organization_count));
  end if;
  if v_unavailable_auth_user_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'membership_auth_user_unavailable', 'count', v_unavailable_auth_user_count));
  end if;
  if v_total_null_org_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'null_org_id', 'count', v_total_null_org_count));
  end if;
  if v_unbound_active_hq_session_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'unbound_active_hq_session', 'count', v_unbound_active_hq_session_count));
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'status', case when jsonb_array_length(v_blockers) = 0 then 'ready' else 'not_ready' end,
    'checkedAt', v_checked_at_text,
    'databaseMutationExecuted', false,
    'evidenceComplete', true,
    'readConsistency', 'single_statement',
    'requiresImmediateRecheckBeforeActivation', true,
    'summary', jsonb_build_object(
      'activeOrganizationCount', v_active_organization_count,
      'activeMembershipCount', v_active_membership_count,
      'requiredTableCount', 12,
      'missingTableCount', 0,
      'missingHierarchyEvidenceCount', 0,
      'hierarchyMismatchCount', v_hierarchy_mismatch_count,
      'totalNullOrgCount', v_total_null_org_count,
      'organizationsWithoutAdminCount', v_organizations_without_admin_count,
      'organizationsWithoutHqCount', v_organizations_without_hq_count,
      'multiOrganizationUserCount', v_multi_organization_user_count,
      'unavailableMembershipOrganizationCount', v_unavailable_membership_organization_count,
      'unavailableAuthUserCount', v_unavailable_auth_user_count,
      'unboundActiveHqSessionCount', v_unbound_active_hq_session_count
    ),
    'tables', v_tables,
    'blockers', v_blockers
  );
end
$function$;

revoke all on function climate_vote.platform_activation_preflight() from public, anon, authenticated;
grant execute on function climate_vote.platform_activation_preflight() to service_role;

commit;
