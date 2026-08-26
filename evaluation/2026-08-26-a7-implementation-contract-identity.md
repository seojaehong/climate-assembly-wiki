# A7 이행 상태 계약 identity 결속 검증

## 결과

이행추적 publish plan을 schema v2로 승격하고, `implementation-status-contract.json`의 schema version과 canonical SHA-256을 artifact에 기록한다. verifier는 plan self-checksum과 현재 result·responses 기반 전체 재생성을 모두 대조한다.

## TDD 경계

- RED: plan schema v2·contract identity·CLI schema v2 기대가 없어 focused test 3건이 실패했다.
- GREEN: plan은 공유 계약 schema v2와 canonical digest를 정확히 기록한다.
- contract identity를 바꾸고 self-checksum을 다시 계산한 artifact도 현재 입력 재생성과 달라 거부한다.
- identity가 없는 legacy schema v1 plan은 현재 verifier가 명시적으로 거부한다.
- 기존 상태 vocabulary, fallback, record 길이, canonical UTC, credential 없는 HTTPS, retained value 재검증은 유지한다.

## 안전 경계

- 실제 기관 응답, production payload, DB, RPC, migration, public 파일을 읽거나 변경하지 않았다.
- canonical digest는 contract drift 탐지용이며 외부 서명·검수자 인증·기관 응답 진위·독립 timestamp가 아니다.
- atomic publish RPC와 이행 데이터 저장은 별도 사용자 승인 대상이다.

## 검증

- focused: `automation/tests/platform-implementation-plan.test.mjs` 18건 통과
- automation 전체: 27개 파일, 452건 통과
- 루트 전체: 65개 파일, 1,081건 통과
- Astro check: 333개 파일, 오류·경고 0건, 기존 hint 49건
- code review: security·performance·correctness·maintainability 차단 finding 없음
- Linux clean CI는 push 후 확인한다.
