# Review cluster preservation verification

Date: 2026-08-13

## Outcome

The review read model now preserves every `issue_id`, `cluster_id`, and `linked_by` tuple instead of flattening an item to the first non-null cluster. Reclassification and unlink planning validate the complete target and source result before returning any RPC calls.

## Fail-closed boundary

- An implicit target cluster is preserved only when every resulting target link has the same value, including `null`.
- An explicit target cluster applies to the complete target set.
- A source rewrite is rejected when its remaining links contain different cluster values.
- Stale or cross-issue selections are rejected before the replace-all RPC can run.
- The existing RPC still accepts one cluster per call. Supporting heterogeneous per-link writes requires a separately approved database contract change.

## Compatibility

The record view consumes the same exact link model while preserving the existing CSV JSON field names. No database schema, data, credential, or public payload was changed.

## Verification

- Focused review, platform shell, and record tests: 69 passed.
- Astro strict check: 0 errors; existing hints only.
- Full repository Vitest: 63 files and 925 tests passed.
- Node 20.20.2 static build: 7,914 pages generated; Pagefind indexed 8,009 pages.
- Remote CI results are recorded in the final commit evidence.
