# src/islands/mod — 모더레이터·본부 아일랜드

## 파일 짝 규칙

한 기능은 세 파일로 나뉜다.

| 파일 | 역할 |
|---|---|
| `Xxx.tsx` | React 렌더. DOM·상태·네트워크 |
| `xxx-logic.ts` | 순수 함수. React·DOM·`fetch` 의존 금지 |
| `xxx-logic.test.ts` | vitest |

⚠️ **`vitest.config.ts` 의 include 는 `src/**/*.test.ts` 다 — `.tsx` 는 안 잡힌다.**
`.tsx` 로 테스트를 쓰면 조용히 실행되지 않고 통과한 것처럼 보인다. 검증할 로직은 반드시 `.ts` 로 뺄 것.
환경도 `node` 라 DOM 이 없다(jsdom 미설정).

## 데이터 계약

- 본부 보드의 입력은 `src/lib/hq-submissions.ts` 의 `HqSubmissionRow`(평면 조인 행)다.
  한 줄도 안 쓴 조는 `item_*` 이 전부 null 인 빈 행으로 온다 — 조 자리만 만들고 카드는 만들지 않는다.
- `hq-submission-board-logic.ts` 의 `buildBoards()` 가 「꼭지 → 조 → 포스트잇」으로 접는다.
  카드 id 는 `${topic_id}:${team_id}:${item_ordinal}`. 조 판정은 id 를 파싱하지 말고 `Note.teamId` 를 쓴다.
- 조 이름은 `N분과 M조` 형식이 강제다. `teamSortKey()` 와 `automation/submission-ontology-bridge.mjs`
  둘 다 이 정규식에 걸어 자연 정렬한다 — 공백 하나만 틀려도 정렬이 조용히 뒤로 밀린다.
- 포스트잇 색은 반드시 `noteColor(teamName)` — 조마다 고정색이라 새로고침해도 같은 색이 나온다.

## 네트워크를 타지 않는 미리보기

`/hq` 는 본부 비밀번호 게이트라 자동 검증이 불가능하다. 그래서 `HqSubmissionBoard` 는
`fixtureRows` prop 을 받으면 **fetch·realtime 구독·폴링을 전부 건너뛴다**(useEffect 초입에서 return).
미리보기 라우트는 `/ko/moderator/insights/submission-lab` 이고 픽스처는
`automation/fixtures/0829-submissions.json` 이다. 화면을 바꾸는 작업은 여기서 눈으로 확인한다.

`src/lib/supabase.ts` 의 `getSupabase()` 는 지연 생성이라 **모듈 import 만으로는 네트워크가 안 열린다.**
「네트워크 없이」 요건은 호출을 막는 것으로 충족되며, import 를 피할 필요는 없다.

**조 작성 화면(`SubmissionPanel`)도 같은 관례를 쓴다.** 조 화면은 접속코드 뒤라 실화면으로 열면
`topic_list`·`submission_get` 이 운영 DB 로 나간다. `fixtureTopics` + `fixtureSubmissions`(꼭지 id → 제출물)
를 주면 둘 다 건너뛴다. 라우트는 `/ko/moderator/insights/submission-panel-lab` 이다
(이웃한 `submission-lab` 은 **본부 보드** 미리보기지 조 화면이 아니다 — 헷갈리지 말 것).

- ★ **`TeamDownload` 에도 픽스처를 같이 내려야 한다.** 인쇄 문서는 버튼을 누르기 **전부터** DOM 에
  있어야 해서 마운트 즉시 `submission_get` 을 부른다. 이걸 빠뜨려 화면을 여는 것만으로 운영 DB 에
  읽기 4건이 새어 나간 적이 있다(2026-09-01, US-003)
- ★ 검증 스크립트는 요청을 **세지 말고 막아라** — `context.route('**/rest/v1/**', abort)` 로 끊고
  시도 횟수가 0인지 본다. 세기만 하면 배선 구멍이 곧 운영 DB 접촉이 된다

## 8.29 취합 화면의 불변식

회의자료 260811 이 「조별 결과 임의 통합」·「좋은 의견 선정」·「소수의견 삭제」·「문장 신작」을 금지한다.
그래서 이 디렉터리의 취합 관련 코드는 **원문을 고치거나 카드를 없애지 않는다.**

> 묶어도 카드 수는 줄지 않는다.

정렬·묶기·범주 배정은 전부 **배치만 바꾸는 연산**이어야 하고, 입력 카드 수 == 출력 카드 수를
테스트로 못 박는다. 설계 근거는 `10_작업산출물/2026-08-27_0829_조별입력_3꼭지/취합설계_모이되모으지않는다.md`.

## 유사도 판정 (`note-similarity.ts`)

L1~L2 의 「비슷하다」는 **낱말 단위 자카드**만으로 낸다. 임베딩·네트워크·모델을 쓰지 않는다.

- **문자 n-gram 을 섞지 말 것.** 점수는 올라가지만 겹친 조각(`버스배`)을 사람이 읽을 수 없다.
  이 화면의 요건은 「점수만 있는 불투명한 판정을 만들지 않는다」이므로 겹친 것은 **낱말**이어야 한다.
