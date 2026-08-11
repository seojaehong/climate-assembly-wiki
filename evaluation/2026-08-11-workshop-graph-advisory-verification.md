# Workshop graph advisory asset verification

- Date: 2026-08-11 KST
- Scope: M6 read-only recommendation candidate and quality signal integration
- Mutation boundary: no database, schema, RLS, credential, public payload, or source transcript mutation

## Implemented contract

- `meta.recommendations` is accepted only as review-required recommendation candidates, never as a decision or AI-made consensus.
- Every recommendation candidate requires an explicit candidate/draft state, stable opaque ID, title, and provenance.
- Minority concerns remain separate child records with their own required stable opaque ID, text, and provenance.
- Source UID, transcript chunk ID, and cited UID arrays are validated and preserved as separate axes when more than one is present.
- `meta.quality` is shown only when it has an approved signal label, limitations notice, and provenance; arbitrary internal quality notes or truth-like labels are not relabeled as DQI.
- The panel states that recommendation candidates are not decisions, quality signals are not truth determinations, and human review remains required.
- Opaque provenance IDs are visible without publishing raw transcript content. They are not presented as working backlinks because the approved ID-to-item target mapping is not available.
- Invalid advisory metadata is logged and announced, while the last valid graph body remains usable.

## Current data boundary

The tracked static graph payloads do not contain a recommendation candidate that satisfies this strict display contract.
Three final graph payloads contain legacy `meta.quality` notes with internal `conclusion` fields rather than an explicit signal label and limitations notice.
Those notes are now blocked from DQI presentation instead of being presented as authoritative quality evidence.

The first real 8/29 analysis artifact, human review, and any database import remain outside this slice and require the source artifact and separate approval.

## Verification

- Focused Vitest: 2 files, 22 tests passed.
- Full src and scripts Vitest: 57 files, 855 tests passed.
- Automation Vitest: 15 files, 182 tests passed. One parallel-run browser timeout was rerun alone and passed; the isolated full automation run is the reported result.
- Astro check: 0 errors and 49 existing hints.
- Advisory parser syntax: passed with Node syntax validation.
- Chromium static-server fixture: valid candidate, quality signal, human-review notice, minority concern, source UID, transcript chunk ID, cited UID, and quality provenance were visible. An open advisory panel changed from candidate A to candidate B without retaining stale text; ambiguous legacy quality was hidden and announced; and a fixed graph-node detail panel remained intact across a later source change.
- Browser page errors: 0.
- Node 20 Astro static build: 7,913 pages; Pagefind indexed 8,008 pages.

Artifacts:

- `evaluation/2026-08-11-workshop-graph-advisory-browser.json`
- `evaluation/2026-08-11-workshop-graph-advisory-browser.png`
- `automation/verify-workshop-graph-advisory.mjs` (reproducible Chromium verifier)
- `evaluation/2026-08-11-workshop-graph-advisory-build.log` (local execution log, ignored by Git)

## Remaining approval boundary

No live recommendation or quality artifact was added to production data. A real analysis asset must first be obtained, mapped to source UID/transcript chunk provenance, reviewed by a person, and separately approved before any import or publication.
