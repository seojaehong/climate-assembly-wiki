# A2 organization selection PostgreSQL rehearsal

- Executed at: 2026-08-16 (Asia/Seoul)
- Runtime: throwaway Docker `postgres:16`
- Production database accessed: no
- Production schema or data mutated: no

## Executed checks

1. Loaded the existing platform migration chain with `check_function_bodies=off`.
2. Loaded a clean database with `check_function_bodies=on` in this order:
   - `platform_p1_tenancy.sql`
   - `platform_p1c_org_selection.sql`
   - `platform_p2_analysis_review.sql`
3. Ran `supabase/verify/org_selection_test.sql` against two organizations and two multi-organization users.
4. Verified:
   - multi-organization access is rejected before explicit selection;
   - `org_select` issues a context token for an active membership;
   - the selected organization is the only organization visible through the assembly RLS policy;
   - the token is rejected for another Auth session, another user, and an unknown token value;
   - an expired token is rejected and the next organization selection prunes expired context rows;
   - rollback restores the prior multi-organization rejection and membership-wide dormant policy;
   - rollback removes `org_context` and its helper functions.

## Result

All parsing, function-body, positive, negative, RLS, and rollback checks passed. The rehearsal used only a disposable local database. Applying the migration, enabling staff grants, provisioning Auth users or memberships, and changing production data remain separate approval gates.
