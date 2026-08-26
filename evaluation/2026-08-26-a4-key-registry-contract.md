# A4 key registry policy contract verification

## Result

- A registry-backed wrapper binds approval issuance plus approval and receipt verification to an exact key lifecycle entry.
- New approvals require an active key. Historical verification permits verify-only keys only for approvals issued before the issuance cutoff and before the verification deadline.
- Issuance requires a revision-matched registry CAS whose trusted `authorizedAt` remains inside the approval window; rotation and expiry races fail closed.
- Registry-backed execution and reconciliation wrappers reuse one verified key snapshot and the first trusted clock value across the existing injected lifecycle.
- A verify-only key can close an already active claim after approval expiry through explicit reconciliation, while a retired key is rejected before claim or execution.
- Completion and finalization clocks are rechecked against the same verification cutoff; an overrun leaves the claim open without a receipt.
- Retired, expired, malformed, mismatched, and unknown-field entries fail closed without returning key material.
- Invalid approval envelopes are rejected before the registry adapter is called.
- The wrapper does not connect to Supabase, credentials, KMS/HSM, a secret manager, or a production executor.

## TDD evidence

- RED: the focused suite failed because `platform-design-provisioning-key-registry.mjs` did not exist.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-design-provisioning-plan.test.mjs`.
- Second RED: the focused suite reported three missing registry-backed lifecycle functions.
- Third RED: a verify-only lifecycle could cross its verification cutoff and still persist a receipt.
- GREEN focused result after lifecycle cutoff enforcement and direct-key bypass coverage: 62 tests passed.

## Boundary

- This is an adapter-independent policy contract exercised with a synthetic key.
- It does not create, store, fetch, rotate, revoke, destroy, or back up production keys.
- Existing low-level direct-key functions remain available for isolated core tests. The registry wrapper rejects direct key options on its lifecycle entry points.
- Only injected in-memory/local adapters are exercised; no production registry, executor, status, or membership adapter is connected.
- Production key custody and rotation therefore remain blocked pending a separately approved adapter and operational process.

## Final validation

- A4 bundle regeneration: 18 artifacts, checksum `9d79576a112c2f3b165e707f8ff704f9982045dc5d0790fb998a51db8bbfa981`.
- Focused A4 plan and bundle suites: 71 tests passed (62 plan plus 9 bundle).
- Automation suite: 27 files, 468 tests passed.
- Root suite: 65 files, 1081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, 49 existing hints.
- Git diff review: no blocking findings after lifecycle cutoff and direct-key bypass fixes.
- Post-commit CI and deployment evidence: external delivery evidence.

## Code review

- Security: passed. Exact envelopes are checked before registry access, adapter failures are generalized, and keys are not returned.
- Correctness: passed. The first trusted clock is replayed into the existing lifecycle, later clocks are checked against the same key snapshot, and expired approvals can only close an active claim through explicit reconciliation.
- Performance: passed. Each wrapper performs one bounded key read and issuance adds one bounded CAS call.
- Maintainability: passed. Registry policy remains isolated from the low-level cryptographic core and is bound into the A4 source manifest.
