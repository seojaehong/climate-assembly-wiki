# A4 revision-bound durable receipt contract

## Result

- A production-bound execution or reconciliation result can become a receipt only after the adapter echoes the verified authorization revision.
- The receipt stores that revision inside its HMAC-bound payload.
- Existing-receipt recovery compares the receipt revision with the current live authorization snapshot and claim before terminal finalization.
- A legacy receipt without the field and a validly signed receipt for another revision are rejected without RPC replay, receipt replacement, or terminal state.
- Legacy receipt verification remains available only for low-level compatibility.

## TDD evidence

- RED: the normal fenced lifecycle stored no authorization revision, and the production-bound wrapper finalized a valid legacy receipt.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-design-provisioning-plan.test.mjs`.
- GREEN focused result before final bundle regeneration: 76 tests passed.

## Boundary

- The revision is a SHA-256 fencing value and contains no key material, join code, source content, membership row, or credential.
- The contract does not prove that a production RPC consumed the fence or that a production durable store exists.
- No DB, Auth, membership, RPC, GRANT, or traffic mutation was performed.
- A4 remains `readyForExecution:false` and production activation still requires separately approved gates.

## Final validation

- A4 bundle regeneration and verification: 18 artifacts, checksum `82d6aabbd923834ed8239af766003d5776e5771b5a58dc6520777a8596263b7b`, `productionApplyApproved:false`, `databaseMutationExecuted:false`.
- Focused A4 plan and bundle suites: 85 tests passed.
- Automation suite: 27 files and 482 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, 49 existing hints.
- Code review: Security, correctness, performance, and maintainability passed. The receipt revision is HMAC-bound, recovery compares it to a fresh snapshot before a second revision-checking finalize CAS, legacy and mismatched receipts fail without RPC replay, and the added checks are constant-time except for two bounded authorization reads.
- Post-commit CI and deployment evidence: external delivery evidence.
