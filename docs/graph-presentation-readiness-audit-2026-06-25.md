# Graph Presentation Readiness Audit — 2026-06-25

## Scope

- Target: `/workshop-graph/?source=workshop-2026-06-13`
- Purpose: presentation-surface readiness check after planner feedback.
- Non-goal: editing `/ko/agenda/` pages or mutating Supabase/database records.

## Current Decision

- Presentation mode is not a reduced or sampled graph.
- `mode=present` uses a bright 2D surface and adds top-level chapter containers.
- Original nodes and edges stay present: 613 nodes and 491 edges.
- AI is presented as a deliberation aid, not as a consensus maker.

## Fixed In This Pass

- Added `대목차` grouping for presentation mode.
- Default `mode=present` now opens with `group=present`.
- Presentation top-level chapters:
  - A조 의제선정 흐름: 170
  - B조 의제선정 흐름: 156
  - 운영규정 논의: 129
  - 환경교육·생활실천: 88
  - 통합 의제정리: 34
  - 정의로운전환: 22
  - 영향집단·참여자 관점: 8
  - 조별발표·공유: 6
- Session grouping no longer surfaces `청년`, `농민`, `직장인` and similar participant labels as fake sessions. They are grouped as `영향집단·참여자 관점`.
- Presentation label styling was reduced for ordinary nodes so Chrome zoom or graph zoom does not try to keep every node label large at once.

## Verified

- Local static route loaded:
  - `/workshop-graph/?source=workshop-2026-06-13&mode=present`
  - `/workshop-graph/?source=workshop-2026-06-13&mode=present&group=session`
  - `/workshop-graph/?source=workshop-2026-06-13&view=3d`
- Presentation default:
  - Active group: `present`
  - Real nodes: 613
  - Edges: 491
  - Chapter groups: 8
  - Horizontal overflow: 0
- Session view:
  - Real nodes: 613
  - Edges: 491
  - Session groups: 16
  - Fake singleton sessions removed from visible grouping.
- Mobile 390px:
  - Real nodes: 613
  - Edges: 491
  - Chapter groups: 8
  - Horizontal overflow: 0
- 3D:
  - Nodes: 613
  - Links: 491
  - Canvas present.
- Browser zoom smoke:
  - Page scale 1, 1.25, 1.5, 1.75 kept active `present` group, 613 nodes, 8 chapter groups, and horizontal overflow 0.

## Remaining Presentation Caveats

- The graph is now safer for presentation, but live site deployment still must be verified after Cloudflare publishes the pushed commit.
- Visual label collision is reduced by semantic zoom and smaller ordinary labels, but full automatic pixel-level overlap detection is not implemented.
- `B_t2` remains a partial-source caveat from the source coverage audit: it is present in graph output but based on incomplete transcription artifacts.
- The page still states `LLM 추출 · 인간 검증 전`; do not present node labels as official minutes or final validated ontology.

## Recommended Presentation Use

1. Use `?mode=present` as the default stage view.
2. Explain `대목차` as a presentation guide laid over the full graph, not as a reduced graph.
3. Switch to `세션` to explain the 1박2일 discussion flow.
4. Switch to `쟁점` only when explaining the detailed ontology extraction layer.
5. Use 3D only as a supplementary exploration view, not as the main presentation surface.
