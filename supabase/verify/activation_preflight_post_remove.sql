-- Read-only verification that the activation preflight RPC was removed.

\set ON_ERROR_STOP on

do $verify$
begin
  if to_regprocedure('climate_vote.platform_activation_preflight()') is not null then
    raise exception 'Activation preflight removal verification failed: function remains installed';
  end if;
end $verify$;

select jsonb_build_object(
  'status', 'passed',
  'activation_preflight_present', false,
  'database_mutation_executed', false
) as activation_preflight_post_remove;

\echo === ACTIVATION PREFLIGHT POST-REMOVE VERIFICATION PASSED ===