- 조사는 떼고 나서도 **두 글자가 남을 때만** 뗀다. 안 그러면 「제도」가 「제」, 「결과」가 「결」이 된다.
- 유사도는 `content` 만 본다. `rationale` 은 별개 문장이라 이어붙이면 시민이 쓴 두 문장이 뭉개진다
  (`automation/submission-ontology-bridge.mjs` 도 근거를 별도 노드로 둔다).
- ⚠️ 꼭지1 은 「우리는 ○○을 확인하였다」 형식이 프롬프트로 강제된다
  (`supabase/migrations/20260827_s6_open_0829_topics.sql`). 그래서 `우리`·`것을`·`확인하였다` 가
  거의 모든 카드에 겹친다. 불용어 목록과 임계값은 **함께** 정해야 한다 — 한쪽만 바꾸면 점수 분포가 통째로 밀린다.
- ★ **문서빈도(DF) 필터를 넣지 말 것 — 이미 검토하고 버린 길이다.** 보일러플레이트를 걸러 내면
  가짜 짝만 죽는 게 아니라 **진짜 짝도 같이 죽는다**(버스 배차 0.462 → 약 0.30, 임계값 0.34 아래).
  L2 는 「AI 제안 — 확정은 사람이 합니다」이고 짝마다 `sharedTerms` 가 붙으므로,
  **가짜를 몇 개 남기고 사람이 거르는 쪽**이 진짜를 조용히 죽이는 쪽보다 안전하다.
  꼭 도입하려면 임계값을 같이 내려야 하며, 그때 `★ 경계 — 「버스 배차」 짝` 테스트가 깨진다(그러라고 둔 것이다).
- 짝(`SimilarPair`)은 **id 만** 들고 있다 — 원문·조 이름은 화면이 `Note` 를 id 로 찾아 쓴다.
  로직이 표시용 문자열을 들고 다니면 원문이 두 군데 살게 되고, 그 순간 「원문 수정 금지」가 지켜지는지 알 수 없어진다.
- 같은 조 안의 두 카드는 짝으로 내지 않는다. 한 조가 **일부러 나눠 적은** 문장을 도구가 도로 합치라고 권하는 꼴이다.
  판정은 `note.teamId` 비교면 되고 카드 id(`꼭지:조:순번`)를 파싱할 필요가 없다.

## 카드에 얹는 표시 (`pair-marks.ts`)

카드에 무언가를 **붙이는** 상태(L2 닮은 짝 체크, 앞으로 L3 범주·L4 대표)는
`Xxx.tsx` 안의 `useState` 로 끝내지 말고 **순수 `.ts` 모듈로 뺄 것.** `.tsx` 테스트는
vitest 가 안 잡으므로 UI 에 두면 검증이 통째로 사라진다.

- 상태 모양은 **카드 id → 값** 맵으로 두고 `Postit` 에 prop 으로 넘긴다.
  `Postit` 은 이미 `marks?: number[]` 를 받으니 범주·대표 표시도 같은 자리에 얹으면 된다.
- 카드 id 는 `${topic_id}:${team_id}:${item_ordinal}` 이라 **꼭지가 이미 들어 있다** —
  꼭지 탭을 넘나들어도 Set/Map 하나로 충돌 없이 관리된다. 꼭지별로 쪼갤 필요가 없다.
- 토글은 **새 Set/Map 을 돌려준다.** 제자리 수정은 React 리렌더가 안 걸린다.
- ★ **번호·순서는 「누른 순서」가 아니라 「목록에서의 자리」로 매긴다.** 누른 순서로 매기면
  하나를 되돌릴 때 뒤 번호가 밀려 화면의 「짝 3」이 가리키는 대상이 조작 중에 바뀐다.
  자리로 매기면 패널의 번호와 카드의 번호표가 항상 같은 것을 가리킨다.
- 표시를 붙여도 **카드는 사라지지도 합쳐지지도 않는다.** 「표시 대상 카드 수 보존」을 테스트로 못 박을 것.

## 4범주 배정 (`four-category.ts`)

L3 의 「공통·차이·갈등·질문」은 **카드 id → 범주 맵**이다. 범주마다 카드 배열을 두고 옮기는
자료구조를 쓰지 말 것 — 옮기다 카드가 빠지거나 두 범주에 겹칠 수 있고, 그때 보존 검사는
사후 탐지밖에 못 한다. 맵으로 두면 한 카드의 범주가 늘 0개나 1개이고 **배정 함수가 카드 목록을
인자로 받지도 않는다.** 「삭제 0장」이 검사가 아니라 자료구조로 지켜진다.

- ★ **저장값은 `common`·`difference`·`conflict`·`question` 네 문자열이다.** 한국어는
  `FOUR_CATEGORY_LABELS` 에만 있다. DB(`supabase/migrations/`)의 `check` 제약도 이 값을 쓴다 —
  두 곳이 어긋나면 배정이 조용히 저장 안 된다.
