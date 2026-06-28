# 참여단 주관식 질문 온톨로지 테스트

## 목적

오늘 참여단 테스트에서 주관식 2문항을 받아 즉시 구조화한다.

- 기후시민회의 운영 관련 질문 1개
- 감축의제 질문 1개

## 원칙

기존 워크숍 기록과 기존 온톨로지 화면은 수정하지 않는다.

- 기존 화면: `/workshop-graph/index.html`
- 0628 테스트 전용 화면: `/workshop-graph-0628-test/index.html`
- 기존 포스트잇/Miro형 리소스는 재사용한다.
  - `src/components/BoardAgendaCard.astro`
  - `src/components/BoardZone.astro`
  - `src/pages/[lang]/moderator/board.astro`
  - `public/board-demo.html`

## 권장 당일 경로

1. Google Form을 만든다.
2. 문항을 아래 3개로 둔다.
   - 조
   - 기후시민회의 운영 관련 질문
   - 감축의제 질문
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
- 보기 URL: `/workshop-graph-0628-test/index.html`

0628 테스트 화면은 기본으로 아래 상태를 쓴다.

- `source=participant-open-questions`
- `mode=showcase`
- `count=75`
- `edgeLabels=on`
- `theme=light`

노드는 축약 라벨로 보이고, 호버/탭 메시지 카드는 조/화자와 풀 문장을 보여준다.

## 분석 방식

- 유사성: 같은 문항 안에서 응답 토큰의 Jaccard similarity를 계산한다.
- 센트럴리티: weighted degree centrality를 계산한다.
- 비트윈니스: 응답 유사도 그래프에서 Brandes 방식으로 betweenness centrality를 계산한다.
- 추가로 closeness centrality도 함께 산출해 현장 검토용 순위를 남긴다.

## 입력 파이프 결정

오늘 참여단 테스트는 Google Form/Sheet를 주 경로로 쓴다.

- 이유: DB migration 승인 없이 바로 받을 수 있고, 현장 테스트 실패 위험이 낮다.
- 방식: Form 응답 Sheet를 CSV로 내보내거나 게시 CSV URL을 `--csv-url`로 넣는다.
- Supabase는 같은 데이터 구조로 나중에 승격할 수 있게 계획만 유지한다.

## Google Workspace 실제 리소스

생성된 Google Sheet:

- 파일명: `0628 참여단 주관식 질문 응답 - 운영 감축`
- URL: https://docs.google.com/spreadsheets/d/1hfFGfAhV6BQx0gRXRDIfu_aFvu5jcfJL4AAlYUJwR-M/edit?usp=drivesdk
- 응답 탭: `Form Responses 1`
- 헤더: `타임스탬프`, `조`, `기후시민회의 운영 관련 질문`, `감축의제 질문`, `메모`, `처리상태`

CSV URL 후보:

```text
https://docs.google.com/spreadsheets/d/1hfFGfAhV6BQx0gRXRDIfu_aFvu5jcfJL4AAlYUJwR-M/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201
```

온톨로지 생성 명령:

```powershell
node scripts/build-participant-question-ontology.mjs --csv-url "https://docs.google.com/spreadsheets/d/1hfFGfAhV6BQx0gRXRDIfu_aFvu5jcfJL4AAlYUJwR-M/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201"
```

현재 자동화 한계:

- Google Drive 커넥터로 Sheet 생성과 탭 세팅은 완료했다.
- 현재 커넥터는 Google Forms 생성 MIME을 지원하지 않는다.
- headless 브라우저에서 `forms.new`는 Google 로그인 화면에서 막혔다.
- 따라서 Form 생성과 응답 Sheet 연결은 로그인된 브라우저에서 수동으로 처리한다.

Form 생성 절차:

1. https://forms.new 를 연다.
2. 제목을 `0628 참여단 주관식 질문 - 운영 감축`으로 둔다.
3. 문항을 3개 만든다.
   - `조`: 단답형 또는 드롭다운
   - `기후시민회의 운영 관련 질문`: 장문형
   - `감축의제 질문`: 장문형
4. `응답` 탭에서 Google Sheets 아이콘을 누른다.
5. `기존 스프레드시트 선택`에서 위 Sheet를 연결한다.
6. 연결 후 응답 탭 이름이 `Form Responses 1`인지 확인한다.
7. 현장 테스트 전 샘플 행은 삭제하거나 `처리상태=sample`로 유지한다.

## Supabase 승격 계획

오늘 테스트에서는 DB 스키마를 변경하지 않는다. 실제 운영 저장소가 필요하면 별도 승인 후 migration을 만든다.

최소 테이블 후보:

- `participant_open_question_responses`: raw Form 응답 보존
- `participant_open_question_graph_runs`: 그래프 생성 실행 이력
- `participant_open_question_edges`: 유사도/키워드/문항 연결 엣지

브라우저에 service role key를 노출하지 않고 Edge Function 또는 서버 측 batch만 쓴다.
