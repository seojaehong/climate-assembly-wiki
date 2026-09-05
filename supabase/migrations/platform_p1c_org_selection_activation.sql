-- Draft only. Do not apply without a separate production activation approval.
-- Activates the P1C staff RLS surface after the dormant migration, data
-- preflight, Auth provisioning, and post-apply verification have passed.

begin;

grant usage on schema climate_vote to authenticated;

grant select on climate_vote.membership to authenticated;

-- Staff clients read the selected organization tree directly, but every
-- lifecycle mutation goes through a session-scoped RPC so OCC, idempotency,
-- audit, and transition guards cannot be bypassed through PostgREST tables.
grant select on
  climate_vote.assembly,
  climate_vote.session,
  climate_vote.discussion_topic,
  climate_vote.submission,
  climate_vote.ballot
to authenticated;

revoke insert, update, delete, truncate, references, trigger on
  climate_vote.assembly,
  climate_vote.session,
  climate_vote.discussion_topic,
  climate_vote.submission,
  climate_vote.ballot
from public, anon, authenticated;

commit;
