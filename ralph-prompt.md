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

작업 폴더: `C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\wiki` (Astro 5 + React islands, Cloudflare Pages, Supabase)

## 절대 금지 — 어기면 실패다
- **`git push` 금지. `main` 머지 금지.** `ralph/parser-internalization` 브랜치에만 커밋한다
- **배포 금지.** Cloudflare 는 main push 로 자동 배포된다 — 그래서 push 자체가 배포다
- **운영 DB 쓰기 금지.** 이 PRD 에는 DB 를 건드릴 story 가 없다. 마이그레이션 파일도 만들지 않는다
- **유료 API 호출 금지**
- `10_작업산출물/2026-08-29_산출물_백업/` 의 파일을 **읽기만** 한다. 고치거나 지우지 않는다

## 빌드 — 이걸 모르면 막힌다
- **Node 20 포터블이 필수다.** 매 명령 전에 PATH 앞에 붙인다:
  `export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH"`
  Node 24 에서는 `astro build` 가 **아무 출력 없이 죽는다**
- 빌드는 `npm run build` 로 한다(2026-08-30 에 prebuild 결함을 고쳐 정상 작동한다). 훅을 건너뛰려면 `npx astro build && npm run postbuild`
- 테스트는 `npx vitest run`, 타입은 `npx tsc --noEmit -p tsconfig.json` 또는 `npx astro check`

## 검증 규약 — 「테스트 통과」는 검증이 아니다
이 저장소는 `scripts/verify-*.mjs` 형식의 드라이런을 쓴다. 새 기능은 **실제 파일·실제 데이터로 숫자를 낸다.**
- 좋음: 「단위 164개 · 200자 초과 0개」
- 나쁨: 「정상 동작 확인」
기존 예시를 먼저 읽어라: `scripts/verify-server-split.mjs` · `scripts/verify-name-reparse.mjs`
★ `verify-name-reparse.mjs` 는 규칙을 `.mjs` 로 베껴 적지 않고 **esbuild 로 `.ts` 를 그 자리에서 변환해 import** 한다. 새 스크립트도 이 방식을 써라 — 사본이 갈라지지 않는다.

## 판정 근거 — 새로 조사하지 말 것
`../20_스크립트/parsers/README.md` 에 왜 rhwp/kordoc 인지, 무엇이 함정인지 전부 있다. **작업 전에 읽어라.** 특히:
- rhwp 구조 API 는 **중첩표를 통째로 놓친다**(19,056자 중 절반). 그래서 US-004 의 누락 검사가 있다
- `getTextFileText()` 반환값의 개행은 **진짜 개행이 아니라 역슬래시 이스케이프 2문자**다
- 2차 분해 규칙은 **만들지 않기로 확정**됐다. 되살리지 마라

## 시험용 실제 문서 (읽기 전용)
- `../00_입력자료/기후시민회의_정책권고안_(양식_초안)_20260811203741.hwpx` — 표 4개·셀 70개
- `../00_입력자료/★20260613 기후시민회의 의제숙의워크숍 결과보고서_발화자 추가_A조.hwp` — 중첩표 있음
- docx 는 `../10_작업산출물/` 하위에 여럿 있다
작업 사본이 필요하면 스크래치패드에 두고, **원본을 옮기거나 고치지 마라.**
