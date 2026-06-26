# Graph Presentation Readiness Audit — 2026-06-26

## Scope

- Target: `/workshop-graph/?source=workshop-2026-06-13`
- Purpose: presentation A/B surface after planner feedback.
- Non-goal: editing `/ko/agenda/` pages, mutating Supabase records, or claiming official minutes validation.

## Current Decision

- Presentation mode is a density-controlled view over the same source graph.
- It is not a sampled or reduced replacement for the ontology.
- Original workshop graph data remains the source of truth: 613 nodes and 491 edges.
- AI is framed as a deliberation aid, not as a consensus maker.

## Presentation Levels

| URL | Label | Purpose | First-screen density |
| --- | --- | --- | --- |
| `?mode=present&level=chapter` | 대목차 | Stage opening / explain the big map | 8 collapsed chapter nodes |
| `?mode=present&level=brief` | 중간목차 | A/B testable presentation map | 72 collapsed representative nodes |
| `?mode=present&level=full` | 원본전체 | Q&A / inspection / verification | full graph, labels constrained |
| `?mode=showcase&count=50|75|100` | 쇼케이스 | Planner-facing product demo feel | sampled original nodes with physics |

## Fixed In This Pass

- Added `level=chapter|brief|full` URL state and `발표 밀도` segmented control.
- `chapter` uses 8 top-level chapter containers.
- `brief` uses session-by-ontology-role representative containers. Current data creates 72 representative nodes, inside the requested 50-100 screen-density band.
- `full` no longer displays every label at once. It keeps edge labels off and shows only overview/focus labels.
- Presentation mode hides or compresses operator-heavy UI: 2D/3D toggle, search, hub chips, and legacy grouping controls.
- Edge relation labels are hidden by default in presentation mode. They appear only in focus contexts outside chapter mode.
- Collapsed presentation groups now get a second layout pass and are fit by visible representative nodes, not by the expanded compound graph.
- Group labels include child counts, making it clear that the original nodes are folded inside.
- Added a separate `showcase` mode for A/B testing against planner expectations. It keeps the early dark force-graph feel, shows Korean node/edge labels, enables physics by default, and lets the presenter choose 50, 75, or 100 visible original nodes.
- Showcase labels use `shortLabel` only for display. Click/hover surfaces still read the original node text and provenance.
- Updated `showcase` into a theatre view: header, tabs, search, source selector, footer, hub chips, and the right overview panel are hidden so the canvas uses the full viewport. Only a small 50/75/100 count switch remains at the bottom-right, keeping the top of the screen empty.

## Verified Locally

- `chapter`
  - Visible nodes: 8
  - Visible groups: 8
  - Collapsed groups: 8
  - Edge labels shown: 0
  - Normal node labels shown: 0
  - Horizontal overflow: 0
- `brief`
  - Visible nodes: 72
  - Visible groups: 72
  - Collapsed groups: 72
  - Edge labels shown: 0
  - Normal node labels shown: 0
  - Horizontal overflow: 0
- `full`
  - Visible nodes: 562 after isolated-node default filter
  - Edge labels shown: 0
  - Normal node labels shown: 82 overview labels
  - Horizontal overflow: 0
- `showcase`
  - `count=50`: 50 visible original nodes, 62 visible edges, 50 shortened node labels, 62 Korean edge labels, physics ON, horizontal overflow 0
  - `count=75`: 75 visible original nodes, 85 visible edges, 75 shortened node labels, 85 Korean edge labels, physics ON, horizontal overflow 0
  - `count=100`: 100 visible original nodes, 107 visible edges, 100 shortened node labels, 107 Korean edge labels, physics ON, horizontal overflow 0
  - Theatre viewport check at 1892x768: canvas 1892x768, top visible controls 0, header/tabs/footer/side/hub hidden, count switch bottom-right, dark background, horizontal overflow 0
- Browser page-scale smoke for `chapter` and `brief` at 1, 1.25, 1.5, 1.75:
  - Visible node count remained stable.
  - Edge labels stayed hidden.
  - Normal node labels stayed hidden.
  - Horizontal overflow remained 0.
- Mobile 390px `brief`:
  - Visible nodes: 72
  - Edge labels shown: 0
  - Normal node labels shown: 0
  - Horizontal overflow: 0
- 3D regression:
  - Nodes: 613
  - Links: 491
  - Canvas present.

## Remaining Caveats

- Live Cloudflare deployment must still be verified after publish.
- Automatic pixel-level label-overlap detection is not implemented; this audit uses label-count, visibility, zoom, and overflow checks.
- `B_t2` remains a partial-source caveat from the source coverage audit: it is present in graph output but based on incomplete transcription artifacts.
- Node labels remain LLM-extracted and not official minutes.

## Recommended Presentation Use

1. Start with `level=chapter`.
2. Use `level=brief` for the main planner A/B test because it shows 72 representative nodes without exposing every raw label.
3. Use `mode=showcase&count=75` when the goal is product-demo feel: early force-graph style, live physics, Korean relation labels, and shortened node names.
4. Use `level=full` only for Q&A or verification.
5. Explain that `present` folds containers, while `showcase` samples original nodes for visual A/B testing. Neither is an AI-made consensus.
6. Keep 3D as an exploration view, not the main stage surface.