- 배열 순서 = 설계문서 순서(공통·차이·갈등·질문). 화면이 이 배열로 버튼을 그리므로 순서를 바꾸면 버튼 자리가 바뀐다.
- `preservationInvariant()` 는 **목록 밖 카드 id 를 무시한다.** 배정 맵 하나가 꼭지 3개를 함께 담으므로
  (카드 id 에 꼭지가 들어 있다) 무시하지 않으면 다른 꼭지의 배정이 「사라진 카드」로 오탐된다.
- `categoryOfCluster()` 는 **판단이 아니라 세기다** — 조가 2개 이상이면 공통, 1개면 차이.
  같은 조가 나눠 쓴 두 문장은 카드 2장이어도 조는 하나라 **차이**다. 갈등·질문은 세어서 나오지 않는다.
- ⚠️ 이 세기 결과로 **자동 배정을 하지 말 것.** 자동으로 채우면 사람이 확인 없이 넘긴다.
  화면에서는 힌트로만 쓰고 배정 버튼은 사람이 누른다(설계문서 §4 「총괄모더레이터 확정, 시민 검토 전제」).

## L3 배정 화면 (`FourCategoryPanel.tsx`)

`four-category.ts` 의 순수 로직에 얹는 **화면 조각 네 개**가 한 파일에 있다.
`HqSubmissionBoard.tsx` 는 이 파일에서 넷을 가져다 쓰기만 한다.

- **조작 지점은 포스트잇 한 곳뿐이다.** `CategoryButtons` 는 카드에만 붙고 `FourCategoryPanel` 은
  보기 전용이다. 같은 배정 조작을 두 곳에 두면 어느 쪽을 눌렀는지에 따라 사람이 방금 한 일을 놓친다.
- **드래그는 쓰지 않는다.** 끌어다 놓는 조작은 실수로 카드를 엉뚱한 데 떨어뜨리고, 그 실수가 곧
  「임의 통합」이 된다. 검증에 `[draggable="true"]` 가 0개인지 확인하는 항목이 있다.
- **보존 카운터·주의 문구는 접히지 않는다.** 「모으지 않았다」의 증명이라 조작 중 어느 순간에도
  가려지면 안 된다. 패널을 접어도 미배정 수는 따로 남는다.
- **미배정 칸(다섯째 칸)을 지우지 말 것.** 네 범주만 보이면 어디에도 안 들어간 카드가 화면에서
  사라지고 그게 곧 「소수의견 삭제」다.
- 「잠정」은 **배지 글자 안에** 있다(`잠정 · 공통`). 화면 어디를 잘라 캡처해도 확정으로 읽히지 않게 하기 위해서다.
- 카운터는 **검색어와 무관한 `boardNotes`(꼭지·분과 전체)** 로 센다. 검색 결과로 세면 「원문 N장」이
  타이핑에 따라 흔들려 카드가 사라진 것처럼 읽힌다.

## 대표 문장 지목 (`representative-pick.ts`)

L4 는 설계문서가 **「시민이 고른다」**로 못 박은 유일한 단계다(§4 L4 행). 같은 문서는
「L4는 도구에 버튼을 만들지 않는다」고 했고, PRD 는 아래 장치를 조건으로 화면을 허용했다.

- ★ **모더레이터 단독 지정은 예외로 튕긴다.** `kind: 'moderator'` 는 `citizenConfirmed: true`
  없이는 성립하지 않는다. 화면이 「시민이 고른 것입니다」 확인을 건너뛰면 지목 자체가 안 된다.
  이 검사를 화면 쪽 `if` 로 옮기지 말 것 — 로직에 있어야 테스트가 잡는다(`.tsx` 는 vitest 가 안 잡는다).
- ★ **API 는 카드 id 만 받는다.** 문장을 넣을 인자가 없으니 「새 문장을 대표로」가 불가능하다.
  `four-category.ts` 의 「지울 대상이 없으니 지울 수 없다」와 같은 수법이고, 화면도 대표 후보에
  입력칸을 만들면 안 된다.
- ★ **「현재 대표」를 따로 저장하지 않는다.** `representativeOf()` 가 append-only `history` 의
  마지막 사건에서 파생한다. 저장소를 둘 두면 어긋나고, 어긋난 순간 화면이 조용히 거짓을 보여준다.
  이 「마지막 사건이 이긴다」는 US-007 읽기 RPC(`order by ... e.id desc`)와 같은 규칙이라
  나중에 서버에 붙여도 해석이 하나다.
- **시각은 인자로 받는다**(`actor.at`). 모듈이 시계를 읽지 않아야 같은 입력이면 같은 출력이다.
  네 인자 모양(`state, groupId, noteId, actor`)을 지키려고 다섯째 인자 대신 actor 안에 넣었다.
- 묶음의 카드 목록(`groups`)은 지목이 **절대 바꾸지 않는다**(같은 참조를 그대로 넘긴다).
  대표가 나머지를 대체하지 않으므로 화면도 나머지 카드를 계속 보여줘야 한다.

## L4 지목 화면 (`RepresentativePanel.tsx` · `representative-groups.ts`)

