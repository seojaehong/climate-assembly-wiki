# A4 reconciliation source evidence 검증

- 검증일: 2026-08-26
- 범위: 휴면 A4 migration, operation ledger, read-only reconciliation, post-apply verifier
- production 영향: 없음
- DB 적용: PostgreSQL 16 throwaway container에만 수행
- credential·Auth·GRANT·traffic 변경: 없음

## 발견한 계약 공백

`design_provisioning_status()`는 query의 `sourceBlueprintSha256`와 `sourceBlueprintBytes` 형식은 검사했지만 operation ledger에는 두 값을 저장하지 않아 실행 당시 원 청사진과 대조할 수 없었다. 동일한 executed plan checksum과 operation 목록을 유지한 채 source evidence만 바꾼 query가 completed reconciliation을 반환했다.

## 변경

- `design_provisioning_operation`에 `source_blueprint_sha256 text not null`과 `source_blueprint_bytes integer not null`을 추가했다.
- SHA-256 lowercase hex와 1~1,000,000 byte 범위를 named check constraint로 고정했다.
- 새 ledger 기록에 검증된 plan의 source evidence를 저장하되 원본 bytes는 저장하지 않는다.
- exact replay와 reconciliation이 ledger의 두 source evidence를 exact 대조한다.
- post-apply verifier가 새 column type/nullability/default와 named constraint 정의를 확인한다.
- A4 migration bundle을 현재 20개 source artifact에 맞춰 다시 봉인했다.

## TDD 증거

수정 전 PostgreSQL 16 semantic rehearsal 결과:

```text
ERROR: A4 semantic test failed: reconciliation source digest conflict unexpectedly succeeded
```

수정 후에는 source SHA 변조와 byte 길이 `100→99` 변조가 모두 `design_reconciliation_conflict`로 차단됐고 semantic test가 완료됐다.

## 검증 로그

- PostgreSQL 16 post-apply verifier: 통과
- PostgreSQL 16 semantic rehearsal: 통과
- ledger 확인: 16개 operation 모두 source SHA와 100 byte 길이 보존
- 완화된 `source_blueprint_bytes >= 0` 제약 음성 검증: `constraint contract is unsafe`로 차단
- throwaway cleanup 뒤 rollback과 object 제거 확인: 통과
- A4 집중 테스트: 3개 파일, 96건 통과
- 루트 전체: 65개 파일, 1,081건 통과
- automation 전체: 28개 파일, 496건 통과 (`--testTimeout 30000`)
- Astro check: 337개 파일, 오류 0, 경고 0, 기존 hint 49
- A4 bundle checksum: `94705effd7e0910943fcf1123b57695148cc8013dac3a460991271ec21143bd6`

## Review

- Security: source 원문·credential·Auth 식별값을 ledger에 추가하지 않았고 기존 dormant privilege 경계를 유지했다.
- Performance: 두 고정 크기 metadata 비교만 추가했으며 추가 조회나 비정상 반복은 없다.
- Correctness: source digest와 길이 변조, exact replay, semantic transaction, 제약 완화 음성 경로를 검증했다.
- Maintainability: column·constraint·문서·bundle 검증을 같은 승인 source 묶음에 결속했다.
- 미해결 production blocker: approval/execution identity와 approved review checksum의 durable ledger 결속, 실제 key custody·authorization CAS·receipt store·RPC 권한은 별도 범위로 남는다.
