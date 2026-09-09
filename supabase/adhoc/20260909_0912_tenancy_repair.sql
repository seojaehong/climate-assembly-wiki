-- One-time repair for the approved 9/12 session/team seed.
--
-- ORDER: platform_p1_tenancy -> approved 0912 seed -> this repair -> s21 -> P1a.
-- SCOPE: the 0912 session, its 15 teams, and their shared assembly only.
-- The later P1b migration remains responsible for the complete historical backfill.
-- No join code is written to this file.

begin;

do $repair$
declare
  v_org_id uuid;
  v_session_id uuid;
  v_assembly_id uuid;
  v_team_count integer;
  v_roster_count integer;
begin
  select s.id, s.assembly_id
    into v_session_id, v_assembly_id
    from climate_vote.session s
   where s.slug = '0912-deliberation'
     and s.status = 'active'
     and s.held_on = date '2026-09-12'
   for update;

  if v_session_id is null or v_assembly_id is null then
    raise exception '0912 tenancy repair refused: approved active session not found';
  end if;

  perform 1
    from climate_vote.assembly a
   where a.id = v_assembly_id
   for update;

  if not found then
    raise exception '0912 tenancy repair refused: session assembly not found';
  end if;

  select count(*)
    into v_team_count
    from climate_vote.team t
   where t.session_id = v_session_id;

  with expected(name, subgroup) as (
    values
      ('1분과 1조', '1분과'), ('1분과 2조', '1분과'),
      ('1분과 3조', '1분과'), ('1분과 4조', '1분과'),
      ('1분과 5조', '1분과'), ('2분과 1조', '2분과'),
      ('2분과 2조', '2분과'), ('2분과 3조', '2분과'),
      ('2분과 4조', '2분과'), ('2분과 5조', '2분과'),
      ('3분과 1조', '3분과'), ('3분과 2조', '3분과'),
      ('3분과 3조', '3분과'), ('3분과 4조', '3분과'),
      ('3분과 5조', '3분과')
  )
  select count(*)
    into v_roster_count
    from climate_vote.team t
    join expected e
      on e.name = t.name
     and e.subgroup = t.subgroup
   where t.session_id = v_session_id
     and t.status = 'active'
     and t.capacity > 0
     and t.join_code ~ '^[0-9]{6}$';

  if v_team_count <> 15 or v_roster_count <> 15 then
    raise exception
      '0912 tenancy repair refused: expected approved 15-team roster, got % rows / % matches',
      v_team_count, v_roster_count;
  end if;

  if (select count(distinct t.join_code)
        from climate_vote.team t
       where t.session_id = v_session_id) <> 15 then
    raise exception '0912 tenancy repair refused: join codes are not unique';
  end if;

  insert into climate_vote.org (slug, name, status)
  values ('kcrc-climate-2026', '한국갈등해결센터 기후시민회의', 'active')
  on conflict (slug) do nothing;

  select o.id
    into v_org_id
    from climate_vote.org o
   where o.slug = 'kcrc-climate-2026'
     and o.status = 'active'
     and o.archived_at is null
   for share;

  if v_org_id is null then
    raise exception '0912 tenancy repair refused: active canonical organization unavailable';
  end if;

  if exists (
    select 1 from climate_vote.assembly a
     where a.id = v_assembly_id
       and a.org_id is not null
       and a.org_id <> v_org_id
  ) or exists (
    select 1 from climate_vote.session s
     where s.id = v_session_id
       and s.org_id is not null
       and s.org_id <> v_org_id
  ) or exists (
    select 1 from climate_vote.team t
     where t.session_id = v_session_id
       and t.org_id is not null
       and t.org_id <> v_org_id
  ) then
    raise exception '0912 tenancy repair refused: conflicting organization binding exists';
  end if;

  update climate_vote.assembly
     set org_id = v_org_id
   where id = v_assembly_id
     and org_id is null;

  update climate_vote.session
     set org_id = v_org_id
   where id = v_session_id
     and org_id is null;

  update climate_vote.team
     set org_id = v_org_id
   where session_id = v_session_id
     and org_id is null;

  if not exists (
    select 1
      from climate_vote.session s
      join climate_vote.assembly a
        on a.id = s.assembly_id
       and a.org_id = s.org_id
     where s.id = v_session_id
       and s.org_id = v_org_id
  ) or exists (
    select 1 from climate_vote.team t
     where t.session_id = v_session_id
       and t.org_id is distinct from v_org_id
  ) then
    raise exception '0912 tenancy repair failed: organization binding verification failed';
  end if;
end
$repair$;

commit;

select jsonb_build_object(
  'sessionSlug', s.slug,
  'sessionOrgBound', s.org_id is not null and s.org_id = a.org_id,
  'activeTeams', count(*) filter (where t.status = 'active'),
  'teamsOrgBound', count(*) filter (where t.org_id = s.org_id),
  'uniqueSixDigitCodes', count(distinct t.join_code)
) as tenancy_repair_result
from climate_vote.session s
join climate_vote.assembly a on a.id = s.assembly_id
join climate_vote.team t on t.session_id = s.id
where s.slug = '0912-deliberation'
group by s.slug, s.org_id, a.org_id;