- **묶음의 출처는 「사람이 ✓ 한 닮은 짝」 하나뿐이다.** 묶음 하나 = 짝 하나 = 카드 **두 장**.
  ★ **짝을 합쳐 큰 묶음을 만들지 말 것** — 한 카드가 여러 짝에 드는 일이 실제로 있고, 그것들을
  이어 붙이는 순간 그게 「조별 결과 임의 통합」이다.
- 묶음 번호는 `similarPairs()` 목록에서의 **자리**다(`marksByNote` 와 같은 규칙). 누른 순서로 매기면
  하나를 풀 때 나머지가 밀려 「짝 3」이 가리키는 대상이 조작 중에 바뀐다.
- ★ **actor 는 `kind: 'moderator'` 고정이고 확인란이 `citizenConfirmed` 로 간다.** 조작하는 사람은
  실제로 모더레이터라 이력이 정직해지고(화면에 「모더레이터 대리 기록」이 뜬다), 체크 없이 누르면
  `moderator-alone` 이 **실제로 발생해** 화면에서 이유를 보여줄 수 있다.
  `kind: 'citizen'` 으로 매핑하면 로직이 무조건 true 로 통과시켜 **확인란이 장식이 된다** — 바꾸지 말 것.
- **확인 버튼을 disabled 로 막지 말 것.** 눌러서 튕기고 이유를 읽는 것이 이 화면의 요점이다.
  안내 문구는 `pickFailureGuidance(reason)` 에 있다(`.ts` 라 테스트가 잡는다).
- **상태는 `history` 만 `useState`.** 묶음은 `pairs`+`checkedPairs` 에서, 현재 대표는 history 에서
  매번 파생한다 — 동기화 `useEffect` 가 없고 맞아야 하는 저장소가 하나뿐이다.
- 알려진 동작: 짝 체크를 풀었다 다시 켜면 **이전 지목이 되살아난다**(이력이 append-only 이므로).
  체크 해제는 「지목 취소」가 아니라 「그 묶음을 화면에서 내림」이다.

## 온톨로지 스냅샷 (`ontology-snapshot.ts`)

취합 보드를 이미 있는 온톨로지 검수 큐(`/ko/moderator/ontology-review`)가 먹는 모양으로 바꾸는
**입구**다. 온톨로지 로직을 새로 만들지 않는다. `automation/submission-ontology-bridge.mjs` 의
규칙을 옮긴 것이고, 화면에서 돌아야 하므로 **`node:crypto`·`node:fs` 같은 노드 전용 모듈을 안 쓴다.**

- ★ **거르지 않은 `TopicBoard` 를 넘길 것.** 조 순번(`t01`)은 `board.teams` 에서의 **자리**로 매긴다.
  `filterBoardBySubgroup()` 으로 거른 보드를 넘기면 같은 카드가 다른 순번을 받아 다른 분과의
  스냅샷과 id 가 충돌한다. 분과 필터가 걸린 화면에서도 내보내기는 전체 보드를 쓴다.
- ★ **「빈 값」은 `null` 이다. 빈 문자열이 아니다.** `canvas-ontology-bridge.mjs` 의 `optionalString()`
  이 non-null 값을 `nonemptyString()` 으로 넘겨 **`''` 면 예외를 던진다**(`group_id`·`parent_id` 둘 다).
  링크 행에는 `relation` 키를 **아예 두지 않는다** — 브리지가 후보 9종을 달아 주고, 「이건 근거다」라고
  단정하는 것도 판단이라 사람이 한다.
- `group_id` 를 채우지 않는 것이 이 파일의 요점이다. AI 가 미리 묶어 보내면 그 묶음이 기정사실이 된다.
- 근거는 본문에 이어붙이지 않고 **`/r` 행 + `agenda_link`** 로 낸다. 이어붙이면 시민이 쓴 두 문장이 뭉개진다.
- **`takenAt` 은 인자다** — 모듈이 시계를 읽지 않아야 같은 입력이면 같은 출력이다(`representative-pick.ts` 와 같은 규칙).
- 카드가 한 장도 없으면 **던진다.** 화면은 버튼을 비활성화해서 여기 도달하지 않게 하는 것이 맞다.
- ★ **원본 `.mjs` 와의 대조 테스트가 있다**(`ontology-snapshot.test.ts` 마지막 describe).
  둘 중 하나만 고치면 깨진다 — 그러라고 둔 것이다. `.mjs` 는 지우지 말 것(id 규격의 기준 문서다).
- ⚠️ **`.mjs` 를 `.ts` 테스트에서 import 하면 기본값 없는 구조분해 인자(`takenAt`)가 타입 추론에 안 잡혀**
  `astro check` 가 ts(2353) 으로 죽는다. 원본을 건드리지 말고 테스트 안에서 `as unknown as (...) => ...`
  로 모양만 붙인다.

## 온톨로지 내보내기 (`ontology-export.ts` · `OntologyExportPanel.tsx`)

취합 화면에서 검수 큐로 넘길 **스냅샷 JSON** 을 내려받는 자리다.

