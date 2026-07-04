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

- Admin: `https://climate-assembly.org/0628-admin/index.html?_=422e12b`
- Ontology: `https://climate-assembly.org/workshop-graph-0628-test/?source=participant-open-questions&mode=showcase&count=50&edgeLabels=on&participantRel=similar`
- Miro-style post-it board: `https://climate-assembly.org/miro-0628-test/`
- Analysis criteria page: `https://climate-assembly.org/analysis-criteria-0628/`
- Form response: `https://docs.google.com/forms/d/e/1FAIpQLSeH8fIX-Mjha32u1osfa_aQ2fM8OxAWUCg6_kZsFF33WsCaqA/viewform`
- Form edit: `https://docs.google.com/forms/d/1yktkA_XAMGcVt4mlnC-0Yc3d3N0N0YQ__Dk1TfdTaCc/edit`
- Sheet: `https://docs.google.com/spreadsheets/d/1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20/edit`
- Dinner RSVP form: `https://docs.google.com/forms/d/e/1FAIpQLSeGs-baoPj_2Kry0jHBMtuMcy_03SZfkVX5jxZ93LOR1H3ZGA/viewform`
- Dinner RSVP edit: `https://docs.google.com/forms/d/1unIaSHFwm_qZj0M1b_sfRVjACgE-obQSKB-o7UfAlY8/edit`
- Dinner RSVP fields: required `이름`, required `저녁식사 선택` with options `중국집`, `삼겹살`, `불참`.
- Dinner vote result: `https://climate-assembly.org/dinner-vote-0628/`

## Current Design Baseline

- Ontology initial state: irregular two-cluster overview, with `질문` on the left and `소감` on the right.
- The first view should not become a straight line, grid, or slide carousel.
- Use stronger classroom-readable labels, transparent message cards, and avoid inner white text boxes.
- Node overlap prevention must include both response nodes and the `질문`/`소감` hub nodes.
- QR must be visible in the admin page:
  - Participant open-response QR: `public/0628-admin/google-form-qr.png`
  - Dinner RSVP QR: `public/0628-admin/dinner-rsvp-qr.png`
- Admin page deliberately no longer shows the old `17시 실제 데이터 운영` refresh instruction card. The user wanted the admin surface kept simpler; keep the script available but do not re-add that card unless asked.

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

## Current State For Claude

- We are now waiting for real participant data input. Do not rebuild forms or recreate QR resources unless the URLs break.
- The currently deployed admin page is the main operator surface. Password: `climate2026`.
- Admin page includes:
  - Ontology graph launch
  - Miro-style post-it launch
  - Analysis criteria page launch
  - Participant Google Form response/edit/QR tab
  - Dinner RSVP response/edit/result-view launch. The inline dinner QR remains visible, but the old QR tab button was replaced by `결과 보기` because the URL had already circulated.
  - Google Sheet link
  - Analysis summary cards
- Dinner vote result page:
  - Path: `public/dinner-vote-0628/index.html`
  - Data snapshot: `public/dinner-vote-0628/data/results.json`
  - Assets: `public/dinner-vote-0628/assets/chinese.svg`, `pork.svg`, `absent.svg`
  - Behavior: Chinese restaurant / pork belly / absent cards shuffle for 5 seconds, then the highest count is enlarged.
  - Counting rule: same-name duplicate responses use the latest row only.
- Ontology page includes:
  - Showcase label graph
  - participant view filters: `전체`, `소감`, `질문`
  - relation filters: `개요`, `응답`, `유사`, `연관`, `전체`
  - admin return link
  - analysis summary panel
  - shared overlap guard after showcase layout changes
- Miro page includes:
  - `소감/질문`
  - `조별 보기`
  - `분석 요약`
  - `유사 묶음`
  - `연관 렌즈`
  - admin return link
- Analysis criteria page is a separate facilitator-facing explainer for the shared classification logic. It reads the current participant JSON and shows Frequency, Degree, Betweenness, Closeness/PageRank, Similarity Cluster, Theory Lens, Ego Network, and Link Candidate with example rows.
- The current dummy dataset has 40 rows and 80 responses. It is safe as a demo snapshot until real data arrives.
- The actual Sheet CSV refresh script remains at `scripts/refresh-0628-participant-test.ps1`, but the admin card for that workflow was removed. Use it only when the user explicitly asks to refresh from the live Sheet.

## Last Known Deployment

Last verified commit during Codex work:

```text
422e12b fix: remove admin refresh notice
```

Verified:

- `https://climate-assembly.org/0628-admin/index.html?_=422e12b` returned 200, contains dinner RSVP and analysis summary, and no longer contains `17시 실제 데이터 운영` or `refresh-0628`.
- `https://climate-assembly.org/0628-admin/google-form-qr.png?_=c767990` returned 200 `image/png`.
- `https://climate-assembly.org/0628-admin/dinner-rsvp-qr.png?_=c767990` returned 200 `image/png`.
- `https://climate-assembly.org/workshop-graph-0628-test/index.html?source=participant-open-questions&mode=showcase&count=50&edgeLabels=on&participantRel=similar&_=c767990` returned 200 and contains `분석 요약`.
- `https://climate-assembly.org/miro-0628-test/index.html?_=c767990` returned 200 and contains `분석 요약`.

