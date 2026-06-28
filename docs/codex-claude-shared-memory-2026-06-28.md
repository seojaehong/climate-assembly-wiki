# Codex-Claude Shared Memory - 2026-06-28

## Working Root

Primary working folder:

```text
C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\wiki
```

This repository is the shared working surface for Codex and Claude on the climate moderator wiki and 0628 participant test.

## Coordination Rules

- Do not replace or mutate the archival ontology viewer unless the user explicitly asks.
- Keep 0628 participant-test work isolated under:
  - `public/workshop-graph-0628-test/`
  - `public/miro-0628-test/`
  - `public/0628-admin/`
  - `docs/participant-open-question-ontology-test.md`
  - `evaluation/0628-participant-test-report.json`
- Before starting new work, inspect:
  - `git status --short`
  - `tasks/ralph/moderating-platform-realtime-ontology/progress.txt`
  - `docs/participant-open-question-ontology-test.md`
- Do not redo completed GWS/Form/Sheet setup unless the current URLs are broken.
- Do not stage unrelated dirty files. Several user/parallel-worker files may remain dirty.
- Push before handing off when a code/document change is completed.

## Current 0628 URLs

- Admin: `https://climate-assembly.org/0628-admin/`
- Ontology: `https://climate-assembly.org/workshop-graph-0628-test/?source=participant-open-questions&mode=showcase&count=50&edgeLabels=on&theme=light&tone=calm`
- Form response: `https://docs.google.com/forms/d/e/1FAIpQLSeH8fIX-Mjha32u1osfa_aQ2fM8OxAWUCg6_kZsFF33WsCaqA/viewform`
- Form edit: `https://docs.google.com/forms/d/1yktkA_XAMGcVt4mlnC-0Yc3d3N0N0YQ__Dk1TfdTaCc/edit`
- Sheet: `https://docs.google.com/spreadsheets/d/1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20/edit`

## Current Design Baseline

- Ontology initial state: irregular two-cluster overview, with `질문` on the left and `소감` on the right.
- The first view should not become a straight line, grid, or slide carousel.
- Use stronger classroom-readable labels, transparent message cards, and avoid inner white text boxes.
- Node overlap prevention must include both response nodes and the `질문`/`소감` hub nodes.
- QR must be visible in the admin page and use `public/0628-admin/google-form-qr.png`.

## Analysis Baseline

The 0628 test should support both simple and advanced ontology/text-network analysis:

- Frequency: 많이 나온 것
- Degree centrality: 많이 연결된 것
- Betweenness centrality: 이어주는 질문
- Closeness centrality: 전체와 가까운 것
- PageRank: 핵심 흐름과 가까운 것
- Similarity cluster: 유사 묶음
- Theory lens: 논의 프레임
- Ego network: 이 응답 주변 보기
- Link candidate: 연결 후보

Display labels should be facilitator-facing Korean, while JSON fields may use English metric names.

## Last Known Deployment

Last verified commit during Codex work:

```text
320af1f fix: keep 0628 hubs clear
```

Verified:

- `https://climate-assembly.org/0628-admin/index.html` returned 200 and contained `google-form-qr.png`.
- `https://climate-assembly.org/0628-admin/google-form-qr.png` returned 200 `image/png`.
- `https://climate-assembly.org/workshop-graph-0628-test/` loaded with showcase mode and canvas.
