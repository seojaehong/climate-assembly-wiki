# Agenda Library Source Separation QA

Date: 2026-06-25

## Scope

- Updated `/ko/agenda/` from a legacy internal draft list into an agenda library that separates source-backed records from internal explanation drafts.
- Kept the 15 legacy cards, but relabeled them as internal agenda brief drafts.
- Added source-backed entry points for protected KB export, Gyeonggi OCR records, and the deliberation ontology graph.
- Added internal-draft warning to individual `/ko/agenda/{slug}/` pages.

## Evidence

- `/ko/agenda/` contains `의제 자료실`, `보호 KB export`, `경기도 OCR`, `내부 의제 해설 초안 15건`.
- `/ko/agenda/` no longer contains `원어민 검증` in the agenda card list.
- `/ko/agenda/electricity-price/` contains `내부 해설 초안입니다`, `공식 원천 DB가 아닙니다`, `내부 가안`, and no `원어민 검증`.
- `/ko/agenda/` links to:
  - `/ko/agenda-source/kb/000002-청소년-기후-교육-시민권/`
  - `/ko/agenda-source/gyeonggi/001-경기도형-탄소-포인트-기부-나눔/`
  - `/workshop-graph/?source=workshop-2026-06-13`

## Screenshots

- `evaluation/screenshots/agenda-library-desktop.png`
- `evaluation/screenshots/agenda-library-mobile.png`

## Known Build Blocker

`npm.cmd run check` still fails on the pre-existing Supabase Edge Function Deno typing issue in `supabase/functions/chat/index.ts`. The agenda page changes did not introduce new Astro diagnostics.