- ★ **내보내기는 분과 필터를 따르지 않는다.** `wholeBoard` 를 넘긴다 — 거른 보드는 조 순번이 밀려
  노드 id 가 다른 분과의 스냅샷과 충돌한다. 그래서 필터가 걸리면 화면에 카운터가 둘 뜨고 수가
  다르다(L3 「원문 9장」 vs 내보내기 「원문 27장」). 버그로 읽히므로 `ontology-export-scope` 한 줄로 알린다.
- `ontology-export.ts` 의 함수는 **보드 하나만** 받는다(카드 목록 인자 없음). 화면이 거른 목록을
  실수로 끼워 넣을 자리를 없앤 것이다 — 이 규칙을 깨지 말 것.
- 카운터는 스냅샷을 **밖으로 내주지 않고 개수만** 돌려준다(`ontologyExportPreservation`, 고정 시각).
  내려받을 스냅샷은 **누른 순간** `new Date().toISOString()` 으로 다시 만든다(순수 모듈은 시계를 안 읽는다).
- **내려받는 것은 스냅샷이지 봉인된 검수 플랜이 아니다** — 봉인(SHA-256)은 `node:crypto` 라 브라우저에서
  못 한다. 검수 큐는 **플랜 + 원 스냅샷 두 파일**을 요구하므로 화면에 다음 명령을 적어 둔다
  (`ONTOLOGY_EXPORT_NEXT_STEP`): `node automation/canvas-ontology-bridge.mjs --snapshot <파일> --output-plan <플랜>`.
- ⚠️ **화면에 명령·경로를 `<code>` 로 낼 때는 `block overflow-x-auto whitespace-nowrap`.** 그냥 두면
  하이픈에서 접혀 `--snapshot` 이 `- -snapshot` 으로 읽히고, 복사한 사람이 틀린 명령을 친다.
  DOM 검사 26건이 다 통과한 채 스크린샷으로만 잡힌 문제다.
- 「카드 0장 → 버튼 비활성」은 픽스처 미리보기로 **도달할 수 없다**(15조가 다 썼다). 단위 테스트로 덮는다.
- 브라우저에서 파일 받기 — `newPage({ acceptDownloads: true })` +
  `Promise.all([page.waitForEvent('download'), click()])` → `dl.saveAs(경로)`.
  훅: `ontology-export-panel` · `ontology-export-button` · `ontology-export-counter` ·
  `ontology-export-reason` · `ontology-export-alert` · `ontology-export-scope`.

## 온톨로지 종류 붙이기 (`ontology-kind.ts` · `OntologyKindPanel.tsx`)

「온톨로지」는 **관점(lens)** 이다 — 카드를 종류별 칸으로 옮기지 않고 카드 위에 이름표 한 겹을
겹쳐 보인다. 관점을 끄면 화면이 원래대로 돌아온다. 종류별 칸으로 옮기는 화면을 만들지 말 것:
옮기는 순간 「이 카드는 근거일 뿐」이라는 서열이 생기고, 그게 곧 「좋은 의견 선정」이다.

- ★ **종류 7종의 이름·개수·순서는 `automation/canvas-ontology-bridge.mjs` 의
  `CANVAS_ONTOLOGY_NODE_KINDS` 와 같아야 한다.** `ontology-kind.test.ts` 가 원본 배열과 직접
  대조한다 — 한쪽만 고치면 깨진다. 화면과 검수 큐가 다른 어휘를 쓰면 사람이 같은 카드를 두 번,
  서로 다른 말로 판정하게 된다. 한국어는 `ONTOLOGY_KIND_LABELS` 에만 있다(저장값은 ASCII).
- ★ **`.mjs` 의 상수 배열은 `.ts` 테스트에서 그냥 import 해도 된다.** US-011 이 겪은 ts(2353) 은
  **기본값 없는 구조분해 인자를 가진 함수** 전용 문제라 `as unknown as` 가 필요 없다.
  이 브리지는 CLI 실행이 `import.meta.url === process.argv[1]` 로 막혀 있어 import 만으로는 안 돈다.
- **처음에는 전부 미지정이다.** AI 가 미리 채우면 사람은 확인 없이 넘기고, 그 순간 종류를 붙인 것은
  사람이 아니라 도구가 된다. 검수 큐도 노드마다 `kind: null` + 후보 7종으로 시작한다 — 같은 규칙이다.
- **붙인 종류는 내보내는 스냅샷에 넣지 말 것.** 넣으면 `ontology-snapshot.test.ts` 의 원본 브리지
  대조가 깨지고, 사람이 검수 큐에서 다시 고르는 단계를 도구가 앞질러 버린다. 화면에 그 사실을 적어 둔다.
- 관점 전환 버튼은 **`!grouped` 블록이 아니라 항상 보이는 도구 줄**에 둔다. 정렬 버튼들은 모아보기
  전용이라 그 안에 두면 조별 뷰에서 사라지는데, 두 보기 모두 `Postit` 을 그린다.
  `Postit` 호출부는 **두 곳**이다 — 한 곳만 배선하면 조별 뷰에 조용히 버튼이 안 붙는다.
