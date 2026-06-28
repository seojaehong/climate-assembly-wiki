# 참여단 주관식 질문 온톨로지 테스트

## 목적

오늘 참여단 테스트에서 주관식 2문항을 받아 즉시 구조화한다.

- 소감 1개
- 질문 1개

## 원칙

기존 워크숍 기록과 기존 온톨로지 화면은 수정하지 않는다.

- 기존 화면: `/workshop-graph/index.html`
- 0628 온톨로지 테스트 전용 화면: `/workshop-graph-0628-test/index.html`
- 0628 포스트잇 테스트 전용 화면: `/miro-0628-test/index.html`
- 기존 포스트잇/Miro형 리소스는 재사용한다.
  - `src/components/BoardAgendaCard.astro`
  - `src/components/BoardZone.astro`
  - `src/pages/[lang]/moderator/board.astro`
  - `public/board-demo.html`

## 권장 당일 경로

1. Google Form을 만든다.
2. 문항을 아래 3개로 둔다.
   - 조: `1조`부터 `15조`, `연구진`
   - 소감
   - 질문
3. Form 응답을 Google Sheet로 연결한다.
4. Sheet를 CSV로 가져오거나, 게시된 CSV URL을 사용한다.
5. 아래 명령으로 온톨로지 데이터를 만든다.

```powershell
node scripts/build-participant-question-ontology.mjs --csv public/sample/participant-open-questions-template.csv
```

Google Sheet CSV URL을 바로 쓸 때:

```powershell
node scripts/build-participant-question-ontology.mjs --csv-url "https://docs.google.com/spreadsheets/d/.../gviz/tq?tqx=out:csv&sheet=Form%20Responses%201"
```

## 산출물

- `public/workshop-graph-0628-test/index.html`
- `public/workshop-graph-0628-test/sources.json`
- `public/workshop-graph-0628-test/data/participant-open-questions.json`
- 온톨로지 URL: `/workshop-graph-0628-test/index.html`
- 포스트잇 URL: `/miro-0628-test/index.html`
- 관리자 URL: `/0628-admin/index.html`

0628 테스트 화면은 기본으로 아래 상태를 쓴다.

- `source=participant-open-questions`
- `mode=showcase`
- `count=75`
- `edgeLabels=on`
- `theme=light`

노드는 축약 라벨로 보이고, 호버/탭 메시지 카드는 조와 풀 문장을 보여준다. 포스트잇 화면은 소감/질문 레인과 조별 보기를 제공한다.

## 분석 방식

- 유사성: 같은 문항 안에서 응답 토큰의 Jaccard similarity를 계산한다.
- 센트럴리티: weighted degree centrality를 계산한다.
- 비트윈니스: 응답 유사도 그래프에서 Brandes 방식으로 betweenness centrality를 계산한다.
- 추가로 closeness centrality도 함께 산출해 현장 검토용 순위를 남긴다.

## 분석 방식 확장 계획

0628 테스트에서는 학술 지표명을 그대로 노출하기보다, 관리자/발표 화면에서 바로 이해되는 말로 변환한다.

우선 적용 순서:

1. `Frequency`: 많이 나온 단어와 요약 라벨을 찾는다. 화면 표기는 `많이 나온 것`.
2. `Degree centrality`: 직접 연결이 많은 응답/요약 노드를 찾는다. 화면 표기는 `많이 연결된 것`.
3. `Betweenness centrality`: 소감과 질문, 또는 서로 다른 조의 응답 사이를 이어주는 중간 노드를 찾는다. 화면 표기는 `이어주는 질문`.
4. `Closeness centrality`: 전체 응답군에 의미상 빨리 도달하는 노드를 찾는다. 화면 표기는 `전체와 가까운 것`.
5. `PageRank`: 중요한 노드와 연결된 응답을 찾는다. 화면 표기는 `핵심 흐름과 가까운 것`.
6. `Similarity cluster`: Jaccard/Cosine 유사도로 유사 질문·유사 소감을 묶는다. 화면 표기는 `유사 묶음`.
7. `Theory lens`: 하버마스/사회과학 렌즈로 응답을 해석한다. 화면 표기는 `논의 프레임`.
8. `Ego network`: 선택한 노드 주변 1-hop/2-hop만 확대한다. 화면 표기는 `이 응답 주변 보기`.
9. `Link candidate`: 아직 직접 연결되지 않았지만 구조상 연결 후보인 응답을 제안한다. 화면 표기는 `연결 후보`이며, 자동 확정하지 않는다.

지표별 내부 필드 후보:

