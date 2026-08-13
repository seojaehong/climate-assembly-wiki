# Platform session isolation verification

## Scope

- Key the authenticated AppShell by user ID so a direct Auth user change cannot reuse the previous shell state for its first render.
- Close the authenticated shell and restore `/platform/` immediately after a confirmed sign-out instead of waiting for a later Auth session read.
- Remove the legacy HQ token and actor label from session storage on confirmed sign-out.
- Surface storage cleanup failure without exposing credential values.

## Local verification

- `npm.cmd exec vitest -- run src/islands/platform/PlatformShell.test.ts`: 1 file, 42 tests passed.
- `npm.cmd exec vitest -- run`: 63 files, 950 tests passed.
- `npm.cmd exec vitest -- run tests/verify-platform-design-blueprint.test.mjs` in `automation/`: 1 file, 6 tests passed.
- `npm.cmd run check`: 314 files checked, 0 errors, 49 existing hints.
- `node --check automation/verify-platform-design-blueprint.mjs`: passed.
- Direct Windows Astro build exited before page generation under the unsupported local Node runtime, so the clean Node 20 Linux workflow remains the browser and build gate.

## Chromium gate contract

- Load a synthetic stored HQ token into the production publish console.
- Enter a prior-user publication draft, then execute the production sign-out button.
- Require exactly one Auth logout request and the login form at `/platform/`.
- Require removal of the token and actor storage keys, credential and draft inputs, prior data tree, and prior publish console.
- Require zero browser errors and zero unexpected fixture failures.

## Approval boundary

- No production database request, Auth account, membership, RLS, migration, or data mutation is included.
