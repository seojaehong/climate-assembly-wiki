# A4 migration 초안 검증 보고서

- 검증일: 2026-08-25 (Asia/Seoul)
- 범위: 저장소의 A4 SQL 초안·rollback·read-only verifier·approval bundle
- production 적용: 수행하지 않음
- database credential 접근: 수행하지 않음

## 승인 경계

- 승인됨: migration 초안 작성과 저장소 채택
- 미승인: production apply, 기존 행 backfill, NOT NULL 전환, Auth·membership 생성, staff GRANT, traffic open, executor 연결
- 확정안: team identity `(session_id, ordinal)`, session slug 전역 unique 유지, plan 전체 단일 transaction, join code는 승인된 staff의 현재 응답에서만 제공

## 산출물

- `supabase/migrations/platform_p3_design_provisioning.sql`
- `supabase/rollbacks/platform_p3_design_provisioning_BEFORE.sql`
- `supabase/verify/design_provisioning_preflight.sql`
- `supabase/verify/design_provisioning_preflight_legacy_fixture.sql`
- `supabase/verify/design_provisioning_preflight_mapping_fixture.sql`
- `supabase/verify/design_provisioning_post_apply.sql`
- `supabase/verify/design_provisioning_test.sql`
- `supabase/verify/design_provisioning_rollback_cleanup_fixture.sql`
- `automation/platform-design-provisioning-plan.mjs`
- `automation/platform-design-provisioning-durable-store.mjs`
- `automation/tests/platform-design-provisioning-plan.test.mjs`
- `automation/platform-a4-migration-bundle.mjs`
- `automation/tests/platform-a4-migration-bundle.test.mjs`
- `evaluation/platform-a4-migration-bundle.json`

## 격리 PostgreSQL 16 리허설 로그

1. P1→P1C→P2 선행 schema를 throwaway container에 적용했다.
2. legacy team 1건을 둔 적용 전 preflight는 `readyForAdditiveMigration:true`, `readyForActivation:false`, mapping 대상 1건을 반환했다.
3. throwaway flag 없는 fixture 실행은 exit code 3으로 중단되어 production 오사용을 차단했다.
4. A4 migration 뒤에도 legacy ordinal이 `NULL`인 동안 activation을 차단하고, throwaway 전용 mapping fixture 적용 뒤에만 `readyForActivation:true`가 되는 것을 검증했다.
5. A4 migration 초안과 post-apply verifier가 통과했다.
6. 원 청사진 바이트 길이·SHA-256 불일치 거부, 정상 4개 operation 생성과 exact replay를 검증했다.
7. read-only reconciliation은 실행 전 `pending`과 실행 후 4개 `replayed` operation·team join code를 반환하며 ledger/resource 행 수를 바꾸지 않았다.
8. reconciliation의 executed checksum 충돌, 앞 operation 누락 뒤의 기존 operation 충돌 은폐와 `operator` 역할을 거부했다.
9. 동일 operation ID의 payload 충돌과 operation payload가 같더라도 전체 plan checksum이 다른 교차-plan replay를 mutation 전에 거부했다.
10. 독립된 새 assembly 안에서 같은 session ordinal을 재사용하는 parent 충돌을 거부했다.
11. 같은 session operation을 두 번 넣어 operation ID와 resource ref가 중복된 plan을 lookup·mutation 전에 거부하고 ledger·assembly 무변경을 확인했다.
12. join code 생성기는 `extensions.gen_random_bytes(4)`와 rejection sampling을 사용하고 6자리 형상을 유지하며, 충돌 fixture 뒤에도 secure generator가 복원됨을 검증했다. 충돌 20회 소진 시 앞선 assembly/session까지 rollback되는 것도 확인했다.
13. 모든 INSERT 뒤 summary 불일치가 발견돼도 plan 전체가 rollback되는 것을 검증했다.
14. `authenticated`에 mutation/status RPC EXECUTE를 각각 임시 부여한 격리 음성 테스트를 post-apply verifier가 거부했다.
15. ledger·non-null ordinal이 있는 populated rollback은 객체 제거 전에 거부되고 post-apply verifier가 계속 통과하는지 확인했다.
16. exact-scope throwaway cleanup만 synthetic A4 행을 제거하는 것을 확인했다.
17. cleanup 뒤 최종 rollback이 성공해 mutation/status RPC·ledger·team ordinal이 제거되는 것을 확인했다.

