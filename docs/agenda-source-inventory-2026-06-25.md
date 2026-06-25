# 공식 의제 DB 인벤토리 감사

작성일: 2026-06-25

## 결론

현재 홈페이지에 연결 가능한 공식 의제 원천은 아직 완성형 DB가 아니다. 내부 가안 링크는 그래프 카드에서 제외되어야 하며, 공개 페이지와 그래프 카드는 Supabase 공개 검수 데이터와 경기도 OCR 원문 기반 데이터만 사용해야 한다.

## 현재 확인된 원천

### Supabase 공개 의제 코퍼스

- 테이블: `public.agenda_corpus`
- 접근 상태: 읽기 가능
- 확인 건수: 173건
- 가져온 건수: 173건

source 분포:

- expert-65: 65건
- citizen-108: 108건

category 분포:

- 감축: 119건
- 적응: 50건
- 혼합: 3건
- 감축+적응: 1건

해석:

- 현재 anon 공개 경로에서 확인되는 Supabase 의제 코퍼스는 173건이다.
- 사용자가 언급한 해외의제 천건 단위 데이터는 현재 이 공개 테이블/권한 경로에서는 확인되지 않는다.
- 따라서 해외의제 천건을 홈페이지 위키에 연결하려면 실제 테이블명, 공개 view/RPC, 검수 상태 필드가 먼저 확정되어야 한다.

### 경기도 OCR 의제 surface

- 파일: `public/workshop-graph/data/gyeonggi-agenda-surface.json`
- 추출 건수: 71건
- OCR 매칭: 70건
- source-backed href 보유: 71건

상태 분포:

- 최종선정: 20건
- 3차 채택: 33건
- 3차 미채택: 18건

해석:

- 현재 경기도 OCR 페이지는 원천 기반 페이지의 1차 구현이다.
- 전체 OCR 안건이 모두 수작업 검수된 상태는 아니다.
- 페이지 발췌와 OCR 매칭은 자동화 산출물이므로 발표 전 수동 QA가 필요하다.

### 내부 가안 surface

- 파일: `public/workshop-graph/data/agenda-surface.json`
- surface 건수: 65건
- 내부 가안 source 건수: 15건
- 공개 `/ko/agenda/` href 노출 건수: 0건

해석:

- 내부 가안은 공식 원문 DB로 보지 않는다.
- 그래프 카드에서 내부 가안 링크가 노출되지 않는 현재 방향이 맞다.

## 다음 작업

1. Supabase 해외의제 실제 저장 위치 확인: 테이블명, 스키마, RLS, 공개 view/RPC.
2. 공개용 source-backed shape 확정: `id`, `source_type`, `title`, `summary`, `origin_url`, `document_ref`, `review_status`, `publication_status`.
3. 해외의제와 경기도 OCR을 같은 surface 계약으로 export.
4. `/ko/agenda-source/{source}/{id}/` 페이지 디자인 QA.
5. 그래프 카드에는 검수 완료 원천만 연결.
