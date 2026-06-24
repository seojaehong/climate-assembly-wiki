# Moderating Platform Implementation Plan

Date: 2026-06-24
Status: planning handoff
Scope: turn the current moderator tools and deliberation ontology into one coherent facilitation platform.

## Position

The platform should not present AI as a consensus maker. Its job is to help moderators preserve speech, reveal argument structure, keep minority concerns visible, and move from discussion to reviewable agenda work. The operating frame is:

- ontology = structured roles and relations in the deliberation;
- Habermas = the public explanation layer for why claims need reasons, concerns remain visible, and decisions require human justification;
- moderator platform = the workflow surface where humans review, group, question, and decide.

## Current State Evidence

The repo already has three relevant surfaces.

1. Public deliberation ontology graph
   - `public/workshop-graph/index.html` loads `sources.json`, static graph JSON files, and renders 2D/3D/action-surface interactions.
   - `public/workshop-graph/sources.json` defines the default workshop graph plus a live-category source with polling metadata.
   - `docs/ontology-graph-db-visibility-check-2026-06-24.md` records that the graph is not DB-backed yet and recommends an ontology table set plus adapter.

2. Moderator operations dashboard
   - `src/pages/[lang]/moderator/live.astro` is KO-only, noindex, private, and supports simulation plus Google Sheet polling.
   - Other `/ko/moderator/*` pages already use a dark, projector-oriented moderator navigation pattern.

3. Supabase-backed canvas and realtime patterns
   - `src/islands/CanvasBoard.tsx` provides the strongest platform base: agenda cards, grouping, parent/action links, vote-round creation, QR entry, KNN/suggestion edge functions.
   - `src/islands/canvas/use-realtime-agendas.ts` subscribes to `climate_vote.agenda` and `climate_vote.agenda_link` with Supabase realtime.
   - `src/lib/supabase.ts` centralizes the browser anon client and realtime configuration.
   - `src/islands/JoinForm.tsx` already proves the mobile input path: participant token, agenda insert, and realtime reflection on the canvas.

## Target Platform Shape

The platform should be a moderator cockpit with five panels, not a new landing page:

- **Live Input**: incoming citizen questions, transcript chunks, and moderator notes.
- **Ontology Surface**: Issue, Claim, Proposal, Concern, Condition, Value, Evidence nodes and relations.
- **Review Queue**: AI-suggested nodes/edges waiting for human acceptance, edit, or rejection.
- **Facilitation Prompts**: questions moderators can ask when a claim lacks evidence, a proposal lacks conditions, or a minority concern is isolated.
- **Decision Handoff**: reviewed agenda clusters, recommendation candidates, DQI/quality indicators, and export snapshots.

## Architecture

Use the existing repo direction instead of starting over. The safest core is `CanvasBoard + JoinForm + useRealtimeAgendas + useAuth`. Existing Google Sheet/CSV pages should be treated as legacy/read-only adapters until each source is deliberately migrated.

### Layer 1: Session Model

Reuse `climate_vote.session` as the session anchor if it is confirmed live in Supabase. Add an ontology-specific session/source layer only after approval:

- `ontology.graph_sources`
- `ontology.graph_nodes`
- `ontology.graph_edges`
- `ontology.review_items`
- `ontology.snapshots`

Approval gate: schema/migration is required before creating these tables.

Before platform implementation, the actual Supabase source of truth must be represented in repo migrations. Current migrations only cover snapshot/RPC support, not the full `session`, `participant`, `agenda`, `agenda_link`, `agenda_edit_log`, `rounds`, and attendance schema/RLS/realtime publication contract. That missing DB contract is the first blocker for a durable platform.

### Layer 2: Ingestion and Review

Do not publish AI extraction directly into the public graph.

Flow:

1. Raw input arrives as a citizen agenda card, moderator note, or transcript chunk.
2. A server-side worker/edge function proposes ontology nodes and edges.
3. Proposed nodes/edges enter `review_items`.
4. Moderator accepts, edits, merges, or rejects.
5. Accepted items become graph nodes/edges.
6. Snapshots feed `/workshop-graph/` through a DB adapter or exported static JSON fallback.

### Layer 3: Graph Adapter

Extend `/workshop-graph/` with source adapters:

- static JSON adapter: current production path, remains fallback;
- DB snapshot adapter: fetches an approved graph source;
- live polling adapter: only reads approved graph snapshot or moderator-visible draft, never raw unreviewed extraction.

