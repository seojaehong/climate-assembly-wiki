# A4 authorization fence adapter contract

## Result

- Revision-bound execution and reconciliation wrappers now require explicit fencing capabilities.
- The core passes an exact non-sensitive fence containing approval ID, execution ID, and the currently verified authorization revision.
- Adapter results must echo the same revision before they can become receipt candidates.
- Missing capabilities are rejected before authorization, receipt, or key-registry reads; mismatched revisions preserve the active claim without a receipt or terminal state.

## TDD evidence

- RED: eight focused tests failed before the execution/reconciliation adapter validators, fence input, and response verification existed.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-design-provisioning-plan.test.mjs`.
- GREEN focused result before final bundle regeneration: 74 tests passed.

## Boundary

- Legacy low-level lifecycle adapters remain compatible but cannot enter the production-bound wrappers.
- The fence contains no key material, join code, source blueprint content, membership record, or credential.
- This is an adapter interface and test-double contract. No production Supabase RPC/status adapter consumes the fence yet.
- No DB, Auth, membership, RPC, GRANT, or traffic mutation was performed.
- A4 remains `readyForExecution:false` and production activation still requires separately approved gates.

## Final validation

- A4 bundle regeneration and verification: 18 artifacts, checksum `e550fa33c2a7c7dad0c869a323d6673abc8010c76f80ac1fc111d1a2cffeeb12`, `productionApplyApproved:false`, `databaseMutationExecuted:false`.
- Focused A4 plan and bundle suites: 83 tests passed.
- Automation suite: 27 files and 480 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, 49 existing hints.
- Code review: Security, correctness, performance, and maintainability passed. Capability and exact adapter shape are checked before side effects, the fence contains no secret material, mismatched results fail before receipt persistence, and the added work is constant-size per lifecycle call.
- Post-commit CI and deployment evidence: external delivery evidence.
