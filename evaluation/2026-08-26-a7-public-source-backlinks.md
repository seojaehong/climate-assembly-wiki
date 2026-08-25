# A7 공개 원문 역링크 UI 검증

## 구현 결과

공개 결과의 쟁점은 선택적 `source_references`가 명시적 공개검수 계약을 모두 만족할 때만 원문 근거를 표시한다. 쟁점 카드의 `원문 근거` 링크는 대응 원문 카드로 이동하고, 원문 카드의 `쟁점으로 돌아가기` 링크는 원래 쟁점으로 복귀한다. 두 대상은 프로그램 포커스를 받을 수 있다.

## 공개 경계

- 쟁점 자체가 HITL 검수 완료 상태여야 한다.
- 원문 record는 exact 9개 필드만 허용한다.
- `publication_status`는 `reviewed`, 검수 역할은 `org_admin|hq`만 허용한다.
- reference key, 조 이름, 양수 순번, `core|extra`, 최대 2,000자 원문, 소문자 SHA-256 형식, canonical UTC 검수시각을 검사한다.
- 중복 reference key, 계약 밖 내부 필드, 잘못된 record가 하나라도 있으면 해당 원문 묶음 전체를 숨기고 `근거 원문 공개 정보 확인 필요`만 표시한다.
- 원문 필드가 없는 기존 공개 결과는 유효한 빈 상태로 유지한다.

## 검증

- TDD red: 기존 모델과 화면에서 승인 원문·차단 상태·왕복 링크가 모두 없음을 10개 실패로 재현
- 집중 웹: `npm.cmd exec vitest -- run src/islands/result/result-view-logic.test.ts src/islands/result/ResultView.test.ts` — 2개 파일, 54건 통과
- Chromium 감사 harness: `npm.cmd test -- --run tests/platform-accessibility-audit.test.mjs` — 1개 파일, 15건 통과
- 루트 전체: `npm.cmd exec vitest -- run` — 64개 파일, 1,072건 통과
- automation 전체: `npm.cmd test -- --run` — 27개 파일, 422건 통과
- Astro: `npm.cmd run check` — 330개 파일, 오류 0건, 기존 hint 49건

## 미완료·승인 경계

- UI는 `content_sha256` 형식만 확인한다. 실제 원문 bytes와 digest 결속은 후속 승인된 publish preflight/RPC에서 검증해야 한다.
- 현재 production `result_page` payload에는 `source_references`가 없다.
- DB/RPC/migration, 실제 시민 원문 캡처, 공개 payload 적재와 게시를 수행하지 않았다.
- DOCX 원문 역링크와 실제 스크린리더·모바일 보조기기 수동 평가는 후속 범위다.