| 분석 | 내부 필드 | 화면 표현 | 오늘 테스트 적용 |
| --- | --- | --- | --- |
| 빈도 | `analysis.frequency` | 많이 나온 것 | 가능 |
| 연결 중심성 | `analysis.degree` | 많이 연결된 것 | 가능 |
| 사이 중심성 | `analysis.betweenness` | 이어주는 질문 | 가능 |
| 근접 중심성 | `analysis.closeness` | 전체와 가까운 것 | 가능 |
| PageRank | `analysis.pagerank` | 핵심 흐름과 가까운 것 | 다음 slice |
| 유사 군집 | `analysis.similarity_cluster` | 유사 묶음 | 가능 |
| 이론 렌즈 | `analysis.theory_lens` | 논의 프레임 | 가능 |
| 에고 네트워크 | runtime filter | 이 응답 주변 보기 | UI slice |
| 링크 후보 | `analysis.link_candidates` | 연결 후보 | 검토용만 |

주의:

- 분석 결과는 합의나 최종 판단이 아니라 진행자 검토 보조다.
- `추천 연결`은 관리자 검토 전까지 확정 엣지와 구분한다.
- Supabase 승격 전에는 JSON snapshot에 분석 필드를 함께 저장한다.
- Google Form/Sheet 원문은 보존하고, 노드 라벨은 별도 요약 필드로 관리한다.

## 입력 파이프 결정

오늘 참여단 테스트는 Google Form/Sheet를 주 경로로 쓴다.

- 이유: DB migration 승인 없이 바로 받을 수 있고, 현장 테스트 실패 위험이 낮다.
- 방식: Form 응답 Sheet를 CSV로 내보내거나 게시 CSV URL을 `--csv-url`로 넣는다.
- Supabase는 같은 데이터 구조로 나중에 승격할 수 있게 계획만 유지한다.

## Google Workspace 실제 리소스

생성된 Google Form:

- 제목: `0628 참여단 주관식 질문 - 운영 감축`
- formId: `1yktkA_XAMGcVt4mlnC-0Yc3d3N0N0YQ__Dk1TfdTaCc`
- 편집 URL: https://docs.google.com/forms/d/1yktkA_XAMGcVt4mlnC-0Yc3d3N0N0YQ__Dk1TfdTaCc/edit
- 응답 URL: https://docs.google.com/forms/d/e/1FAIpQLSeH8fIX-Mjha32u1osfa_aQ2fM8OxAWUCg6_kZsFF33WsCaqA/viewform
- 문항:
  - `조`: `1조`부터 `15조`, `연구진`
  - `소감`
  - `질문`

생성된 Google Sheet:

- 파일명: `0628 참여단 주관식 질문 응답 - 운영 감축 - gws`
- URL: https://docs.google.com/spreadsheets/d/1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20/edit
- 응답 탭: `Form Responses 1`
- 헤더: `타임스탬프`, `조`, `소감`, `질문`, `메모`, `처리상태`

CSV URL 후보:

```text
https://docs.google.com/spreadsheets/d/1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201
```

온톨로지 생성 명령:

```powershell
node scripts/build-participant-question-ontology.mjs --csv-url "https://docs.google.com/spreadsheets/d/1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201"
```

gws 연결 상태:

- `gws 0.11.1`
- 계정: `iceamericano9@gmail.com`
- 승인 scope: Forms body, Forms responses readonly, Drive, Drive file, Sheets
- Forms API로 Form 생성 및 문항 추가 완료
- gws로 Sheet 생성, 탭 세팅, 값 읽기 검증 완료
- Form 응답 저장소 연결 확인 완료: `linkedSheetId=1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20`

현재 연결 상태:

- Google Forms API에는 응답 저장소를 기존 Spreadsheet로 지정하는 메서드가 노출되어 있지 않다.
- Google 공식 Help도 Form UI에서 `Responses` 탭의 `Select destination for responses`를 사용하도록 안내한다.
- 이번 테스트 Form은 현재 위 Sheet에 연결된 상태다.

Form-Sheet 연결 확인 절차:

1. Form 편집 URL을 연다.
2. `응답` 탭에서 Google Sheets 아이콘을 누른다.
3. 연결 대상이 위 Sheet인지 확인한다.
4. 연결 후 응답 탭 이름이 `Form Responses 1`인지 확인한다.
5. 현장 테스트 전 샘플 행은 삭제하거나 `처리상태=sample`로 유지한다.

## Supabase 승격 계획

오늘 테스트에서는 DB 스키마를 변경하지 않는다. 실제 운영 저장소가 필요하면 별도 승인 후 migration을 만든다.

최소 테이블 후보:

- `participant_open_question_responses`: raw Form 응답 보존
- `participant_open_question_graph_runs`: 그래프 생성 실행 이력
- `participant_open_question_edges`: 유사도/키워드/문항 연결 엣지

브라우저에 service role key를 노출하지 않고 Edge Function 또는 서버 측 batch만 쓴다.
