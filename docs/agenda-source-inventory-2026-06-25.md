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
- 이 테이블은 공개용 보조 코퍼스이며, 해외의제 천건 단위 원천은 여기서 확인되지 않는다.

### Supabase 보호 KB 코퍼스

- raw table: `public.kb_chunks`
- anon 직접 SELECT 행수: 0
- anon 직접 count: 0
- 정책: RLS intentionally blocks anon direct SELECT; service_role edge functions read this table.

문서상 기대 source:

- overseas-cases: 1025건
- kei-expert-agenda: 65건
- citizen-domestic: 108건

edge function 검색 검증:

- overseas-sentinel: 성공 · source=overseas-cases · 요청 5건 · 반환 5건
- overseas-wide-cap: 성공 · source=overseas-cases · 요청 1200건 · 반환 1000건
- gyeonggi-sentinel: 성공 · source=gyeonggi-citizens · 요청 5건 · 반환 5건

해석:

- 해외의제 천건 단위 데이터는 `agenda_corpus`가 아니라 보호된 `kb_chunks`/edge function 검색 경로에 있다.
- anon 직접 SELECT는 RLS로 차단되어야 하며, 현재 직접 행수는 0건이다.
- `kb-search`는 `source=overseas-cases`로 해외 권고를 반환한다. 다만 검색 endpoint는 top-k 검색 표면이라 전체 1025건의 공개 위키 페이지 생성 근거로 바로 쓰면 안 된다.
- 공개 위키에 연결하려면 service_role batch export 또는 검수 완료 view/RPC가 필요하다.

### 보호 KB source-backed export

- 파일: `public/workshop-graph/data/kb-agenda-surface.json`
- export 건수: 1311건
- source-backed href 보유: 1311건

source 분포:

- overseas-cases: 1025건
- kei-expert-agenda: 65건
- citizen-domestic: 108건
- gyeonggi-citizens: 113건

해석:

- 이 export는 service role 기반 source-backed 정적 산출물이다.
- 현재 `review_status`는 검수 필요 상태이므로 "공개 검수 완료 위키"가 아니라 "원천 기반 검토 자료"로 표시해야 한다.
- 그래프와 페이지는 이 파일을 읽을 수 있지만, 발표/공개 문구에서는 전체 검수 완료처럼 말하면 안 된다.

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

1. Supabase 해외의제 실제 저장 위치는 보호된 `public.kb_chunks`로 확인했다. 다음은 공개용 view/RPC 또는 service_role batch export 확정이다.
2. `kb_chunks`에서 공개 가능한 해외의제 source-backed export를 만들기 위한 service_role batch 또는 reviewed RPC를 확정한다.
3. 공개용 source-backed shape 확정: `id`, `source_type`, `title`, `summary`, `origin_url`, `document_ref`, `review_status`, `publication_status`.
4. 해외의제와 경기도 OCR을 같은 surface 계약으로 export.
5. `/ko/agenda-source/{source}/{id}/` 페이지 디자인 QA.
6. 그래프 카드에는 검수 완료 원천만 연결.
