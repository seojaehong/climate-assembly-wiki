# Analysis-core import compatibility verification

- Date: 2026-08-11 KST
- Scope: Python analysis-core recommendation output to platform review-plan dry-run
- Mutation boundary: no Supabase client, credential, RPC, schema, row, or public payload mutation

## Observed source contract

The current project analysis core in `20_스크립트/analysis/recommendation_pipeline.py` deliberately emits
an empty recommendation `title` to prevent automatic final wording. Its recommendation trace also preserves
minority critiques as a string array, while recommendation-level `was_derived_from` and `time_span` retain
the available source and time provenance.

The previous importer required a nonempty title and object-shaped minority entries, so its tests did not prove
that the real analysis-core output could reach a platform review plan.

## Implemented compatibility contract

- Provenance map schema version 1 remains supported unchanged.
- Schema version 2 adds explicit `candidateMappings` for a review-plan label and each string minority concern.
- Each candidate mapping is bound to the canonical source recommendation SHA-256, so a map prepared for an older `rec_0` cannot label a changed recommendation.
- Each string minority entry requires an exact index mapping, stable minority ID, nonempty display title, exact UTF-8 source-text SHA-256, and at least one cited source UID.
- The source-text hash prevents a stale index-based overlay from silently labeling changed or reordered minority text.
- Missing, duplicate, extra, or unused candidate/minority mappings fail before output is written.
- Recommendation `time_span`, source UID, transcript chunk ID, submission item UUID, and cluster UUID remain in plan provenance. Schema version 2 requires an explicit transcript chunk ID and does not substitute the source UID.
- Output candidates remain `origin: ai`, `reviewStatus: draft`, and `requiresHumanReview: true`; the overlay is not a completed human review or publication approval.
- Plan creation and verification remain local-file-only and preserve exact-byte input hashes plus the canonical plan self-checksum.

## Verification

- Focused automation Vitest exercises the real analysis-core shape through the exported builder and child-process CLI create/verify paths.
- Negative coverage rejects an empty-title analysis without a candidate mapping, a string minority without its mapping, an unused minority mapping index, blank minority text, missing transcript chunk IDs, and recommendation/minority source-hash mismatches.
- Actual 8/29 analysis files, source-to-item mappings, database insertion, and publication remain pending inputs and approval boundaries.
