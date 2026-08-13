# A7 이행추적 Publish Plan 검증

## 구현 범위

- 현재 공개 snapshot과 기관 이행 응답의 scope·issue 결속
- 공개 상태 vocabulary, 책임 기관, 공개 설명, HTTPS 근거 검증
- `updated_at <= reviewed_at <= observed_at` 및 공개 이후 관찰 시각 검증
- 역할형 검수자 ID와 승인되지 않은 필드 차단
- 갱신하지 않은 쟁점을 포함한 전체 atomic body 재구성
- 전후 body·쟁점별 이행값 SHA-256, canonical checksum, 전체 입력 재생성 검증
- no-overwrite CLI와 원문 비노출 오류

## 안전·승인 경계

- DB·RPC·Drive·public 파일 변경 없음
- 실제 기관 응답이나 시민 데이터 사용 없음
- 외부 서명·기관 응답 진위·검수자 인증을 주장하지 않음
- 실제 저장 schema와 atomic publish RPC/migration은 사용자 승인 전 미수행

## 검증 결과

- `npm.cmd exec vitest -- run tests/platform-implementation-plan.test.mjs`: 집중 15건 통과
- `npm.cmd exec vitest -- run --exclude tests/platform-accessibility-audit.test.mjs --exclude tests/verify-canvas-browser.test.mjs`: Windows 브라우저 제한 파일을 제외한 automation 237건 통과
- `npm.cmd exec vitest -- run`: 루트 전체 918건 통과
- `npm.cmd run check`: Astro 오류 0건, 기존 hint 49건
- `git diff --check`: 내용 오류 없음

전체 Linux automation과 브라우저 런타임은 push 뒤 GitHub Actions를 최종 증거로 사용한다.
