# Public Result Source Plan Contract

## Purpose

This local, read-only preflight bridges the current public result snapshot and the authenticated `issue_items` read model without publishing source text or changing the database. It prepares an approval artifact for the A7 source-backlink data contract.

It does **not** add backlinks to `/r/<token>`, expose submission text, update `result_page.body`, or approve a database migration.

## Inputs

- `--result`: one captured `result_get` response.
- `--issue-items`: `{ "topics": [...] }`, where every entry is an exact `issue_items` response for a topic represented in the public result.

The capture must be produced in the same controlled publication window. The tool rejects topic-set differences and recomputes these published facts from source links:

- issue team set;
- issue consensus denominator using `cluster_id ?? item_id`;
- total unclassified item count.

Any mismatch fails before a plan is written. This prevents a current mutable review graph from being presented as provenance for an older public snapshot.

## Output and privacy boundary

The schema-v1 plan contains stable issue, item, submission and cluster IDs; team, ordinal, kind and `linked_by`; and a SHA-256 of each source item's content. It deliberately excludes source content and rationale. The plan is always marked:

- `dryRun: true`
- `databaseMutationExecuted: false`
- `publicPayloadWritten: false`
- `requiresApproval: true`

The canonical self-checksum detects accidental edits only. It is not an external signature, reviewer authentication or publication approval.

## Commands

```powershell
cd automation
npm.cmd run plan:platform-result-sources -- --result <result.json> --issue-items <issue-items.json> --output <plan.json>
node platform-result-source-plan.mjs --result <result.json> --issue-items <issue-items.json> --verify-plan <plan.json>
```

The CLI refuses to overwrite an existing output. Keep authenticated captures and generated plans outside `public/`; do not commit real citizen text or join/HQ credentials.

## Approval boundary

The next step still requires explicit approval for the public payload schema and DB/RPC migration. That approved design must define which source fields may be public, snapshot the source references atomically with `result_publish`, and provide a public read route before the UI can render real backlinks.
