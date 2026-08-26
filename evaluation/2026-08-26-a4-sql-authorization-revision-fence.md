# A4 SQL authorization revision fence

## Outcome

The approved but dormant A4 migration draft now exposes revision-fenced overloads for mutation and reconciliation. They accept the exact authorization fence already required by the JavaScript lifecycle, compare it with live organization and membership row versions, and echo the same revision only after the operation remains authorized.

## Contract

- `platform_design_authorization_revision()` derives a SHA-256 revision from the current Auth actor, selected organization, active `org_admin|hq` membership set, and PostgreSQL row versions.
- `design_provision(jsonb, bytea, jsonb)` validates the exact fence schema, holds matching membership and organization rows through the transaction, rejects stale revisions, delegates to the existing atomic plan implementation, rechecks the revision, and echoes it.
- `design_provisioning_status(jsonb, jsonb)` applies the same fence and row locks, exact-binds the fence approval and execution IDs to the reconciliation query, and only then returns pending or completed data.
- The helper and both overloads remain revoked from public, anon, authenticated, and service-role access. Existing unfenced overloads remain dormant compatibility internals and are not production adapter evidence.
- The revision is a short-lived live fencing token. It is not a durable audit identifier and is not promised to survive dump/restore or row rewrites.

## Verification

- Focused A4 suites: 2 files and 86 tests passed.
- Static A4 bundle coverage verifies the helper, overload signatures, exact fence schema, stable errors, dormant privileges, post-apply checks, and rollback removal.
- PostgreSQL 16 isolated rehearsal passed migration, mapping, post-apply verification, normal fenced mutation/reconciliation, stale-fence rejection, cross-execution fence rejection, and the existing semantic suite.
- A separate transaction changed membership `org_admin → operator → org_admin`; the resulting row revision changed and both old mutation and reconciliation fences were rejected.
- Automation suite: 27 files and 486 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, and 49 existing hints.
- No production database, Auth account, membership, credential, RPC privilege, or traffic state was accessed or changed.
