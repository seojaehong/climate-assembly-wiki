-- Close the legacy unscoped round activation helper discovered during the
-- production P2a executable-surface audit. This migration is intentionally
-- idempotent so environments that never had the helper remain valid.

begin;

do $close_legacy_set_active$
begin
  if to_regprocedure('climate_vote.set_active(text)') is not null then
    execute 'revoke execute on function climate_vote.set_active(text) from public, anon, authenticated';
  end if;

  if to_regprocedure('public.cv_set_active(text)') is not null then
    execute 'revoke execute on function public.cv_set_active(text) from public, anon, authenticated';
  end if;
end $close_legacy_set_active$;

commit;
