# A5 수동 접근성 pass current-tree 결속 검증

## 구현 결과

`platform-accessibility-manual-evidence.mjs`가 수동 평가 `pass`의 기준 commit부터 현재 `HEAD`까지 접근성 표면 변경을 확인하는 기존 검사에 현재 working tree 검사를 추가했다. staged·unstaged·untracked 대상 변경이 하나라도 있으면 과거 `pass` 증거를 stale로 거부한다.

## TDD 경계

- red: 공통 layout의 미커밋 tracked 변경 위에서 과거 `pass` 증거가 성공하는 기존 동작을 재현했다.
- tracked unstaged 변경, 같은 변경의 staged 상태, 접근성 대상 경로의 untracked 새 파일을 각각 거부한다.
- 변경을 원복한 clean checkout에서는 같은 evidence-only commit을 계속 허용한다.
- 기준 commit 이후 committed 공통 layout 변경을 거부하는 기존 경계도 유지한다.
- 검사 결과는 변경 경로·평가자·관찰 메모를 stdout/error에 출력하지 않는다.

## 검증 상태

- focused: `npm.cmd test -- --run tests/platform-accessibility-manual-evidence.test.mjs` — 1개 파일, 13건 통과
- 추적 수동 평가: 14개 케이스·82개 검사 모두 `not_run`, 상태 `needs_review`, `certificationClaimed:false`
- automation 전체: 27개 파일·436건 통과
- 루트 전체: 64개 파일·1,077건 통과
- Astro: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

- 실제 스크린리더·모바일 보조기기 평가는 수행하지 않았다.
- 품질인증 완료나 KWCAG 전수 준수를 주장하지 않는다.
- production DB, Auth, membership, RLS, GRANT, 공개 데이터와 배포 상태를 변경하지 않았다.
