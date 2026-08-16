-- Rollback for migrations/platform_p1c_org_selection.sql.
-- Restore the P1 multi-membership fail-closed function and membership-wide dormant policies.

drop policy if exists assembly_tenant_read on climate_vote.assembly;
drop policy if exists assembly_tenant_write on climate_vote.assembly;
drop policy if exists session_tenant_read on climate_vote.session;
drop policy if exists session_tenant_write on climate_vote.session;
drop policy if exists topic_tenant_read on climate_vote.discussion_topic;
drop policy if exists topic_tenant_write on climate_vote.discussion_topic;
drop policy if exists submission_tenant_read on climate_vote.submission;
drop policy if exists submission_tenant_write on climate_vote.submission;
drop policy if exists ballot_tenant_read on climate_vote.ballot;
drop policy if exists ballot_tenant_write on climate_vote.ballot;

create or replace function climate_vote.org_of_uid()
returns uuid language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_ids uuid[];
begin
  select array_agg(distinct m.org_id) into v_ids
  from climate_vote.membership m
  where m.user_id = auth.uid() and m.status = 'active';
  if v_ids is null or array_length(v_ids, 1) is null then return null;
  elsif array_length(v_ids, 1) > 1 then
    raise exception 'user belongs to multiple orgs — explicit org selection required (Phase 2 org_select)';
  end if;
  return v_ids[1];
end $fn$;

create policy assembly_tenant_read on climate_vote.assembly for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.status = 'active'));
create policy session_tenant_read on climate_vote.session for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.status = 'active'));
create policy topic_tenant_read on climate_vote.discussion_topic for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.status = 'active'));
create policy submission_tenant_read on climate_vote.submission for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.status = 'active'));
create policy ballot_tenant_read on climate_vote.ballot for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.status = 'active'));

create policy assembly_tenant_write on climate_vote.assembly for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));
create policy session_tenant_write on climate_vote.session for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));
create policy topic_tenant_write on climate_vote.discussion_topic for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));
create policy submission_tenant_write on climate_vote.submission for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));
create policy ballot_tenant_write on climate_vote.ballot for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));

drop function if exists climate_vote.org_select(uuid);
drop function if exists climate_vote.my_orgs();
drop function if exists climate_vote.selected_org_for_request();
drop function if exists climate_vote.auth_session_id();
drop function if exists climate_vote.request_org_context_token();
drop table if exists climate_vote.org_context;
