# A5 로그인 실패 복구 접근성 검증

- 검증일: 2026-08-26
- 범위: `/platform/` 로그인 실패 UI와 격리 Auth fixture
- 외부 영향: 실제 credential, 외부 Auth, Supabase DB 사용 없음
- 수동 스크린리더: `needs_review` / `not_run` 유지

## 변경 계약

- 제출 직전 form 내부 활성 요소를 저장하고 인증 실패 뒤 포커스를 복귀한다.
- 오류와 안내 live region에 `aria-atomic="true"`를 적용한다.
- 오류 발생 시 이메일·비밀번호 입력 모두 `platform-login-error`를 참조하고 `aria-invalid="true"`를 유지한다.
- 비밀번호 입력은 실패 뒤에도 `type="password"`를 유지한다.

## 실제 브라우저 증거

깨끗한 detached worktree에서 `npm.cmd exec astro -- build`를 완료한 뒤 local preview의 `.invalid` Auth fixture를 Chromium으로 검증했다.

| 항목 | 결과 |
| --- | --- |
| 제출 전 활성 요소 | `platform-password` |
| 실패 후 포커스 복귀 | 통과 |
| 요청 중 입력 잠금 | 통과 |
| 로그인 요청 수 | 1 |
| 중복 요청 차단 | 통과 |
| 실패 후 재시도 활성화 | 통과 |
| 두 입력의 오류 연결과 invalid 상태 | 통과 |
| atomic alert | 통과 |
| 비밀번호 마스킹 유지 | 통과 |
| browser page error | 0 |
| 예상 밖 fixture 요청 | 0 |

## 자동 검증 로그

- 집중 component: `src/islands/platform/PlatformShell.test.ts` 49건 통과
- 집중 browser contract: `automation/tests/verify-platform-design-blueprint.test.mjs` 8건 통과
- Astro check: 337개 파일, 오류 0, 경고 0, 기존 hint 49
- clean Astro build: 7,914 pages, 완료
- 루트 전체: 65개 파일, 1,081건 통과
- automation 전체: 28개 파일, 496건 통과 (`--testTimeout 30000`)
- 참고: 기본 5초 제한 실행은 장시간 임시 Git/CLI fixture 4건이 timeout됐고, 동일 suite를 30초 제한으로 재실행해 전부 기능 통과했다.

## 잔여 검증

이 결과는 DOM·React·Chromium 자동 검증이다. 실제 NVDA, VoiceOver, TalkBack의 발화 순서와 모바일 보조기기 조작은 별도 수동 평가가 필요하다.
