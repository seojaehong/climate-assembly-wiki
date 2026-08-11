# Workshop graph DB adapter verification

- Date: 2026-08-11 KST
- Scope: optional approved DB graph catalog → existing `/workshop-graph/` source dropdown
- Mutation boundary: read-only browser fetch; no schema, RLS, database row, credential, or public source mutation
- Active production source: static `sources.json` fallback because no approved DB snapshot endpoint is configured

## Verified behavior

- Static catalog and every current static graph payload load through the same adapter contract.
- Optional DB catalog uses a 20-second timeout and one retry; failure keeps the static catalog and emits an error log.
- Only rows with `review_state=approved` and `is_public=true` appear as `DB` sources.
- Invalid row counts, node roles/labels, edge relations, duplicate IDs, edges that reference missing nodes, and private or unreviewed nodes fail the optional DB catalog closed.
- Non-HTTPS absolute endpoint URLs and URLs containing query parameters, embedded credentials, or fragments fail before any DB request. Same-origin relative paths remain allowed.
- Selected DB sources display the returned row count and actual node/edge counts.
- Nodes missing both `cited` and `cited_uids` are counted and surfaced as a provenance warning.
- The graph page consumes the adapter for catalog and payload loading while retaining the existing static default and source filtering.
- Required static catalog failures and payload failures are logged and surfaced; optional DB catalog failures are logged before the adapter continues with the static catalog. Failed source changes restore the last successfully displayed source and URL.

## Focused execution

```powershell
npm.cmd exec vitest -- run scripts/workshop-graph-source-adapter.test.mjs scripts/workshop-graph-readability.test.mjs
node --check public/workshop-graph/graph-source-adapter.js
```

Result: 17 tests passed and the public adapter module passed Node syntax validation.

## Full and browser execution

- `npm.cmd exec vitest -- run src scripts`: 56 files, 849 tests passed.
- `automation/npm.cmd test`: 15 files, 182 tests passed.
- `npm.cmd run check`: 0 errors; 49 existing hints.
- Node 20 Astro build: 7,913 pages; log at `evaluation/2026-08-11-workshop-graph-db-adapter-build.log`.
- Local Chromium opened the built `/workshop-graph/` surface with HTTP 200 and no initial page error,
  three Cytoscape canvases, and the visible metadata `노드 47 · 엣지 56 · DQI 지표`.
- Both metadata and advisory surfaces expose polite live status semantics.
- The browser found zero `DB` options, which matches the intentionally unconfigured endpoint boundary.
- A routed 503 fixture forced both retry attempts for an alternate source to fail. The page logged the failure,
  announced `새 source 로드 실패 · 기존 화면 유지`, restored the original source in the dropdown and canonical URL state, and kept the
  original `노드 47 · 엣지 56 · DQI 지표` graph metadata, 3D availability, and polling visibility without a page error.

Browser evidence:

- `evaluation/2026-08-11-workshop-graph-db-adapter-browser.json`
- `evaluation/2026-08-11-workshop-graph-db-adapter-browser.png`

## Remaining boundary

This slice implements the read contract and UI fallback only. The DB graph snapshot table/RPC, public read RLS,
deployment endpoint configuration, and first approved live snapshot do not exist yet and require explicit user approval.
Until those are available and verified, the dropdown shows only the tracked static sources.
