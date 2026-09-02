# Ralph 에이전트 지시 (매 이터레이션 1회 실행 — clean context)

너는 자율 코딩 에이전트다. 이번 실행은 **이전 맥락이 없는 새 인스턴스**다. 기억은 git 히스토리 · progress.txt · prd.json 에만 있다.

## 할 일
1. 같은 폴더의 `prd.json`을 읽는다.
2. `progress.txt`를 읽는다 (**상단 `## Codebase Patterns` 먼저**).
3. PRD `branchName` 브랜치인지 확인. 아니면 main에서 체크아웃/생성.
4. `passes: false` 중 **priority 가장 높은(작은 숫자)** user story 하나를 고른다.
5. 그 **단일 story만** 구현한다. (작게·집중·기존 패턴 준수)
6. 품질검사 실행 (프로젝트에 맞게 typecheck/lint/test). **깨진 코드 커밋 금지.**
7. 재사용 패턴을 발견했으면 해당 디렉터리 `AGENTS.md`에 반영(아래).
8. 검사 통과 시 **모든 변경 커밋**: `feat: [Story ID] - [Story Title]`.
9. `prd.json`에서 그 story를 `passes: true`로 변경.
10. `progress.txt`에 진행 내용 **append**.

## progress.txt 형식 (절대 덮어쓰지 말고 append)
```
## [날짜/시각] - [Story ID]
Commit: <git sha 또는 브랜치>
- 무엇을 구현했나
- 변경 파일
- **다음 이터레이션을 위한 학습:**
  - 발견 패턴 (예: "이 코드베이스는 Y에 X를 쓴다")
  - 함정 (예: "W 바꿀 때 Z도 갱신해야 함")
  - 유용 맥락 (예: "평가 패널은 컴포넌트 X에 있음")
---
```
재사용 가능한 일반 패턴은 progress.txt **최상단 `## Codebase Patterns`**에 통합(없으면 생성). story-특정 세부는 넣지 말 것.

## AGENTS.md 갱신
편집한 디렉터리에 미래에 유용한 **재사용 지식**(API 관례·함정·파일 의존·테스트법·환경요건)이 있으면 가까운 `AGENTS.md`에 추가. story-특정 구현 디테일·임시 디버그 노트·이미 progress.txt에 있는 것은 넣지 말 것.

## 품질 요건
- 모든 커밋은 프로젝트 검사(typecheck/lint/test) 통과.
- 변경은 작고 집중되게. 기존 코드 패턴 준수. CI green 유지.

## 브라우저 검증 (프론트엔드 story 필수)
UI를 바꾸는 story는 브라우저에서 동작을 **눈으로 확인**해야 완료다:
1. `claude-in-chrome` 스킬/도구 로드 (또는 프로젝트의 dev-browser 수단).
2. 해당 페이지로 이동.
3. 변경이 의도대로 동작하는지 확인 (필요시 스크린샷을 progress.txt 근거로).
4. 위치/물리/애니메이션 등은 좌표·상태 샘플만으로 판정 말고 **시각 확인**.
프론트 story는 브라우저 검증 통과 전까지 미완.

## 정지 조건
story 하나 완료 후, **모든** story가 `passes: true`인지 확인.
- 전부 통과면 정확히 이렇게 답한다: `<promise>COMPLETE</promise>`
- 아직 `passes: false`가 남았으면 평범하게 응답 종료(다음 이터레이션이 다음 story를 집음).

## 중요
- 이터레이션당 **story 하나**. 자주 커밋. CI green.
- 시작 전 progress.txt의 `## Codebase Patterns`를 먼저 읽는다.


---

# ★ 이 프로젝트 전용 규칙 (반드시 따를 것)

작업 폴더: `C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\wiki`
(Astro 5 + React islands · Cloudflare Pages · Supabase. **이 `wiki/` 자체가 git 저장소다** — 바깥 폴더는 다른 저장소이니 헷갈리지 마라.)

## 절대 금지 — 어기면 실패다
- **`git push` 금지. `main` 머지 금지.** `ralph/submission-resilience-0912` 브랜치에만 커밋한다
  (이 브랜치는 upstream 이 일부러 해제돼 있다. 다시 붙이지 마라)
- **배포 금지.** Cloudflare 는 main push 로 자동 배포된다 — push 자체가 배포다
- **운영 DB 적용 금지.** 이번 PRD 에는 마이그레이션 **파일을 만드는** story 가 있다(US-001·US-007).
  파일 작성은 허용이지만 **적용은 절대 금지** — Supabase MCP·psql·SQL Editor 어느 것으로도 실행하지 마라.
  DDL 은 물론 SELECT 도 운영 DB 로 보내지 마라
- **한글(HWP) COM 자동화 실행 금지.** `pyhwpx`·`win32com` 으로 한글을 띄우면 앱 창·보안 대화상자가 떠서
  루프가 멈춘다. US-013 의 G3(한글이 실제로 여는지)는 **사람이 수동으로** 한다
- **유료 API 호출 금지**
- `git checkout main` 금지 — main 은 다른 worktree 가 점유 중이다
- `../10_작업산출물/2026-08-29_산출물_백업/` 과 `../00_입력자료/` 는 **읽기만** 한다

## 설계 정본 — 새로 설계하지 말고 읽어라
이 PRD 의 근거는 전부 **바깥 저장소**에 있다. 같은 파일시스템이라 상대경로로 읽힌다.
- `../docs/02-design/features/submission-resilience-0912.design.md` — **A·B 설계 정본.**
  확정 결정(A-D1~D5·B-D1~D4)·상태 머신·마이그레이션 초안·검증 목록이 전부 여기 있다. **작업 전에 읽어라**
