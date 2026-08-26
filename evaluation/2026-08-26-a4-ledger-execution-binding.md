# A4 ledger execution identity 결속 검증

검증일: 2026-08-26  
범위: A4 migration 초안 및 비활성 Supabase fenced RPC adapter  
운영 변경: 없음

## 확인한 간극

기존 ledger와 reconciliation은 plan·operation·source evidence를 대조했지만, 운영 실행을 식별하는 approval ID, execution ID, 승인된 plan checksum, authorization revision을 ledger row 자체에 보존하지 않았다. 따라서 durable ledger evidence가 어떤 승인과 실행에서 생성됐는지를 단독으로 증명하지 못했다.

## 변경 결과

- `design_provisioning_operation_ledger`에 네 execution binding column을 추가하고 네 값이 모두 null이거나 모두 존재하도록 제약했다.
- fenced mutation이 저수준 mutation 또는 replay를 마친 같은 transaction에서 기존 unbound row를 approval·execution·승인 checksum·authorization revision에 결속한다.
- 이미 결속된 row를 다른 execution, 승인 checksum 또는 authorization revision으로 재사용하면 `design_execution_binding_conflict`로 중단한다.
- read-only reconciliation은 query identity, fence identity, live authorization revision, ledger binding이 모두 exact 일치할 때만 결과를 반환한다.
- 저수준 2-인자 mutation RPC는 계속 모든 외부 role에서 revoke 상태이며, unbound rehearsal row는 production-bound reconciliation 성공으로 승격되지 않는다.

## TDD 및 PostgreSQL 증거

변경 전 집중 테스트 7건은 authorization fence에 `approvedPlanChecksum`이 없어 실패했다. SQL semantic rehearsal도 `design_authorization_fence_invalid`로 실패했다. 계약과 SQL을 구현한 뒤 다음 부정 경로가 모두 mutation 또는 성공 reconciliation 전에 차단됐다.

- 다른 execution ID의 exact plan replay
- 다른 승인 plan checksum의 exact plan replay
- reconciliation query의 승인 checksum 불일치
- reconciliation query의 execution ID 불일치
- execution identity가 없는 ledger row reconciliation

정상 plan 적용 뒤 ledger 집계 결과는 `4|1|1|1|1|t`였다. 이는 operation 4건, distinct approval 1개, execution 1개, 승인 checksum 1개, authorization revision 1개, 모든 row 완전 결속을 뜻한다.

## 검증 결과

- A4 집중 테스트: 3개 파일, 96건 통과
- 루트 전체 테스트: 65개 파일, 1,081건 통과
- automation 전체 테스트: 28개 파일, 496건 통과 (`--testTimeout 30000`)
- Astro 검사: 337개 파일, 오류 0건, 경고 0건, 기존 hint 49건
- PostgreSQL 16: post-apply verifier 및 semantic rehearsal 통과
- 제약 부정 검증: execution binding 제약을 `check(true)`로 완화하면 `constraint contract is unsafe`로 거부
- rollback 검증: cleanup 및 rollback 뒤 대상 object 부재 `t`
- A4 bundle: 20개 artifact, checksum `810b7d2ae988f254811a3e8dc2b29096213a43726ccfd601e0c6e1d3089be654`

## 검토

- 보안: fence는 검증된 approval lifecycle에서 오며 adapter와 SQL이 exact schema와 SHA-256 형식을 재검증한다. 원문·secret·key material은 ledger에 저장하지 않는다.
- 정확성·동시성: 기관별 transaction advisory lock이 binding update까지 유지되고 all-or-none 제약이 부분 결속을 막는다. `IS DISTINCT FROM` 비교로 null/unbound row도 성공하지 않는다.
- 성능: plan 상한 안의 operation만 PK `(org_id, operation_id)`로 조회·갱신하며 새 무제한 loop나 network 호출은 없다.
- 유지보수: named constraints, post-apply definition 검사, semantic regression, 문서 계약을 함께 갱신했다.

## 남은 production blocker

이번 변경은 migration 초안과 격리 rehearsal뿐이다. 실제 key custody, durable approval·receipt store, live authorization CAS production adapter, migration 적용, RPC GRANT, staff traffic 연결은 별도 승인과 검증이 필요하다. `productionApplyApproved:false`, `databaseMutationExecuted:false`를 유지한다.