- 「미지정 N장」은 `boardNotes`(꼭지·분과 전체, 검색 무관)로 센다. 내보내기 카운터는 `wholeBoard` 라
  분과를 고르면 두 수가 갈라진다 — **정상이다**(사람이 손으로 붙이는 이름표라 안 보이는 카드까지
  세면 끝나지 않는 숙제가 된다).
- 종류별 수는 일곱이 **항상 다 나온다**(0장도 자리를 지킨다) — 빈 종류가 사라지면 「그 종류는 안 봐도
  된다」로 읽힌다. `FourCategoryPanel` 의 미배정 칸과 같은 이유다.
- 낱말만 쓰면 「조건」과 「우려」가 헷갈린다. 뜻 한 줄(`ONTOLOGY_KIND_HINTS`)을 `title` 로 붙일 것 —
  **뜻이 없으면 사람은 첫 번째 버튼을 누른다.**

## 초안 보관 (`submission-draft-store.ts`)

조가 저장을 안 누른 글의 보관소다. **`localStorage`/`sessionStorage` 를 직접 부르지 말고
`createDraftStorage()` 를 거칠 것.**

- 계층은 **local → session → 메모리**다. 쓰기는 던지는 계층을 건너뛰며 내려가고,
  ★ **읽기는 세 계층을 순서대로 훑어 처음 찾은 값을 쓴다.** 이 배포 전에 `sessionStorage` 에만
  있던 초안이 그대로 살아나는 것도, 계층이 중간에 강등돼도 값이 안 사라지는 것도 이 순서 덕이다
- ★ **사본은 언제나 하나만 산다.** 지우기는 전 계층에서 지우고, **쓰기도 안착한 계층 말고는 전부 지운다.**
  `setItem` 은 용량 초과 시 **원자적으로 실패**해 옛 값이 위 계층에 그대로 남는데, 읽기가 위에서부터
  훑으므로 안 지우면 **방금 쓴 새 초안이 옛 초안에 가린다**(강등·승격 양쪽 다)
- 예외를 절대 밖으로 던지지 않는다. `QuotaExceededError` 뿐 아니라 **전역 접근 자체가 던지는**
  브라우저(사생활 보호·기업 정책)가 있어 `globalThis.localStorage` 참조를 try 안에 둔다.
  vitest 는 `environment: 'node'` 라 그 전역이 그냥 `undefined` 다 — undefined 와 throw 를 같게 다룰 것
- 보관 형태는 봉투(`DraftEnvelope { v, rows, savedAtMs, baseUpdatedAt }`)다. **옛 모양(EditorRow 배열)도
  읽어 `savedAtMs:0` 으로 승격**하며, 0 은 **만료로 보지 않는다**(시각을 몰라서 글을 버리지 않는다)
- 행 위생 처리(`name` 메우기, 한 줄이라도 틀리면 전체 폐기)는 `readDraft` 안에 있다.
  `pickRestoredRows` 가 이걸 그대로 물려받으므로 **두 곳에 복제하지 말 것**
- 배선은 `SubmissionPanel.tsx` 에 있고 **보관함 인스턴스는 모듈에 하나뿐**이다(`draftStore`).
  구역(TopicSection)마다 만들면 메모리 계층이 갈리고 승격 경로가 구역별로 따로 돈다.
  만료 초안 청소(`staleKeys`)는 **패널 루트**에서 한 번만 한다 — TopicSection 은 탭을 옮길 때마다 다시 뜬다
- 초안을 쓸 때 `loaded.updatedAt` 을 `baseUpdatedAt` 으로 함께 넣는다. 재전송 큐가 이 값으로
  「내가 읽은 뒤에 남이 저장했는가」를 판정한다
- `staleKeys()` 는 `climate_vote_draft:` 접두사 + **만료분만** 낸다. 깨진 값·승격분은 안 낸다
  (지우면 조가 쓰던 글을 대신 버리는 셈이고, `climate_vote_queue:` 키까지 쓸어 가면 안 된다)

## 재전송 큐 (`submission-queue.ts`)

저장이 실패한 건을 얹어 두고 연결이 돌아오면 다시 보내는 자료구조다. **순수 함수만** —
저장소도 네트워크도 여기 없다(배선은 `SubmissionPanel.tsx`).

- 키는 `climate_vote_queue:${code}:${topicId}` = **꼭지당 1건.** 새 실패는 옛 것을 덮어쓴다.
  쌓아 두면 전송 순서 문제가 생기고, 어차피 최신 것이 조의 의도다
- ★ `nextBackoffMs(attempts)` 의 `attempts` 는 **1부터** 센다. 첫 실패 = 1 = 5초 뒤.
  `5s·15s·45s·120s·300s` 이고 그 뒤로는 300초로 **무한 재시도**한다(조가 화면을 열어 둔 동안).
  0·음수·NaN 은 첫 계단으로 접는다 — 배선이 잘못 세도 무한 대기가 생기지 않게
