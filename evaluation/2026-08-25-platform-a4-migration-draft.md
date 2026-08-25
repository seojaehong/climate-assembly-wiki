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
9. 동일 operation ID의 payload 충돌, 같은 assembly ordinal의 parent 충돌을 거부했다.
10. join code 충돌 20회 소진 시 앞선 assembly/session까지 rollback되는 것을 검증했다.
11. 모든 INSERT 뒤 summary 불일치가 발견돼도 plan 전체가 rollback되는 것을 검증했다.
12. `authenticated`에 mutation/status RPC EXECUTE를 각각 임시 부여한 격리 음성 테스트를 post-apply verifier가 거부했다.
13. ledger·non-null ordinal이 있는 populated rollback은 객체 제거 전에 거부되고 post-apply verifier가 계속 통과하는지 확인했다.
14. exact-scope throwaway cleanup만 synthetic A4 행을 제거하는 것을 확인했다.
15. cleanup 뒤 최종 rollback이 성공해 mutation/status RPC·ledger·team ordinal이 제거되는 것을 확인했다.

결과: `A4_LOCAL_POSTGRES_REHEARSAL=passed`

추가 조회 계약 결과: `A4_RECONCILIATION_POSTGRES_REHEARSAL=passed`

휴면 권한·populated guard·cleanup·최종 객체 제거 포함 전체 결과: `A4_RECONCILIATION_FULL_POSTGRES_REHEARSAL=passed`

partial ledger 충돌 은폐 방지 결과: `A4_PARTIAL_CONFLICT_POSTGRES_REHEARSAL=passed`

## 자동화 회귀

- A4 bundle·design plan 집중 테스트: 53건 통과
- Windows automation 전체: 26개 파일, 371건 통과
- 애플리케이션 전체: 64개 파일, 1,060건 통과
- Astro check: 327개 파일, 오류 0건, 기존 hint 49건
- 저장소 밖 로컬 durable store의 adapter 재시작·lock-free CAS·독립 Node 프로세스 6개 claim 경쟁(1 claimed, 5 conflict, journal record 2개)·orphan temp 복구·append-only replay/conflict·journal 변조·junction escape·revocation/claim 경쟁·membership 비활성 finalize와 재활성화 거부·비식별 전체-store 현재-entry 및 합성 단일-key receipt HMAC audit 테스트 통과
- approval bundle verifier: builder·durable store·A4 집중 테스트·CI workflow·LF 규칙을 포함한 artifact 17개, production apply 미승인·DB mutation 미실행 상태로 통과
- 추적 manifest를 current source에서 재구성해 stale source hash를 거부하는 테스트 통과
- bundle checksum: `ca55c2310409f93824752ec896e20dab0bff9fed7b5362a20e564f9566b4b668`

## 보안·데이터 무결성 결론

- ledger에는 blueprint 원문, join code, 이메일, Auth UUID를 저장하지 않는다.
- RPC는 `org_id`를 입력받지 않고 현재 Auth 사용자와 활성 membership에서 기관을 파생한다.
- reconciliation RPC는 mutation plan·원본 bytes를 받지 않는 `STABLE` 조회 함수이며 ledger/resource를 변경하지 않는다.
- 로컬 durable store는 synthetic authorization context만 immutable journal에 함께 보존하며 production Auth/membership 증거로 사용하지 않는다.
- 전체-store audit는 존재하는 journal·receipt와 claim 연결을 비식별 집계하며, 명시적으로 주입한 합성 HMAC key·key ID로 현재 receipt 서명을 검증할 수 있다. 외부 anchor·production key custody/rotation은 없어 삭제 완전성과 운영 key 신뢰는 증명하지 않는다.
- 기존 resource가 plan payload와 다르면 update하지 않고 안정 오류 코드로 전체 transaction을 중단한다.
- production 경로는 여전히 비활성 상태이며 별도 적용 승인이 필요하다.
