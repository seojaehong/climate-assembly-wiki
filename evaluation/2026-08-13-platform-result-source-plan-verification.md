# A7 public result source-plan verification

- Date: 2026-08-13 KST
- Scope: local read-only contract and tests
- Database mutation: not executed
- Public payload write: not executed
- Real citizen data: not used
- Approval still required: public result payload schema and DB/RPC migration

## Contract evidence

The preflight reconstructs issue team membership, the cluster-corrected consensus denominator and the unclassified item count from captured `issue_items` data. It refuses to create a plan when those facts differ from the captured public result.

The plan preserves stable issue/item/submission/cluster identifiers and content SHA-256 values without copying source content. Verification checks both the canonical checksum and complete regeneration from the two input captures.

## Verification boundary

This artifact demonstrates the local contract only. No live `issue_items` capture was taken, no result was republished, and no public backlink was created. A real source-link feature remains blocked on an approved atomic publication contract and public read route.

## Executed checks

- Focused source-plan Vitest: 10 passed.
- Automation excluding the two existing Windows browser-timeout files: 18 files, 222 passed.
- Full root Vitest: 63 files, 904 passed.
- Astro check: 0 errors, 49 existing hints.
- An unfiltered Windows automation run reproduced 10 pre-existing Playwright timeouts in `platform-accessibility-audit.test.mjs` and `verify-canvas-browser.test.mjs`; the source-plan suite passed in that run.

No frontend source changed, so a new browser render or static build was not used as evidence for this local contract slice.
