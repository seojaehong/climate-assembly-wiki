# KB 의제 출처 페이지 공개 전 QA

작성일: 2026-06-25

## 결론

KB 의제 출처 페이지와 그래프 관련 의제 카드는 공개 페이지에 연결 가능한 상태다. 다만 모든 KB 레코드는 `needs_review` / `internal_static_export`로 유지하며, 시민회의 결론이나 공식 권고안으로 승격하지 않는다.

## 확인 범위

- 해외 KB 샘플: `/ko/agenda-source/kb/000002-청소년-기후-교육-시민권/`
- 경기도 KB 샘플: `/ko/agenda-source/kb/001302-기후변화-피해-농가-및-일회용품-생산자에-대한-업종-전환-지원/`
- 그래프 로더: `/workshop-graph/index.html?source=workshop-2026-06-13`

## 검수 결과

- 공개 문구: 내부 가안 위키가 아니라 보호된 Supabase KB export임을 표시한다.
- 검수 상태: 페이지 상단과 검수 메모에 `검수 필요` 맥락을 노출한다.
- 과장 방지: 그래프 카드가 관련 자료를 숙의 보조 자료로 표현하고, AI가 결론을 만든 것이 아니라고 안내한다.
- 내부 가안 배제: 그래프 관련 의제 카드의 내부 `/ko/agenda/` 원문 링크는 계속 제외한다.
- 모바일: 430px 폭 Chrome headless 캡처에서 본문 카드와 긴 발췌문이 세로 스택으로 표시되며, 하단 가로 스크롤은 보이지 않는다.

## 증거

- `evaluation/screenshots/kb-agenda-desktop.png`
- `evaluation/screenshots/kb-agenda-mobile-final8.png`
- HTTP 확인:
  - 해외 KB 샘플 200, `보호 KB export · 검수 필요`, `공개 전 검수 메모`, `needs_review` 포함
  - 경기도 KB 샘플 200, `보호 KB export · 검수 필요`, `경기도 기후도민총회`, `공개 전 검수 메모` 포함
  - 그래프 HTML 200, `검수 전 KB 자료는 참고용`, `검수 필요`, `kb-agenda-surface` 포함
- 데이터 확인:
  - `public/workshop-graph/data/kb-agenda-surface.json` 총 1311건
  - `review_status !== needs_review` 또는 `publication_status !== internal_static_export`인 레코드 0건

## 남기는 제한

`needs_review` 상태의 KB 항목은 원천 기반 검토 자료다. 공개 문구, 분류, 요약을 사람이 승인하는 별도 절차 없이 공식 의제 위키나 최종 권고안으로 표시하면 안 된다.