The current `sources.json` category model can remain. Add new source ids later, for example:

- `live-session-7-4-reviewed`
- `live-session-7-4-draft` for moderator-only view

### Layer 4: Moderator UX

Build on `CanvasBoard` rather than replacing it:

- left rail: incoming items and transcript chunks;
- center: card/canvas workbench;
- right rail: ontology preview and Habermas role explanation;
- top bar: session, live status, snapshot, export;
- review drawer: suggested node/edge diff.

The current ontology action surface should stay available as the graph view, but the platform workbench should emphasize moderator action: accept, revise, merge, ask follow-up, export.

## Hardening Needed Before Platform Use

Current canvas writes often end in `.then(() => {})` and do not surface errors to the operator. Platformization must add:

- visible toast/status for failed writes;
- audit logging for moderator edits;
- typed realtime payload handling rather than broad casts;
- retry or revert behavior for drag/update/link/delete operations;
- a “read-only/degraded” mode when Supabase is unavailable.

This should happen before relying on the canvas in a live 200-person facilitation setting.

## Implementation Slices

### M0: Platform Shell and Navigation

Goal: one moderator entry point that links the existing tools coherently.

Files:

- `src/pages/[lang]/moderator/live.astro`
- `src/pages/[lang]/moderator/canvas.astro`
- shared moderator nav blocks in moderator pages

Acceptance:

- `/ko/moderator/live`, `/ko/moderator/canvas`, `/workshop-graph/`, and `/workshop-graph/guide/` are explicitly connected for operators.
- Page copy says the tool supports deliberation and moderation; it does not decide for the assembly.

### M1: Supabase Contract Freeze

Goal: make the DB contract explicit in repo before new platform logic depends on it.

Deliverable:

- migration draft for `session`, `participant`, `agenda`, `agenda_link`, `agenda_edit_log`, `rounds`, and attendance if missing;
- RLS/read/write policy matrix;
- realtime publication checklist;
- rollback plan.

Acceptance:

- no schema is applied without user approval;
- every platform write path has a table, policy, and failure mode.

### M2: Canvas Write Hardening

Goal: turn the current canvas into a reliable operating surface.

Acceptance:

- drag/update/archive/link/delete failures are visible to the moderator;
- writes do not silently fail;
- degraded state is shown when Supabase is missing;
- realtime subscription errors are logged.

### M3: Ontology Review Queue Design

Goal: define the DB contract before implementation.

Deliverable:

- migration draft only, not applied without approval;
- RLS policy draft;
- seed/dry-run script plan.

Minimum fields:

- transcript/source uid;
- node kind and label;
- relation type;
- cited uid list;
- confidence/debug metadata stored for moderators, not shown as authority;
- review status: proposed, accepted, edited, rejected;
- reviewer and timestamp.

### M4: Canvas to Ontology Bridge

Goal: accepted agenda cards can be represented as ontology nodes.

Approach:

- card text can become a `Proposal`, `Claim`, or `Issue` suggestion;
- group_id can map to an Issue cluster;
- parent/action edges can map to `requiresCondition`, `supports`, or implementation relation after moderator confirmation.

Acceptance:

- no automatic publication;
- accepted bridge output can be exported to the current static JSON graph schema.

### M5: Graph DB Adapter

Goal: `/workshop-graph/` can read approved graph snapshots from DB.

Acceptance:

- static JSON remains fallback;
- source dropdown can show DB-backed source only when fetch succeeds;
- row counts and node/edge counts are displayed;
- provenance warnings show when cited ids are missing.

### M6: Recommendation and Quality Integration

Goal: connect consensus/DQI outputs as read-only assets.

Use the existing graph hooks for `meta.recommendations` and `meta.quality`. Keep them advisory:

- “recommendation candidate” not “decision”;
- “quality signal” not “truth score”;
- human review remains required.

## Non-Negotiable Rules

- No AI-made consensus.
- No loss of minority concerns.
- No raw transcript publication without review.
- No unapproved DB schema or bulk data mutation.
- Provenance must survive every step: source uid, transcript chunk id, cited uid list.
- Static fallback remains until DB-backed path is verified.

## First Build Recommendation

Start with M0, M1, and M2.

Do not begin with live STT. The current production graph is stable because it is static and reviewable. The platform should first gain an explicit DB contract, hardened write paths, a review queue, and an export path, then accept realtime transcript chunks as another input source.