결과: `A4_LOCAL_POSTGRES_REHEARSAL=passed`

추가 조회 계약 결과: `A4_RECONCILIATION_POSTGRES_REHEARSAL=passed`

휴면 권한·populated guard·cleanup·최종 객체 제거 포함 전체 결과: `A4_RECONCILIATION_FULL_POSTGRES_REHEARSAL=passed`

partial ledger 충돌 은폐 방지 결과: `A4_PARTIAL_CONFLICT_POSTGRES_REHEARSAL=passed`

교차-plan operation replay 차단 결과: `A4_CROSS_PLAN_REPLAY_POSTGRES_REHEARSAL=passed`

join-code CSPRNG·복원 결과: `A4_SECURE_JOIN_CODE_POSTGRES_REHEARSAL=passed`

중복 operation identity 차단 결과: `A4_DUPLICATE_OPERATION_IDENTITY_POSTGRES_REHEARSAL=passed`

## 자동화 회귀

- A4 bundle·design plan 집중 테스트: 55건 통과
- Windows automation 전체: 26개 파일, 402건 통과
- 애플리케이션 전체: 64개 파일, 1,060건 통과
- Astro check: 327개 파일, 오류 0건, 기존 hint 49건
- 저장소 밖 로컬 durable store의 adapter 재시작·lock-free CAS·독립 Node 프로세스 6개 claim 경쟁(1 claimed, 5 conflict, journal record 2개)·orphan temp 복구·append-only replay/conflict·journal 변조·junction escape·revocation/claim 경쟁·membership 비활성 finalize와 재활성화 거부·비식별 전체-store/keyed receipt audit·off-store inventory checkpoint 삭제/tail 변경 테스트 통과
- approval bundle verifier: builder·durable store·A4 집중 테스트·CI workflow·LF 규칙을 포함한 artifact 17개, production apply 미승인·DB mutation 미실행 상태로 통과
- 추적 manifest를 current source에서 재구성해 stale source hash를 거부하는 테스트 통과
- bundle checksum: `63e941548771e7279f960c30f7a208d2aea321b0f963f12f5a20fc5b732d0176`

## 보안·데이터 무결성 결론

- ledger에는 blueprint 원문, join code, 이메일, Auth UUID를 저장하지 않는다.
- RPC는 `org_id`를 입력받지 않고 현재 Auth 사용자와 활성 membership에서 기관을 파생한다.
- reconciliation RPC는 mutation plan·원본 bytes를 받지 않는 `STABLE` 조회 함수이며 ledger/resource를 변경하지 않는다.
- 로컬 durable store는 synthetic authorization context만 immutable journal에 함께 보존하며 production Auth/membership 증거로 사용하지 않는다.
- 전체-store audit는 존재하는 journal·receipt와 claim 연결을 비식별 집계하고 합성 HMAC key로 receipt와 off-store inventory checkpoint를 검증할 수 있다. checkpoint 없는 기본 audit, 실제 외부 보관·freshness·production key custody/rotation은 여전히 증명하지 않는다.
- 기존 resource가 plan payload와 다르거나 같은 operation이 다른 전체 plan checksum으로 재사용되면 update하지 않고 안정 오류 코드로 전체 transaction을 중단한다.
- plan 내부의 operation ID와 resource ref는 각각 유일해야 하며 중복 plan은 lookup·mutation 전에 거부한다.
- join code는 비암호학적 `random()` 대신 `pgcrypto` CSPRNG와 rejection sampling으로 생성하며 ledger·일반 오류에는 기록하지 않는다.
- production 경로는 여전히 비활성 상태이며 별도 적용 승인이 필요하다.
