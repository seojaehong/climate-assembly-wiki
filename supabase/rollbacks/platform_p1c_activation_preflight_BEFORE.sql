-- Remove the count-only activation preflight without changing tenant data.

begin;

revoke all on function climate_vote.platform_activation_preflight() from public, anon, authenticated, service_role;
drop function if exists climate_vote.platform_activation_preflight();

commit;
