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

## 이 저장소에서의 구체 지침 (climate-assembly wiki)

**먼저 읽을 것** — `../10_작업산출물/2026-08-27_0829_조별입력_3꼭지/취합설계_모이되모으지않는다.md`.
이 PRD 전체가 그 설계안의 L1~L4다. 회의자료 260811이 「조별 결과 임의 통합」·「좋은 의견 선정」·
「소수의견 삭제」·「문장 신작」을 금지하므로, **원문을 고치거나 카드를 없애는 구현은 어떤 story에서도 안 된다.**
불변식은 하나다 — **묶어도 카드 수는 줄지 않는다.**

### 검사 명령
```bash
npx vitest run src/                       # 테스트
export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH" && npx astro build   # 빌드/타입
```
⚠️ `npm run build`는 쓰지 말 것 — prebuild가 Node 20에서 죽는다. **`npx astro build`만** 쓰고,
반드시 Node 20 포터블을 PATH 앞에 붙인다(Node 24는 astro build가 조용히 죽는다).

### 브라우저 검증
`/hq`는 본부 비밀번호 게이트라 자동 검증이 불가능하다. **US-001이 만드는
`/ko/moderator/insights/submission-lab` 미리보기 라우트에서 검증한다.**
```bash
export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH" && npx astro build
nohup python3 -m http.server 4477 --directory dist > /dev/null 2>&1 &
# http://localhost:4477/ko/moderator/insights/submission-lab/
```
끝나면 반드시 서버 프로세스를 kill 한다.

### 🔴 금지 (하나라도 하면 실패로 간주)
- `git push` — 커밋만 한다. 푸시는 사람이 한다
- Supabase에 쓰기·마이그레이션 적용 — 마이그레이션은 **파일 작성까지만**
- Cloudflare 배포, `.env`·키 파일 수정, 비밀번호 입력
- `main` 브랜치에 직접 커밋 — 반드시 PRD의 `branchName`에서 작업
- 기존 테스트를 지우거나 약화시키기
- `submission_item` 등 원문 표를 수정·삭제하는 SQL 작성

### 기존 자산 (새로 만들지 말고 쓸 것)
- `src/islands/mod/hq-submission-board-logic.ts` — 평면 행 → 꼭지·조·포스트잇 접기, 색, 텍스트 내보내기
- `src/islands/mod/HqSubmissionBoard.tsx` — 포스트잇 보드 UI
- `src/lib/hq-submissions.ts` — `HqSubmissionRow` 타입, RPC 호출
- `automation/submission-ontology-bridge.mjs` — 노드 id 규격·보존 검사·공통/차이 판정
- 포스트잇 색은 `noteColor()` 사용(조마다 고정색)
