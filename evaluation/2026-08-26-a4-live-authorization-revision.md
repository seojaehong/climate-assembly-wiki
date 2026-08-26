# A4 live authorization revision contract

## Result

- Revision-capable authorization snapshots and claim/finalize results carry a canonical SHA-256 live-context revision.
- A new claim binds that revision as `authorizationRevision`; execution, receipt sealing, reconciliation, and finalization require the same revision.
- Active→inactive→active membership or organization ABA is rejected even when actor, role, host, organization, and booleans return to the original values.
- Revision-gated lifecycle wrappers reject legacy adapters before execution; key-registry composition rejects them before key access.
- Legacy in-memory adapters remain available only for low-level core compatibility tests.

## TDD evidence

- RED: five tests failed because the revisioned provider and lifecycle wrappers did not exist.
- Second RED: the key-registry plus revision composition wrapper was missing while the other revision tests passed.
- Review RED: a malformed revision-capability adapter reached lifecycle validation before the key-registry composition rejected it; the exact adapter shape is now checked before key access.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-design-provisioning-plan.test.mjs`.
- GREEN focused result: 71 tests passed.

## Boundary

- The provider is an in-memory test double and does not read Supabase Auth or membership rows.
- It does not implement authoritative revocation, a production row-version transaction, credentials, an executor, or a status adapter.
- It performs no DB, Auth, membership, RPC, GRANT, or traffic mutation.
- A4 remains `readyForExecution:false`; production activation still requires separately approved gates and adapters.

## Final validation

- A4 bundle regeneration and verification: 18 artifacts, checksum `da5311746da4d73e9da1f81249d5dcd979c742ec3ade7b4f5e248a83a0027f4f`, `productionApplyApproved:false`, `databaseMutationExecuted:false`.
- Focused A4 plan and bundle suites: 80 tests passed.
- Automation suite: 27 files and 477 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, 49 existing hints.
- Code review: Security, correctness, performance, and maintainability passed after requiring the exact revisioned adapter shape before any key-registry read. The provider uses bounded constant-time snapshot operations per approval fixture and remains explicitly test-only.
- Post-commit CI and deployment evidence: external delivery evidence.
