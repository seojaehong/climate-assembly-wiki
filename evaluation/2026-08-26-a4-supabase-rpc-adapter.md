# A4 inactive Supabase fenced RPC adapter

## Outcome

The dormant A4 SQL fence now has a production-bound JavaScript adapter draft. The factory accepts an already authenticated Supabase client and exposes only revision-fenced execution and reconciliation adapters. It does not create a client, load credentials, grant RPC privileges, or contact a database during construction or tests.

## Contract

- Execution calls `climate_vote.design_provision` with exact `p_plan`, PostgreSQL hex `p_source_bytes`, and `p_authorization_fence` arguments. Source bytes use the shared 1,000,000-byte blueprint limit.
- Reconciliation calls `climate_vote.design_provisioning_status` with exact `p_query` and `p_authorization_fence` arguments after binding approval and execution IDs.
- Both paths require the exact schema-v1 fence and matching response `authorizationRevision`.
- Every request receives a 20-second abort signal and is attempted once. An uncertain mutation outcome must use the existing explicit reconciliation lifecycle rather than an automatic retry.
- Sparse, non-JSON, oversized, and malformed input is rejected before schema-client access. Raw Supabase errors and thrown values are replaced with stable non-sensitive errors.
- Production-bound lifecycle entry points require approval and execution UUID v4 identities before receipt or authorization state access, matching the dormant SQL fence grammar.

## Inactive boundary

- The adapter reads no environment variables, URL, key, or Auth identity and never constructs a Supabase client.
- The dormant SQL overloads remain revoked from authenticated and all other runtime roles.
- Live authorization CAS, approval and receipt persistence, key custody, CLI wiring, production migration, GRANT, and staff traffic remain separate approval gates.

## Verification

- Focused A4 suite: 3 files and 94 tests passed.
- Full automation suite: 28 files and 494 tests passed. One unrelated production graph polling case first reached its existing 20-second boundary, then passed alone and in the complete rerun.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 337 files, 0 errors, 0 warnings, and 49 existing hints.
- A4 current-source bundle: 20 artifacts, checksum `2ce8605f8145e40f41e8e6b81eb4c8b6483252bf8e6644e11fe80738e02b2116`, `productionApplyApproved:false`, and `databaseMutationExecuted:false`.

## Review

- Security: pass after confirming no credential reads, raw error exposure, unfenced method, or implicit privilege activation.
- Correctness: the first review found that general approval UUID versions were broader than the SQL fence grammar. Production-bound execution and reconciliation now reject non-v4 identities before receipt or authorization state access.
- Performance: bounded JSON and source payloads, one RPC attempt, and one linear JSON validation pass.
- Maintainability: shared blueprint byte limit, explicit boundary metadata, exact adapter surface, focused regression coverage, and bundle inclusion.
- No unresolved review finding remains in this increment. CI and deployment revision results are recorded after push.
