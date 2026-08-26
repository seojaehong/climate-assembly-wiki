# A7 원문 공개 계약 identity 결속 검증

## 결과

원문 provenance plan과 replace-all publication plan을 schema v2로 승격하고, 두 artifact에 `source-reference-contract.json`의 schema version과 canonical SHA-256을 기록한다. 현재 verifier는 plan self-checksum뿐 아니라 현재 입력으로 전체 plan을 재생성하므로 contract identity를 바꾸고 checksum만 다시 계산한 artifact도 거부한다.

## TDD 경계

- RED: 두 plan에 `sourceReferenceContract`가 없어 focused test 2건이 실패했다.
- GREEN: 두 plan이 동일한 contract schema와 canonical digest를 기록한다.
- legacy schema v1 plan은 identity가 없으므로 명시적으로 거부한다.
- contract root·record의 예상 밖 필드, 공개 필드·종류·상태·검수 역할 vocabulary drift와 0 이하 길이·순번 경계는 module load에서 fail-closed한다.
- forged identity를 넣고 self-checksum을 다시 계산한 provenance·publication plan은 모두 현재 입력과 불일치로 거부한다.

## 안전 경계

- 원문, reviewer identity, production payload, DB, RPC, migration, public 파일을 읽거나 변경하지 않았다.
- canonical digest는 계약 drift 탐지용이며 외부 서명·승인자 인증·독립 timestamp가 아니다.
- 실제 publication은 기존과 같이 별도 사용자 승인과 atomic server 검증이 필요하다.

## 검증

- focused: `automation/tests/platform-result-source-plan.test.mjs` 27건 통과
- automation 전체: 27개 파일, 451건 통과
- 루트 전체: 65개 파일, 1,081건 통과
- Astro check: 333개 파일, 오류·경고 0건, 기존 hint 49건
- Linux clean build·전체 CI는 push 후 확인한다.