- `../docs/01-plan/features/submission-resilience-0912.plan.md` — 범위·비스코프·위험
- `../docs/02-design/features/hangul-full-stack.design.md` — 한글 스택(US-012·US-013)
- `../10_작업산출물/2026-08-29_행사후_작업계획.md` — 상위 계획. 이 PRD 밖의 항목은 건드리지 마라

## 이 코드베이스에서 미리 알아야 할 것
- **`/mod` 가 곧 조 화면이다.** 별도 조 라우트는 없고 조는 `/mod?code=082901` 로 들어온다(`ModConsole.tsx:1392`)
- **조의 기본 탭은 `submission`**(`mod-tabs.ts:24-28`). 그래서 마감 배너는 탭 안이 아니라 **탭 바깥 상단**에 둬야 한다
- 꼭지 하나 = `TopicSection` 하나. 상태·저장·최종제출을 각자 갖는다(`SubmissionPanel.tsx:189`)
- `submission_save` 는 **items 전체 교체 = last-write-wins**. 그래서 재전송 전 `updated_at` 대조가 필요하다
- 저장 성공 시 **`dropDraft()` → `loadSubmission()` 순서 고정**. 뒤집으면 서버가 나눈 결과가 화면에 안 온다(2026-08-30 실화면 버그)
- 본부 RPC 권한 패턴 = `attendance_token_row(p_token)` → `scope='hq'` 확인(`20260827_s7_hq_submissions.sql:25`)
- `topic_list` 는 `returns table` 이라 컬럼을 늘리려면 **DROP 후 CREATE** 다. **grant 재부여를 빠뜨리면 조 화면이 전면 장애**가 난다

## 절대 깨면 안 되는 불변식 (회의자료 260811)
`src/islands/mod/AGENTS.md` 「8.29 취합 화면의 불변식」을 먼저 읽어라.
- 조별 결과 임의 통합 금지 · 좋은 의견 선정 금지 · 소수의견 삭제 금지 · **문장 신작 금지**
- 어떤 화면·내보내기에서도 **카드 수가 줄면 안 된다**
- 미제출 조 표기(`hq-submission-board-logic.ts:247`)를 빠뜨리면 안 된다

## 빌드 — 이걸 모르면 막힌다
- **Node 20 포터블이 필수다.** 매 명령 전에 PATH 앞에 붙인다:
  `export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH"`
  Node 24 에서는 `astro build` 가 **아무 출력 없이 죽는다**
- 빌드는 `npm run build`. 훅을 건너뛰려면 `npx astro build && npm run postbuild`
- ★ `npm run build` 의 prebuild 가 `index.md`·`log.md`·`public/workshop-graph/data/*.json` 을 재생성해
  워킹트리를 더럽힌다. **커밋 전에 `git checkout` 으로 되돌려라**
- 테스트 `npx vitest run` · 타입 `npx tsc --noEmit -p tsconfig.json`
- **`package.json` 에 `test` 스크립트가 없다.** `npm test` 를 쓰지 마라

## 테스트 기준선 (2026-08-31 실측, 이 브랜치 시작 시점)
- **90 파일 / 1,516 테스트 전부 통과.** 이보다 줄거나 신규 실패가 생기면 커밋하지 마라
- ★ **`.tsx` 테스트는 vitest include 에 안 잡혀 「조용히 통과한 것처럼」 보인다**(`src/islands/mod/AGENTS.md` 파일 짝 규칙).
  **검증할 판단 로직은 반드시 `.ts` 로 빼라.** `.tsx` 에는 렌더만 둔다

## 검증 규약 — 「테스트 통과」는 검증이 아니다
`scripts/verify-*.mjs` 형식의 드라이런을 쓴다. **실제 파일·실제 데이터로 숫자를 낸다.**
- 좋음: 「단위 164개 · 200자 초과 0개」 / 나쁨: 「정상 동작 확인」
- 먼저 읽어라: `scripts/verify-server-split.mjs` · `scripts/verify-name-reparse.mjs`
- ★ `verify-name-reparse.mjs` 는 규칙을 `.mjs` 로 베껴 적지 않고 **esbuild 로 `.ts` 를 그 자리에서 변환해 import** 한다.
  새 스크립트도 이 방식을 써라. **변환본은 저장소 안 실제 `.mjs` 파일로 쓴 뒤 `pathToFileURL()` 로 import** 하라
  (`data:` URL 은 bare specifier 가 해석되지 않는다)

## 브라우저 검증 — DB 없이 하는 법
UI story(US-003·US-005·US-006·US-010·US-011)는 눈으로 확인해야 완료다.
- 네트워크·DB 없이 화면을 보는 **픽스처 라우트**가 이미 있다:
  `src/pages/[lang]/moderator/insights/submission-lab.astro` (+ `-extreme`), 데이터는 `automation/fixtures/0829-submissions.json`
- `npm run dev` 로 띄우고 `claude-in-chrome` 으로 확인한 뒤, **무엇을 봤는지**를 progress.txt 에 적어라
- 「타입 통과」·「DOM 에 있음」으로 대신하지 마라. 실제로 보이는지가 기준이다
- 확인이 끝나면 dev 서버를 반드시 종료해라

## OneDrive 주의
저장소가 OneDrive 폴더라 **편집이 검사와 커밋 사이에 롤백된 사례**가 있다(US-005 기록).
긴 빌드 전후로 `git diff --stat` 을 확인해라.
