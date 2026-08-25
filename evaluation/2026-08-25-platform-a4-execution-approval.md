# A4 실행 승인 artifact·receipt 계약 검증

- 검증일: 2026-08-25
- 범위: adapter-independent A4 실행 승인 lifecycle와 비식별 receipt seal/verifier 계약
- production DB·Auth·membership·GRANT·traffic·provider 접근 또는 mutation: 없음

## 구현 경계

- exact design plan checksum, 원 청사진 byte SHA-256·길이와 operation count를 HMAC 승인에 결속한다.
- approval/execution ID, 대상 organization UUID·host, canonical Auth reviewer, `org_admin|hq` 역할, key ID와 최대 15분 유효기간을 검증한다.
- schema v1은 승인자와 실제 실행자를 같은 canonical Auth 사용자·역할로 결속한다.
- exact approval ID의 durable state lookup 형상을 고정하고 `revokedAt`, one-time claim, 완료·실패 claim과 다른 execution/organization/host/actor/role 재사용을 fail-closed한다.
- authorization adapter가 state와 live membership/org/host를 한 snapshot으로 읽고 expected snapshot CAS claim·finalize에서 원자 재검증하도록 interface를 고정했다. core는 transaction 시점의 두 응답 context를 다시 검증한다.
- claim이 없으면 `claim_required`, 같은 approval/execution/organization/host/actor/role/plan의 진행 중 claim이면 `resume_existing_claim`만 반환한다. 유효 시간 안에 시작된 claim은 만료 뒤 terminal audit state를 닫을 수 있다.
- in-memory test double의 동시 claim·finalize는 각각 `new` 1건과 동일 경쟁 `reconciled` 1건으로 수렴하고 이후 요청은 `existing`으로 복구된다. 반대 terminal outcome 덮어쓰기와 terminal state 재-claim은 거부한다.
- 승인된 review plan에서 동일 operation/source를 가진 실행형 RPC checksum을 결정적으로 파생해 approved/executed checksum을 함께 결속한다. 성공 RPC response의 exact operation/resource/join-code 형식을 검증한 뒤 resource UUID와 join code를 제거하고 operation ID·type·status·count만 receipt에 남긴다.
- 실패 receipt는 allowlist `design_*` 코드와 rollback 확인만 허용하며, approval/plan/source·execution·시각·요약을 HMAC으로 결속한다. 함수는 RPC·persistence를 호출하지 않는다.
- 승인 발급 CLI, 실제 key, production-backed durable state·live membership adapter와 production executor는 제공하지 않는다.
- 기존 plan의 `readyForExecution:false`, `serverContractImplemented:false`, `databaseMutationExecuted:false`는 유지한다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| A4 plan 집중 Vitest | 1개 파일, 21건 통과 |
| A4 bundle 집중 Vitest | 1개 파일, 8건 통과; tracked manifest current-source 대조 포함 |
| approval bundle | builder·A4 집중 테스트를 포함한 14개 artifact byte hash 결속 |
| automation 전체 Vitest | 26개 파일, 346건 통과 |
| root 전체 Vitest | 64개 파일, 1,060건 통과 |
| Astro check | 326개 파일, 오류 0건, 기존 hint 49건 |
| diff whitespace | `git diff --check` 통과 |

집중 음성 테스트는 wrong/inactive role, 다른 user/organization/host, 만료, 취소, 완료된 claim, 다른 execution 재사용, CAS 중 live context 변경, terminal claim 유실·반대 outcome, malformed RPC·raw failure·rollback 미확인, artifact tamper와 불완전 approval-state를 거부한다. 같은 진행 중 claim과 같은 terminal outcome의 복구 및 receipt seal 경로는 RPC·DB mutation을 수행하지 않는다.

## 남은 blocker

1. Gate A 제품 방향과 Gate B-A4 production migration의 별도 사용자 승인
2. 승인 발급 주체·key custody와 durable revocation/claim 저장소
3. mutation 전 원자 claim, 종료 후 terminal finalize와 active `org_admin|hq` membership·선택 기관 재검증 adapter
4. A4 migration·mapping·activation preflight와 RPC 권한 활성화
5. append-only receipt persistence·실제 rollback·role deny E2E

이 보고서는 repository 계약과 로컬 검증 증거이며 production 실행 승인 artifact가 아니다.
