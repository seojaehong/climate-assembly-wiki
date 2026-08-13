# Publish mutation lock

## Scope

- Acquire one synchronous operation lock before the first asynchronous publication boundary.
- Share the lock between `result_publish` and `result_unpublish` flows.
- Disable mutable publication inputs while either operation is in flight.
- Release lock and busy state after success or exception so an operator can retry.
- Keep all browser verification traffic bound to synthetic Supabase fixtures.
- Do not change the database, RPC, migration, permission, or production data contract.

## Verification contract

- Unit execution starts two operations in the same event loop and requires the second operation to return without invoking its action.
- Exception execution requires both the lock and busy state to be released before a successful retry.
- Production Chromium opens the authenticated platform tree and publish tab, delays fixture publish/unpublish responses, and invokes each control twice.
- The clean Linux workflow must record one publish request, one unpublish request, successful public re-read, successful private re-read, no retained publication card, no page error, and no unexpected fixture response.

## Local verification

- Publish-focused Vitest: 2 files, 11 tests passed.
- Root Vitest: 63 files, 938 tests passed.
- Browser verifier contract: 1 file, 6 tests passed.
- Astro check: 314 files, 0 errors, 49 existing hints.
- Verifier syntax and `git diff --check`: passed; only the existing Windows LF-to-CRLF notices were emitted.
- Latest-source Chromium execution remains a clean Linux workflow gate after push because the current local `dist` predates this source change.

## Approval boundary

This client lock reduces accidental duplicate requests from one console instance. It does not replace a server-side uniqueness or idempotency contract for concurrent operators. Any database constraint, RPC idempotency key, or migration remains subject to explicit approval.
