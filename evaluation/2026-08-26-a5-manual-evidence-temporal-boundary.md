# A5 수동 접근성 증거 시간축 검증

## 구현 결과

수동 평가 evidence가 ISO 형식뿐 아니라 실제 사건 순서도 만족해야 한다. 템플릿 생성시각은 검증 시점보다 미래일 수 없고, 실행한 case의 평가시각은 템플릿 생성 이후이면서 검증 시점 이하여야 한다.

## TDD 경계

- red: `generatedAt`을 먼 미래로 바꾼 untouched evidence가 기존 검증을 통과하는 동작을 재현했다.
- `testedAt < generatedAt`인 실행 기록을 거부한다.
- `testedAt > verifier clock`인 미래 실행 기록을 거부한다.
- 오류에는 평가자·관찰 메모·대상 경로를 포함하지 않는다.
- 정상 과거 생성시각과 생성 이후 평가시각의 기존 pass 계약은 유지한다.

## 현재 증거 상태

- 추적 수동 평가: 14개 케이스·82개 검사 모두 `not_run`
- 선언 상태: `needs_review`
- `certificationClaimed:false`
- 실제 스크린리더·모바일 보조기기 평가와 품질인증은 완료되지 않았다.

## 검증

- focused: `npm.cmd test -- --run tests/platform-accessibility-manual-evidence.test.mjs` — 1개 파일, 14건 통과
- 수동·KWCAG 연동 집중: 2개 파일·21건 통과
- automation 전체: 27개 파일·437건 통과
- 루트 전체: 64개 파일·1,077건 통과
- Astro: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

production DB, Auth, membership, RLS, GRANT, 공개 데이터와 배포 상태를 변경하지 않았다.
