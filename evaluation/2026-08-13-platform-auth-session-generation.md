# Platform auth session generation

## Scope

- Bind the initial session read and every auth-change refresh to one monotonically increasing generation.
- Apply session data and notices only when the response still belongs to the latest generation.
- Invalidate outstanding reads when the shell unmounts.
- Log and expose an unexpected current-session exception instead of leaving the loading state unresolved.
- Do not change Supabase Auth accounts, membership, RLS, database rows, schema, or production credentials.

## Verification contract

- A delayed unauthenticated response must not replace a newer authenticated session.
- A current thrown response must resolve to the unauthenticated UI with a visible notice and an error log.
- The production source contract must increment, assign, compare, and invalidate the same generation around `onAuthChange`.
- Root tests and strict Astro diagnostics must remain clean before the change is pushed.

## Local verification

- PlatformShell-focused Vitest: 1 file, 36 tests passed.
- Root Vitest: 63 files, 944 tests passed.
- Astro check: 314 files, 0 errors, 49 existing hints.
- `git diff --check`: passed; only the existing Windows LF-to-CRLF notices were emitted.

## Approval boundary

This generation guard governs client-side ordering only. It does not activate staff membership, change token lifetime, alter Auth policies, or prove a production account can sign in. Those operations remain separate approval-gated work.
