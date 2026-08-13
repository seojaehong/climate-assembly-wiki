# Review console async race guard

## Scope

- Bound `issue_list` and `issue_items` to one topic, join code, and request generation.
- Discard stale success, notice, exception, and busy completion updates.
- Clear join-code input and topic-bound selection state at the appropriate lifecycle boundary.
- Convert missing data/notice and unexpected exceptions into logged, accessible failure notices.
- Bound issue save, review, reclassification, unlink, pull, and merge completion to the current request generation, topic, and mutation serial.
- Reject duplicate writes synchronously before the first asynchronous boundary and prevent join-code reloads while a write is busy.
- Render write failures as alerts and successes as polite statuses without allowing an older timeout to clear a newer notice.
- No database, RPC, migration, permission, or production data change.

## Evidence

| Check | Result |
|---|---|
| `npm.cmd exec vitest -- run src/islands/platform/PlatformShell.test.ts` | 1 file, 30 tests passed |
| `npm.cmd exec vitest -- run` | 63 files, 935 tests passed |
| `npm.cmd run check` | 314 files, 0 errors, 0 warnings, 49 existing hints |
| `git diff --check` | Passed; Windows LF to CRLF warnings only |

## Build boundary

- Node 20.20.2 reached the existing `build:kb-agenda-source` prebuild step and stopped because the installed Supabase Realtime package requires an explicit WebSocket transport on Node versions below 22.
- The installed Node 24.12.0 completed prebuild, then Astro exited after collecting build information without emitting a product-code diagnostic.
- Generated prebuild files were restored to their pre-run state. Linux CI after push remains the authoritative clean build check for this slice.

## Residual approval boundary

The current `issue_link_set` RPC still cannot make a cross-issue move atomic across two replace-all calls. Fixing that server transaction requires an approved RPC or migration and is not part of this no-DB slice.
