# A4 key registry policy contract verification

## Result

- A registry-backed wrapper binds approval issuance plus approval and receipt verification to an exact key lifecycle entry.
- New approvals require an active key. Historical verification permits verify-only keys only for approvals issued before the issuance cutoff and before the verification deadline.
- Issuance requires a revision-matched registry CAS whose trusted `authorizedAt` remains inside the approval window; rotation and expiry races fail closed.
- Retired, expired, malformed, mismatched, and unknown-field entries fail closed without returning key material.
- Invalid approval envelopes are rejected before the registry adapter is called.
- The wrapper does not connect to Supabase, credentials, KMS/HSM, a secret manager, or a production executor.

## TDD evidence

- RED: the focused suite failed because `platform-design-provisioning-key-registry.mjs` did not exist.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-design-provisioning-plan.test.mjs`.
- GREEN focused result after review fixes: 57 tests passed.

## Boundary

- This is an adapter-independent policy contract exercised with a synthetic key.
- It does not create, store, fetch, rotate, revoke, destroy, or back up production keys.
- Existing low-level direct-key functions remain available, and the production lifecycle is not connected to this wrapper.
- Production key custody and rotation therefore remain blocked pending a separately approved adapter and operational process.

## Final validation

- A4 bundle regeneration: 18 artifacts, checksum `16975216c5663d9a63db3c4cabce039488aa29a2fafbee076b7600f2faa4d0b7`.
- Focused A4 plan and bundle suites: 66 tests passed.
- Automation suite: 27 files, 463 tests passed.
- Root suite: 65 files, 1,081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, 49 hints.
- Git diff review: no remaining blocking findings.
- Post-commit CI and deployment evidence: external delivery evidence.

## Code review

- Security: passed. Exact envelopes are checked before registry access, adapter failures are generalized, and keys are not returned.
- Correctness: passed after fixing the rotation/read race and rejecting CAS authorization outside the approval window.
- Performance: passed. Each wrapper performs one bounded key read and issuance adds one bounded CAS call.
- Maintainability: passed. Registry policy remains isolated from the low-level cryptographic core and is bound into the A4 source manifest.
