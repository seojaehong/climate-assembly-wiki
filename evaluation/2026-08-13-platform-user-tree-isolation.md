# Platform user tree isolation verification

## Scope

- Reload the organization list and organization tree when the authenticated user changes without unmounting the platform shell.
- Clear the previous user's tree before the new request and ignore stale responses from the previous user.
- Rebind the URL to the latest server-derived organization root when the organization changes.
- Treat null responses and unexpected exceptions as visible failures.

## Verification

- `npm.cmd exec vitest -- run src/islands/platform/PlatformShell.test.ts`: 1 file, 40 tests passed.
- `npm.cmd exec vitest -- run`: 63 files, 948 tests passed.
- `npm.cmd run check`: 314 files checked, 0 errors, 49 existing hints.
- The focused tests cover a delayed user A tree response arriving after user B, a null tree response, an unexpected exception, and the production effect dependency and scope-rebinding contract.

## Approval boundary

- No database, Auth account, membership, RLS, migration, or production data changes were made.
- The Linux accessibility workflow remains the final clean build and browser integration gate after push.
