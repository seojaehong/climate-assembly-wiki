-- Read-only production verification for the one-time 9/12 tenancy repair.

begin transaction read only;

select jsonb_build_object(
  'sessionSlug', s.slug,
  'heldOn', s.held_on,
  'sessionOrgBound', s.org_id is not null and s.org_id = a.org_id,
  'activeTeams', count(*) filter (where t.status = 'active'),
  'teamsOrgBound', count(*) filter (where t.org_id = s.org_id),
  'uniqueSixDigitCodes', count(distinct t.join_code)
) as tenancy_repair_check
from climate_vote.session s
join climate_vote.assembly a on a.id = s.assembly_id
join climate_vote.team t on t.session_id = s.id
where s.slug = '0912-deliberation'
  and t.join_code ~ '^[0-9]{6}$'
group by s.slug, s.held_on, s.org_id, a.org_id;

rollback;
