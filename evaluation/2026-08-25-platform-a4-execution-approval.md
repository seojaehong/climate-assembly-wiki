# A4 실행 승인 artifact 계약 검증

- 검증일: 2026-08-25
- 범위: adapter-independent A4 실행 승인 seal/verifier와 운영 계약
- production DB·Auth·membership·GRANT·traffic·provider 접근 또는 mutation: 없음

## 구현 경계

- exact design plan checksum, 원 청사진 byte SHA-256·길이와 operation count를 HMAC 승인에 결속한다.
- approval/execution ID, 대상 organization UUID·host, canonical Auth reviewer, `org_admin|hq` 역할, key ID와 최대 15분 유효기간을 검증한다.
- exact approval ID의 durable state lookup 형상을 고정하고 `revokedAt`, one-time claim, 완료·실패 claim과 다른 execution/organization/host 재사용을 fail-closed한다.
- claim이 없으면 `claim_required`, 같은 approval/execution/organization/host/plan의 진행 중 claim이면 `resume_existing_claim`만 반환한다.
- 승인 발급 CLI, 실제 key, durable state 저장소, 원자 claim adapter, live membership 검증과 production executor는 제공하지 않는다.
- 기존 plan의 `readyForExecution:false`, `serverContractImplemented:false`, `databaseMutationExecuted:false`는 유지한다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| A4 plan 집중 Vitest | 1개 파일, 13건 통과 |
| automation 전체 Vitest | 26개 파일, 337건 통과 |
| root 전체 Vitest | 64개 파일, 1,060건 통과 |
| Astro check | 326개 파일, 오류 0건, 기존 hint 49건 |
| diff whitespace | `git diff --check` 통과 |

집중 음성 테스트는 wrong role, 다른 organization/host, 만료, 취소, 완료된 claim, 다른 execution 재사용, artifact tamper와 불완전 approval-state를 거부한다. 같은 진행 중 claim의 복구 경로는 mutation을 수행하지 않고 verifier 결과만 반환한다.

## 남은 blocker

1. Gate A 제품 방향과 Gate B-A4 production migration의 별도 사용자 승인
2. 승인 발급 주체·key custody와 durable revocation/claim 저장소
3. mutation 전 원자 claim과 active `org_admin|hq` membership·선택 기관 재검증 adapter
4. A4 migration·mapping·activation preflight와 RPC 권한 활성화
5. 실제 실행 receipt·rollback·role deny E2E

이 보고서는 repository 계약과 로컬 검증 증거이며 production 실행 승인 artifact가 아니다.
