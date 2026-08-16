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
3. Ran `supabase/verify/org_selection_test.sql` against two organizations, two multi-organization operators, and one single-organization facilitator.
4. Verified:
   - multi-organization access is rejected before explicit selection;
   - `org_select` issues a context token for an active membership;
   - the selected organization is the only organization visible through the assembly, session, discussion topic, submission, and ballot RLS policies;
   - an operator can update the selected organization but cannot update or insert another organization;
   - a facilitator can read the selected organization but cannot update or insert it;
   - the token is rejected for another Auth session, another user, and an unknown token value;
   - an expired token is rejected and the next organization selection prunes expired context rows;
   - rollback restores the prior multi-organization rejection and membership-wide dormant policy;
   - rollback removes `org_context` and its helper functions.
5. Loaded a separate clean Postgres 16 database and ran `supabase/verify/org_selection_post_apply.sql`:
   - `expect_staff_grants=off` passed immediately after P1C with dormant staff grants;
   - authenticated schema usage was present after activation, while intended RPC execution privileges remained defined and internal helpers stayed private;
   - `expect_staff_grants=on` passed after applying the exact proposed SELECT/INSERT/UPDATE grants in the disposable database;
   - disabling RLS on `session` failed closed with exit code 3;
   - granting DELETE on `ballot` failed closed with exit code 3;
   - both successful reports returned `database_mutation_executed: false`.
6. Revoked the activation table grants with `platform_p1c_org_selection_activation_BEFORE.sql`, reran the dormant verifier, and only then applied the P1C schema rollback. Staff tables were no longer directly accessible and the prior multi-organization rejection contract was restored.

## Result

The expanded rehearsal initially found that the legacy `session` table had tenant policies but no RLS enable statement. P1C now explicitly enables RLS on all five staff tables before any activation grant. After that correction, all parsing, function-body, positive, negative, five-table RLS, role-write, expiry, rollback, and post-apply privilege checks passed. The rehearsal used only disposable local databases. Applying the migration, enabling staff grants, provisioning Auth users or memberships, and changing production data remain separate approval gates.