## 2026-07-04 Final-Decision Ontology Handoff

The final-decision ontology work is not accepted as a finished narrative yet. The live graph surface has been made presentation-safe, but the conceptual structure needs another planning pass.

Current live-safe state:

- Commit `85362c2` separated public final sources and hid the mixed process graph from public entry.
- Commit `71492bd` fixed the Pages production build/alias path; Cloudflare production is active on source `71492bd`.
- `https://climate-assembly.org/workshop-graph/` now defaults to `final-regulation-decisions-0704`.
- `https://climate-assembly.org/workshop-graph/?source=final-agenda-decisions-0704` opens the agenda final set separately.
- `final-process-to-conclusion-0704` is preserved in `public/workshop-graph/sources.json` with `hidden: true`, and the JSON file remains present. It is not deleted.
- Old direct links to `?source=final-process-to-conclusion-0704` fall back to the regulation final graph.
- Public final menu options are regulation and agenda; the mixed process graph is not exposed.

User-facing ontology constraint from the July 4 review:

- The desired baseline is the earliest/origin Habermas physics graph: white background, physical node layout, role-colored nodes, concise original-summary text inside nodes, and raw transcript/original text in hover.
- Hover cards should not become audit/status panels. Avoid `needs_review`, `transcript_partial`, `not_expected_in_current_graph`, `원본자료`, `음성 002`, or `재확인` style internal labels in presentation nodes.
- Agenda and regulation must remain separate. Do not merge them into a single public conclusion graph unless a new structure is explicitly accepted.
- The user rejected an editorial "we connected process to conclusion" look. The next version must show decisions emerging naturally from citizen deliberation: citizens discuss issues/claims/concerns/values/proposals, and a specific agenda or regulation decision emerges from that graph.
- For regulation, distinguish items settled during deliberation from items advanced to a vote, but show that distinction through the deliberation graph rather than through detached audit cards.
- Pause further ontology content/modeling edits until the structure is rethought. Keep the live-safe split/fallback as the operational baseline.

Verified July 4 checks:

- `npm.cmd exec -- vitest run scripts/workshop-graph-readability.test.mjs scripts/final-decision-lineage.test.mjs` passed with 2 files and 5 tests.
- Live `sources.json` returned default `final-regulation-decisions-0704`, `final-process-to-conclusion-0704.hidden === true`, and public final sources only `final-regulation-decisions-0704` / `final-agenda-decisions-0704`.
- Live DOM checks confirmed default regulation selection, process URL fallback to regulation, agenda URL selection, hidden process source absent from menu, and no visible internal status words.

## Dirty Files To Avoid

At the latest Codex handoff, these unrelated dirty/untracked files existed and were intentionally not staged:

```text
M index.md
M log.md
M public/0704-admin/live-sheet-questions-print.html
M public/0704-admin/live-sheet-questions-print.pdf
M public/agenda-board-0704/index.html
M public/agenda-vote-0704/index.html
M public/workshop-graph/data/agenda-surface.json
M public/workshop-graph/data/gyeonggi-agenda-surface.json
M public/workshop-graph/data/kb-agenda-surface.json
M src/data/agenda-network-scene.json
?? 02_Sheet_샘플_3조입력예시.csv
?? evaluation/screenshots/0704-agenda-vote-bubble-race-20260704-161924.png
?? evaluation/screenshots/0704-agenda-vote-four-dummy-20260704-151412.png
?? evaluation/screenshots/0704-agenda-vote-four-dummy-after-play-20260704-verify.png
?? evaluation/screenshots/0704-agenda-vote-four-dummy-live-after-deploy.png
?? evaluation/screenshots/0704-all-agenda-board-17-20260704-162303.png
?? evaluation/screenshots/0704-all-agenda-board-17-fullpage-20260704-162346.png
?? evaluation/screenshots/0704-demo-agenda-bubble-race-final.jpeg
?? evaluation/screenshots/0704-demo-decision-results.jpeg
?? evaluation/screenshots/0704-manual-page-1.png
?? evaluation/screenshots/0704-manual-page-2.png
?? evaluation/screenshots/0704-manual-page-3.png
?? evaluation/screenshots/0704-manual-page-4.png
?? evaluation/screenshots/0704-manual-page-5.png
?? evaluation/screenshots/0704-manual-page-6.png
?? evaluation/screenshots/0704-manual-page-7.png
?? evaluation/screenshots/0704-manual-page-8.png
?? evaluation/screenshots/0704-manual-page-9.png
?? evaluation/screenshots/0704-manual-pages-5-9-contact.png
?? evaluation/screenshots/0704-selected-agenda-board-20260704-161850.png
?? public/sim-identity.csv
```

Do not revert or stage them unless the user explicitly asks.
