# A7 이행추적 표시 검증

## 범위

- 선택적 공개 이행 상태의 fail-closed 파싱
- 웹 패널·표 대체본·DOCX의 공용 상태 모델
- 책임 기관·갱신일·공개 설명·HTTPS 근거 보존
- 미등록/잘못된 값 분리와 접근성 색 대비
- 실제 공개 결과 브라우저 감사 fixture의 이행 패널 readiness

## 승인 경계

- DB 스키마와 migration 변경 없음
- `result_get` RPC 변경 없음
- 실제 시민 데이터와 공개 snapshot 변경 없음
- 운영 데이터 게시와 atomic publish 계약은 사용자 승인 전 미수행

## 검증 결과

- `npm.cmd exec vitest -- run src/islands/result/result-view-logic.test.ts src/islands/result/ResultView.test.ts src/islands/result/result-report-docx.test.ts`: 62건 통과
- `npm.cmd exec vitest -- run`: 루트 전체 918건 통과
- `npm.cmd exec vitest -- run --exclude tests/platform-accessibility-audit.test.mjs --exclude tests/verify-canvas-browser.test.mjs`: Windows 브라우저 제한 파일을 제외한 automation 222건 통과
- `npm.cmd exec vitest -- run tests/platform-accessibility-audit.test.mjs -t "covers authenticated and published production surfaces"`: 공개 결과 fixture/readiness 계약 1건 통과
- `npm.cmd run check`: Astro 오류 0건, 기존 hint만 유지
- `git diff --check`: 내용 오류 없음

실제 Chromium 전체 접근성 감사와 정적 build는 push 뒤 GitHub Actions를 최종 증거로 사용한다.
