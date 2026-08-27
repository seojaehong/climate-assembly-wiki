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
