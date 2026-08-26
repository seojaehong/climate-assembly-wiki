# A3 access provisioning contract identity verification

## Result

- The browser access plan remains on the tracked `access-plan-contract.json` schema v1.
- The derived provisioning plan is schema v2 and binds the tracked contract schema plus its canonical SHA-256.
- Verification rejects a self-resealed forged contract identity and a legacy provisioning plan without the identity.
- Production DB, Auth, invitations, email, memberships, and grants were not accessed or changed.

## TDD evidence

- RED: the new identity and legacy-plan rejection assertions failed before the implementation because the provisioning plan was still schema v1 and had no `accessPlanContract` field.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-access-provisioning-plan.test.mjs`.
- GREEN focused result: 18 tests passed.

## Compatibility boundary

- Existing browser source files using access-plan schema v1 remain valid.
- Existing provisioning plan schema v1 files are not execution evidence and must be regenerated from their original source access plan.
- Approval and receipt schemas remain unchanged because they bind the exact provisioning plan checksum.

## Final validation

- Automation suite: 27 files and 453 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 333 files, 0 errors, 0 warnings, and 49 existing hints.
- Git diff review: no correctness, security, performance, or maintainability findings. Approval and receipt consumers continue to bind the exact provisioning plan checksum, and no other consumer hard-codes provisioning schema v1.
- CI and deployed revision: verified after commit and retained as external delivery evidence; exact run and commit identifiers are intentionally not embedded here because doing so would create a self-referential commit.
