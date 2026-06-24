# Realtime Transcription to Ontology Plan

Date: 2026-06-24
Status: planning handoff
Scope: use live recording and transcription to support the deliberation ontology during moderation.

## Position

Realtime transcription should not turn speech directly into public truth. It should create a time-coded, reviewable input stream that moderators can use to protect deliberation quality:

- every utterance remains traceable to a time window and source context;
- AI extraction proposes ontology structure but does not decide;
- moderators accept or correct what enters the graph;
- minority concerns are surfaced, not smoothed away.

## Current State Evidence

- The ontology graph schema is currently JSON: `elements.nodes[]`, `elements.edges[]`, and `meta`.
- Nodes carry `id`, `label`, `kind`, `kindKo`, `text`, `cited`, `session`, `deg`, and related flags.
- Edges carry `source`, `target`, `rel`, and `relKo`.
- `/workshop-graph/` already has live-source polling UI for sources marked as `category: "live"`.
- `public/workshop-graph/sources.json` has a `live-A_t1` source with `polling_default_sec`.
- `docs/ontology-graph-db-visibility-check-2026-06-24.md` confirms DB-backed ontology is not implemented yet.
- Supabase realtime patterns exist for `climate_vote.agenda` and `agenda_link` in `src/islands/canvas/use-realtime-agendas.ts`.
- The existing graph renderer can pass through richer fields already used or expected by the builder: `node_id`, `cited_uids`, `meta`, `evidence_type`, `review_state`, `is_public`, edge `src/dst`, `opposes`, `uid_time_index`, `recommendations`, and `quality`.
- `public/workshop-graph/data/live-A_t1.json` already shows the right privacy posture for a live source: moderator situation-awareness, citizen non-exposure, and uid traceability.

## Proposed Realtime Pipeline

The safest first slice is not a DB-backed public graph. It is:

1. private transcript capture;
2. moderator review;
3. export of approved draft items into the current `live` JSON shape;
4. existing `/workshop-graph/` polling of that live JSON source.

Only after this loop is verified should the project add a DB-backed graph adapter.

### Stage 1: Audio Capture

Input modes:

- moderator laptop microphone;
- table recorder upload after each segment;
- browser `MediaRecorder` proof of concept for local capture;
- external STT provider webhook later.

Do not store raw audio publicly. Raw audio should be either local-only, private storage, or short-retention restricted storage.

### Stage 2: Transcript Chunks

Split transcript into small time-coded chunks.

Suggested chunk fields:

- `session_id`
- `room_id` or group/table id
- `speaker_label` if available, otherwise unknown
- `start_ms`, `end_ms`
- `text`
- `language`
- `capture_method`
- `review_status`
- `source_uid`

`source_uid` becomes the bridge to ontology `cited` fields.

### Stage 3: Ontology Extraction Draft

An extraction worker reads transcript chunks and proposes:

- Issue
- Claim
- Proposal
- Concern
- Condition
- Value
- Evidence

Relations:

- supports
- opposes
- hasConcern
- requiresCondition
- hasEvidence
- modifies
- raisesIssue
- isAbout
- impacts

Output is a draft, not graph truth. It must include cited chunk ids.

### Stage 4: Moderator Review Queue

The moderator sees:

- original transcript chunk;
- proposed node kind and label;
- proposed relation;
- cited chunks;
- suggested facilitation prompt.

Moderator actions:

- accept;
- edit;
- merge with existing node;
- reject;
- ask follow-up;
- mark as minority concern;
- defer.

### Stage 5: Graph Publication

Only accepted nodes and edges enter the graph snapshot.

Two publication modes:

- moderator draft view: fast polling, marked as draft;
- public/presentation view: reviewed snapshot only.

The existing `/workshop-graph/` static JSON schema should remain the export contract until the DB adapter is stable.

For a first live demo, generate a `public/workshop-graph/data/live-*.json` compatible payload and add a `sources.json` live entry. This reuses the current polling UI and avoids exposing raw transcript tables to the browser.

## Habermas Layer in Realtime

Cards should explain why a moderator is seeing an item:

- Claim without Evidence: ask for supporting reason or experience.
- Proposal without Condition: ask what must be true for implementation.
- Concern isolated from Issue: preserve as minority concern and connect it to the issue.
- Value conflict: name the value tension rather than collapsing it into preference.
- Repeated Issue: cluster but preserve original utterances.

This keeps the tool explainable to citizens and moderators: the ontology is not just a visualization; it is a facilitation discipline.

## DB and API Design

Approval required before migrations or data mutation.

Suggested tables:

- `ontology.transcript_chunks`
- `ontology.extraction_runs`
- `ontology.extraction_candidates`
- `ontology.graph_nodes`
- `ontology.graph_edges`
- `ontology.review_actions`
- `ontology.graph_snapshots`

Minimum fields:

- `ontology.transcript_chunks`: `session_id`, `source_device`, `uid`, `start_ms`, `end_ms`, `text_raw`, `language`, `speaker_label_pseudonym`, `stt_provider`, `audio_object_ref`, `ingestion_run_id`, `review_state`.
- `ontology.extraction_runs`: chunk range, model/provider, prompt version, status, error, generated timestamp.
- `ontology.graph_nodes`: current JSON node fields plus `source_chunk_uids`, `review_state`, `is_public`, `published_at`, `approved_by`.
- `ontology.graph_edges`: current JSON edge fields plus `source_chunk_uids`, `review_state`, `is_public`, `published_at`, `approved_by`.
- `ontology.graph_sources` or a public view/RPC: returns the current `elements/meta` payload shape.

Suggested edge functions or workers:

- `transcript-ingest`
- `ontology-extract`
- `ontology-review-publish`
- `ontology-export-json`

RLS rules:

- raw transcripts: moderator/service role only;
- extraction candidates: moderator only;
- raw audio/transcript: no anon access;
- accepted graph snapshots: public read only when explicitly marked `review_state='approved'` and `is_public=true`;
- safer public path: expose only `ontology_public.graph_payload(source_id)` or an equivalent view/RPC, not the raw transcript or candidate tables;
- draft graph: moderator only;
- audit logs: service/moderator read, append-only.

## Privacy and Provenance Gates

Before any live deployment:

- consent and notice language must be approved;
- raw audio storage policy must be explicit;
- transcript retention period must be explicit;
- speaker identification must default to anonymous/table-level unless approved;
- every graph node must cite transcript chunks or be marked as moderator-created;
- every AI candidate must be review-gated;
- export must report dropped/uncited candidates.

## Minimal Prototype

The safest first prototype does not need live microphone streaming.

1. Upload or paste a short transcript segment into a moderator-only page.
2. Generate transcript chunk ids locally or through a test endpoint.
3. Run deterministic fixture extraction or a mock extractor.
4. Show candidates in a review queue.
5. Accept selected candidates.
6. Export to the current `workshop-graph` JSON schema.
7. Load it as a new `live` source in `/workshop-graph/`.

This proves the moderation loop without risking live audio, PII, or unreviewed AI publication.

## Implementation Slices

### R0: Transcript Fixture Contract

Create a fixture JSON format for transcript chunks and expected ontology candidates.

Acceptance:

- fixture can round-trip into current graph JSON schema;
- ids are stable and cited uid preservation is tested.

### R1: Live JSON Export Prototype

Use reviewed fixture output to generate a `public/workshop-graph/data/live-*.json` payload before building a DB adapter.

Acceptance:

- the payload has `elements.nodes[]`, `elements.edges[]`, and `meta`;
- `sources.json` can load it as a `live` source;
- polling works without exposing raw transcript tables;
- `cited` or `cited_uids` points back to transcript chunk ids.

### R2: Moderator Review Prototype

Build a private review surface under `/ko/moderator/ontology-review`.

Acceptance:

- candidate node/edge cards show transcript text and Habermas role;
- accept/edit/reject is local or test-backed first;
- no public publication.

### R3: Export to Graph Source

Export accepted items to `public/workshop-graph/data/live-*.json` or a DB snapshot adapter.

Acceptance:

- `/workshop-graph/?source=...` loads the result;
- source is clearly marked draft or reviewed;
- cited uid list appears in node detail.

### R4: STT Integration

Only after R0-R3:

- browser MediaRecorder proof of concept, or external STT webhook;
- private storage;
- transcript chunk review before extraction.

### R5: Live Moderator Prompts

Use ontology state to generate facilitation prompts:

- ungrounded claim;
- condition missing;
- concern not connected to issue;
- evidence cluster needs clarification;
- value conflict needs naming.

Prompts must be written as suggestions for moderators, not commands.

## Explicit Non-Goals for First Build

- no automatic consensus text;
- no speaker ranking;
- no hidden confidence score shown as authority;
- no public raw transcript feed;
- no irreversible DB changes without approval.

## First Build Recommendation

Build the review queue and export loop before live microphone capture. That gives the team a reliable demonstration of “realtime ontology-assisted moderation” while keeping the system honest: transcript first, candidate second, human review third, graph publication last.
