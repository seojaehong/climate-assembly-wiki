-- Draft only. Do not apply without a separate production activation approval.
-- Activates the P1C staff RLS surface after the dormant migration, data
-- preflight, Auth provisioning, and post-apply verification have passed.

grant usage on schema climate_vote to authenticated;

grant select on climate_vote.membership to authenticated;

grant select, insert, update on
  climate_vote.assembly,
  climate_vote.session,
  climate_vote.discussion_topic,
  climate_vote.submission,
  climate_vote.ballot
to authenticated;
