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
7. 동일 operation ID의 payload 충돌, 같은 assembly ordinal의 parent 충돌을 거부했다.
8. join code 충돌 20회 소진 시 앞선 assembly/session까지 rollback되는 것을 검증했다.
9. 모든 INSERT 뒤 summary 불일치가 발견돼도 plan 전체가 rollback되는 것을 검증했다.
10. `authenticated`에 RPC EXECUTE를 임시 부여한 격리 음성 테스트를 post-apply verifier가 거부했다.
11. ledger·non-null ordinal이 있는 populated rollback은 객체 제거 전에 거부되고 post-apply verifier가 계속 통과하는지 확인했다.
12. exact-scope throwaway cleanup만 synthetic A4 행을 제거하는 것을 확인했다.
13. cleanup 뒤 최종 rollback이 성공해 RPC·ledger·team ordinal이 제거되는 것을 확인했다.

결과: `A4_LOCAL_POSTGRES_REHEARSAL=passed`

## 자동화 회귀

- A4 bundle·design plan 집중 테스트: 25건 통과
- Windows automation 전체: 26개 파일, 342건 통과
- approval bundle verifier: builder·A4 집중 테스트를 포함한 artifact 14개, production apply 미승인·DB mutation 미실행 상태로 통과
- 추적 manifest를 current source에서 재구성해 stale source hash를 거부하는 테스트 통과
- bundle checksum: `772ca962303099a1274eb37f65005adc0948098cdf5e2d17415fbed5742aaebe`

## 보안·데이터 무결성 결론

- ledger에는 blueprint 원문, join code, 이메일, Auth UUID를 저장하지 않는다.
- RPC는 `org_id`를 입력받지 않고 현재 Auth 사용자와 활성 membership에서 기관을 파생한다.
- 기존 resource가 plan payload와 다르면 update하지 않고 안정 오류 코드로 전체 transaction을 중단한다.
- production 경로는 여전히 비활성 상태이며 별도 적용 승인이 필요하다.
