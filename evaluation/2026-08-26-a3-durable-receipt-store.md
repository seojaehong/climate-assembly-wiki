# A3 durable receipt store verification

## Result

- A repository-external local rehearsal store persists non-sensitive A3 execution receipts by run ID.
- Initialization requires an existing empty absolute directory outside the repository and creates an exact local-only marker plus an owned receipt directory.
- Receipt publication uses an fsynced temporary file and an immutable hard-link destination, never overwriting an existing run.
- Restart recovery verifies the receipt HMAC, plan checksum, key ID, approval ID, and run ID before returning it without operation lookup or mutation.
- Same-run conflicts preserve the original receipt, and a receipt-directory junction escape is rejected.
- Production DB, Auth, invitations, email, memberships, grants, and credentials were not accessed or changed.

## TDD evidence

- RED: the focused suite could not load the missing durable store module.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-access-provisioning-plan.test.mjs`.
- GREEN focused result: 23 tests passed.

## Boundary

- This is a local filesystem rehearsal adapter, not a production persistence service.
- It does not provide an invitation operation ledger, email provider, authorization state, external completeness anchor, key custody, Supabase adapter, or execution CLI.
- Store files remain outside the repository and must not be copied into public or evaluation artifacts.

## Final validation

- Automation suite: 27 files, 458 tests passed.
- Root suite: 65 files, 1,081 tests passed.
- Astro check: 334 files, 0 errors, 0 warnings, 49 hints.
- Git diff review: no blocking findings. Security, correctness, performance, and maintainability passed for the local-rehearsal boundary; production durability and authorization remain explicitly out of scope.
- Post-commit CI and deployment evidence: external delivery evidence.
