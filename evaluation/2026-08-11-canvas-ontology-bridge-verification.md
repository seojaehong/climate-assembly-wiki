# Canvas ontology review bridge verification

- Date: 2026-08-11 KST
- Scope: local Canvas snapshot → human-review plan → internal workshop graph JSON
- Mutation boundary: no Supabase, API, environment credential, DB mutation, or public graph write
- Test data: synthetic agenda text and identifiers only

## Verified behavior

- Active agenda cards become `proposed` review nodes without an inferred ontology kind.
- `agenda_link` and action→parent relations remain untyped until a reviewer selects a relation.
- `group_id` membership is preserved as a session-scoped cluster review item.
- Archived agendas and links with inactive endpoints are retained in an explicit `excluded` section.
- Duplicate agenda/link IDs, cross-session relations, invalid parents, and empty active snapshots fail closed.
- The generated plan is bound to exact snapshot bytes and a canonical self-checksum.
- Reviewed export reconstructs all immutable source fields from the snapshot and permits only kind, display label/text, and review decisions to differ; the original text remains bound by snapshot and text hashes.
- Export requires every node, relation, and cluster to be accepted, edited, or rejected as applicable, with reviewer and canonical UTC time; changed node content requires `edited`.
- Accepted output uses the existing `elements.nodes`/`elements.edges` graph schema, keeps `is_public: false`, and records snapshot/agenda provenance.
- The CLI refuses any output path below the repository `public` directory.
- CLI failure messages do not echo malformed participant content.

## Focused execution

```powershell
cd automation
npm.cmd exec vitest -- run tests/canvas-ontology-bridge.test.mjs
```

Result: 9 tests passed. The CLI integration test exercised create, verify, reviewed export,
no-overwrite, public-path refusal, and no-credential execution through a child Node process.

## Remaining boundary

The plan checksum is an accidental-change self-check, not an external signature. Reviewer identity is
a non-secret role label rather than authenticated proof. Copying an approved internal export into a
public source, introducing ontology DB tables, or publishing a reviewed snapshot remains a separate
human approval and DB/schema process.
