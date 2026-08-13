# Platform auth operation lock

## Scope

- Acquire one synchronous lock before the first asynchronous login or logout boundary.
- Disable mutable login controls while authentication is in flight.
- Release the lock and busy state after success, handled failure, or unexpected exception.
- Treat a sign-out result with neither data nor notice as a visible failure.
- Keep browser verification traffic bound to a synthetic Supabase Auth fixture.
- Do not change Auth accounts, membership, RLS, database rows, schema, or production credentials.

## Verification contract

- Unit execution starts two auth operations in the same event loop and requires the second operation to stop before invoking its action.
- Sign-out execution requires notice, empty response, and thrown exception paths to produce an operator-visible failure.
- Production Chromium submits the actual login form twice while the fixture response is delayed.
- The clean Linux workflow must record one password-login request, locked inputs during the request, enabled retry after the failure, no page error, and no unexpected fixture request.

## Local verification

- PlatformShell-focused Vitest: 1 file, 33 tests passed.
- Root Vitest: 63 files, 941 tests passed.
- Browser verifier contract: 1 file, 6 tests passed.
- Astro check: 314 files, 0 errors, 49 existing hints.
- Verifier syntax and `git diff --check`: passed; only the existing Windows LF-to-CRLF notices were emitted.
- The Windows Astro development server returned its known non-authoritative 404 status for `/platform/`; latest-source Chromium remains a clean Linux workflow gate after push.

## Approval boundary

This client lock prevents accidental duplicate requests from one mounted shell. It does not activate Supabase Auth membership, RLS grants, or a server-side idempotency contract. Those remain separate approval-gated operations.
