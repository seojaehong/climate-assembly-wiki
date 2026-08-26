# A4 external checkpoint anchor rehearsal

## Result

- A separate local anchor store persists sealed A4 inventory checkpoints outside both the repository and the rehearsal authorization/receipt store.
- Checkpoints use immutable hard-link publication and authoritative read-back instead of trusting an append response.
- Exact replay is idempotent, append response loss is recovered, and same-timestamp conflict preserves the original record.
- Marker, layout, record hash, path ownership, repository boundary, and adapter capability checks fail closed.
- Checkpoint records contain no HMAC key material or approval/execution identifiers.

## TDD evidence

- RED: two focused tests failed because the checkpoint anchor initializer, adapter, and persistence wrapper did not exist.
- GREEN focused command: `npm.cmd exec vitest -- run tests/platform-design-provisioning-plan.test.mjs`.
- GREEN focused result: 64 tests passed.

## Boundary

- This is a same-host local filesystem rehearsal, not an operational external anchor.
- It does not provide independent timestamp authority, external retention, anchor deletion detection, production key custody, or production durability.
- It reads no production credentials and performs no DB, Auth, membership, RPC, GRANT, or traffic mutation.
- A4 remains `readyForExecution:false`; production activation still requires the separately approved gates.

## Final validation

- A4 bundle regeneration: 18 artifacts, checksum `ddc9fe7d94e1f4612589b7e5ff97a517deb90b7c19ee336c96da2446c20b80ca`.
- Focused A4 plan and bundle suites: 73 tests passed (64 plan plus 9 bundle).
- Automation suite: 27 files, 470 tests passed.
- Root suite: 65 files, 1081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, 49 existing hints.
- Code review: no blocking findings after adding bounded marker reads, a 10,000-record anchor limit, per-operation marker/layout verification, and detached-method-safe read-back.
- Post-commit CI and deployment evidence: external delivery evidence.

## Code review

- Security: passed. Repository/internal paths, non-owned files, marker/layout drift, malformed records, record-hash tampering, and adapter capability drift fail closed; key material is never passed to the anchor adapter.
- Correctness: passed. Immutable publication, exact replay, conflict preservation, restart reads, and append-response-loss recovery all require authoritative canonical read-back.
- Performance: passed. Record and marker reads are byte-bounded, and layout inspection has an explicit 10,000-record ceiling.
- Maintainability: passed. The anchor contract reuses the existing checkpoint validator and immutable publisher while keeping production boundaries explicit in exported capability flags and documentation.