- 오프라인이면 `shouldAttempt` 가 false 다. **보내 보지도 않는다** — 실패 횟수를 태우면
  연결이 돌아온 뒤의 백오프가 쓸데없이 길어진다. 예정 시각과 **같은 순간은 시도**한다(경계 포함)
- ★ `conflictVerdict(serverUpdatedAt, baseUpdatedAt)` 는 `undefined` 와 `null` 을 같게 본다.
  `submission_get` 은 제출물이 없으면 `updated_at` 을 아예 안 실어 보내므로, 이걸 구별하면
  **오프라인에서 처음 쓴 조가 연결되자마자 conflict 로 막힌다**
- ★ `readQueue` 는 **한 항목이라도 모양이 틀리면 통째로 null** 이다. 전송은 items 전체 교체라
  반쪽 큐가 나가면 서버에 있던 항목이 사라진다. 반면 큐를 버려도 **글은 초안 봉투에 그대로
  남아** 화면에 복원된다 — 「살려 보내기」보다 「버리기」가 언제나 안전하다. 되돌리지 말 것
- `baseUpdatedAt` 은 큐에서 다시 계산하지 말고 [초안 봉투](#초안-보관-submission-draft-storets)에
  실려 온 값을 그대로 옮긴다

### 배선 쪽 (`SubmissionPanel.tsx` · US-005)

- ★★ **PostgREST 오류는 `Error` 인스턴스가 아니다.** supabase-js 는 `throwOnError` 를 켜지 않으면
  응답 본문(평범한 객체 `{code, message, details, hint}`)을 그대로 `{ error }` 로 돌려주고,
  `deliberation.ts` 의 래퍼가 그걸 그대로 throw 한다. `error instanceof Error ? error.message : ''`
  로 분기하면 서버 문구를 **영영 못 읽는다** — 실제로 화면의 finalized·not open 가지가 죽은
  코드였다(2026-09-01 발견). 메시지는 `saveFailureKind()` 로 꺼낼 것. 진짜 `Error` 가 오는 경우는
  **연결 자체가 끊겼을 때**(TypeError: Failed to fetch)뿐이다
- 큐에 넣을 실패는 `saveFailureKind(error) === 'network'` 뿐이다. `finalized`·`closed` 를 넣으면
  300초마다 영원히 두드린다. **재전송이 실패했을 때도 같은 판정을 해서** 그사이 잠긴 꼭지의
  큐를 놓아 준다
- ★ 재전송이 성공해도 **화면이 큐보다 새것이면 초안을 버리지 않는다**(`sameSavePayload`).
  오프라인 동안 조가 계속 쓰고 있었으면 초안이 큐보다 새 글이고, 버리면 화면·저장소 양쪽에서
  사라진다. 같을 때만 `dropDraft()` → 아니면 큐만 놓고 `loadSubmission()`
- 워커를 깨우는 것은 셋이다: 백오프 타이머 · `online` 이벤트 · 「지금 다시 시도」 버튼.
  **뒤의 둘은 백오프를 건너뛴다**(새 정보가 생긴 순간이라 더 기다릴 이유가 없다)
- 재전송 자물쇠는 불리언이 아니라 **시각**이다(`ATTEMPT_LOCK_MS` 60초). 요청이 영영 안 끝나는
  망에서 불리언 자물쇠는 박힌 채 남아 큐를 영구히 멈춘다
- 워커 이펙트는 `rows` 에 의존하면 안 된다 — 한 글자마다 백오프 타이머가 처음부터 다시 걸린다.
  「지금 화면」이 필요하면 `rowsRef` 로 읽는다

## 저장 상태 배지 (`draftStatusLabel` · US-006)

「지금 내 글이 안전한가」를 꼭지 머리에 상시로 낸다. 판단은 `submission-panel-logic.ts` 의
순수 함수, `SubmissionPanel.tsx` 는 색과 자리만 고른다.

- **상태 여섯 가지**는 전부 `TopicSection` 이 **이미 들고 있는 값**에서 나온다
  (`saving`·`conflict`·`queued`·`dirty`·`loadFailed`·`savedAt`). 배지 전용 상태를 새로 만들면
  두 축이 어긋나 「저장됐다는데 저장 버튼이 살아 있는」 화면이 나온다
- **우선순위 = saving > conflict > queued > loadFailed > unsaved > saved.**
  재전송·덮어쓰기는 `queued`·`conflict` 를 켠 채로 날아가므로 겹침이 일상이다.
  겹침 쌍은 테스트로 박아 뒀다 — 순서를 바꾸려면 그 테스트부터 고칠 것
- ★ **배지는 본문의 대기·충돌 안내 블록을 대신하지 않는다.** 배지는 「지금 안전한가」,
  그 블록은 「무엇을 골라야 하는가」다. 충돌 선택지 두 개는 배지에 못 들어간다
- 시각 표기는 `formatSavedClock` **하나**로 모았다(`14:23` 꼴). `SubmissionPanel` 의
  `formatClock` 도 여기에 위임한다 — 같은 사실을 배지는 `14:23`, 아래 줄은 `오후 2:23` 으로
  내면 조가 서로 다른 시각으로 읽는다. `toLocaleTimeString` 은 환경마다 갈리므로 쓰지 않는다
- 「n분째」의 시작 시각(`dirtySinceMs`)은 **미저장이 이어지는 동안 고정**이다. 한 글자마다
  갱신하면 「몇 분째 저장 안 했는지」라는 정보 자체가 없어진다. 30초 간격 `setInterval` 로
  다시 그리고, 미저장이 풀리면 타이머를 접는다
- 검증: `node scripts/verify-save-status-badge.mjs`(dev 서버 필요). 배지의 `data-save-status`
  속성으로 상태를 집는다 — 문구가 바뀌어도 스크립트가 안 깨진다

## UI 검증 시 셀렉터 함정

포스트잇이 `<article>` 이다. **새 패널이 카드 발췌를 `<article>` 로 내면 「카드 N장」 검사가
조용히 부풀어 통과한다.** 그래서 짝 패널의 발췌는 `<div>`·`<li>` 로 냈다.

- 모아보기 그리드는 `[data-testid="note-grid"]`, 카드는 `data-note-id` 를 갖는다.
  카드 수·다중집합 비교는 **`[data-testid="note-grid"] article` + `data-note-id`** 로 할 것
  (텍스트로 비교하면 같은 문장을 낸 다른 조의 카드가 구분되지 않는다).
- L3 훅 — `preservation-counter`(innerText 정규식으로 네 숫자를 한 번에 뽑는다),
  `category-column`(`data-category`; 미배정 칸은 `unassigned`), `category-member`(`data-note-id`),
  `category-badge`, `category-buttons`. 패널 발췌는 `<li>` 라 카드 카운트를 오염시키지 않는다.
- L4 훅 — `representative-panel` · `representative-toggle` · `representative-group`(`data-group-id`,
  `data-picked`) · `representative-candidate`(`data-note-id`, `data-representative`) ·
  `representative-pick-button` · `representative-dialog` · `representative-actor-label` ·
  `representative-citizen-confirm` · `representative-confirm` · `representative-error` ·
  `representative-history` · `representative-badge` · `representative-picked-count` · `representative-empty`.
  포스트잇에도 `data-representative="true|false"` 가 있다.
- ★ **스크린샷·색 판정은 클릭 직후에 하지 말 것 — 150ms CSS transition 이 그대로 찍힌다.**
  US-013 에서 활성 버튼이 짙은 초록이 아니라 흐린 올리브로 찍혔고 `getComputedStyle` 도 중간값
  (`rgba(207,218,215,.77)`)을 돌려줘 「인라인 스타일이 안 먹었다」로 오진했다. Tailwind `transition`
  은 duration 0.15s 다. **스크린샷 전에 `waitForTimeout(400)`.** DOM 검사(48/48)는 다 통과한 상태였다.
- US-013 훅 — `ontology-view-toggle` · `ontology-kind-counter` · `ontology-unspecified-count` ·
  `ontology-kind-deleted` · `ontology-kind-tally`(`data-kind`) · `ontology-kind-buttons` ·
  `ontology-kind-badge`. 포스트잇에 `data-kind`(미지정이면 `""`) — `article[data-kind]:not([data-kind=""])`
  로 「종류가 붙은 카드」를 센다.
- ★ **조별 뷰로 갔다 오면 모아보기 쪽 패널이 통째로 언마운트된다.** `SimilarPairsPanel` ·
  `RepresentativePanel` 은 `!grouped` 브랜치 안이라 접힘 상태(`open`)가 초기값으로 돌아간다.
  체크·범주·지목 이력은 보드 상태라 그대로다 — **뷰·꼭지를 오간 뒤에는 패널을 다시 펼치고 판정할 것**
  (`automation/.artifacts/verify-us010.mjs` 의 `ensureOpen()`).
- ★ 조 화면(`submission-panel-lab`)에서 `section` 을 세면 **15개**가 잡힌다 — 첫 구역은 「작성 안내」,
  뒤에는 내려받기·본부 미리보기·Astro 개발 툴바까지 섞인다. 꼭지 구역은
  `page.locator('section').filter({ has: page.locator('textarea') })` 로 고른다(2026-09-01 실측)
- 유사도 관련 화면은 **꼭지1 에서** 검증한다. 꼭지2·3 은 완전 동일 문장(1.00) 짝뿐이라
  패널이 실제로 도는지 판정이 안 된다. 꼭지1 에만 0.36~0.46 짜리 부분 유사 짝이 있다.

## ⚠️ 이 저장소는 OneDrive 폴더다

편집이 **검사와 커밋 사이에 되돌아간 사례가 있다**(US-005 에서 `HqSubmissionBoard.tsx` 가
빌드·브라우저 검증 통과 후 HEAD 상태로 롤백). untracked 새 파일은 되돌아가지 않는다.
긴 작업(빌드 150초·playwright) 전후로 `git diff --stat` 에 고친 파일이 남아 있는지 확인하고,
검사 통과 직후 바로 커밋할 것.
