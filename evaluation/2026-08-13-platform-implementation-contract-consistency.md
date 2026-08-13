# A7 이행 상태 단일 계약 검증

## 목적

공개 웹 표시와 승인 전 publish preflight가 서로 다른 이행 상태·근거 규칙을 갖지 않도록 단일 정본으로 통합한다.

## 구현

- `implementation-status-contract.json`: fallback 2종, 추적 상태 5종, label·설명·색상·추적·근거 필수 규칙
- `result-view-logic.ts`: JSON key에서 TypeScript 상태를 파생하고 표시·검증에 사용
- `platform-implementation-plan.mjs`: 같은 JSON을 읽고 schema·fallback·메타데이터·색상을 fail-closed 검증
- 양쪽 테스트가 전체 상태 집합, 완료 근거 규칙, fallback 거부와 색 대비를 고정

## 안전 경계

- DB·RPC·migration·실제 공개 snapshot 변경 없음
- 실제 기관 응답이나 시민 데이터 사용 없음
- 상태 계약 변경만으로 게시 승인을 의미하지 않음

## 검증 결과

- `npm.cmd exec vitest -- run src/islands/result/result-view-logic.test.ts src/islands/result/ResultView.test.ts`: 웹 집중 39건 통과
- `npm.cmd exec vitest -- run tests/platform-implementation-plan.test.mjs`: plan 집중 16건 통과
- `npm.cmd exec vitest -- run`: 루트 전체 919건 통과
- `npm.cmd exec vitest -- run --exclude tests/platform-accessibility-audit.test.mjs --exclude tests/verify-canvas-browser.test.mjs`: Windows 브라우저 제한 파일을 제외한 automation 238건 통과
- `npm.cmd run check`: Astro 오류 0건, 기존 hint 49건
- `git diff --check`: 내용 오류 없음

전체 Linux automation, 정적 build와 Chromium 접근성은 push 뒤 GitHub Actions를 최종 증거로 사용한다.
