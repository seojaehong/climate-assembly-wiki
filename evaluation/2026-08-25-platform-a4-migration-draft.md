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
- `supabase/verify/design_provisioning_post_apply.sql`
- `supabase/verify/design_provisioning_test.sql`
- `automation/platform-a4-migration-bundle.mjs`
- `evaluation/platform-a4-migration-bundle.json`

## 격리 PostgreSQL 16 리허설 로그

1. P1→P1C→P2 선행 schema를 throwaway container에 적용했다.
2. 적용 전 preflight는 `databaseMutationExecuted:false`, `ready:true`, 기존 team mapping 대상 0건을 반환했다.
3. A4 migration 초안과 post-apply verifier가 통과했다.
4. 원 청사진 바이트 길이·SHA-256 불일치 거부, 정상 4개 operation 생성과 exact replay를 검증했다.
5. 동일 operation ID의 payload 충돌, 같은 assembly ordinal의 parent 충돌을 거부했다.
6. join code 충돌 20회 소진 시 앞선 assembly/session까지 rollback되는 것을 검증했다.
7. 모든 INSERT 뒤 summary 불일치가 발견돼도 plan 전체가 rollback되는 것을 검증했다.
8. `authenticated`에 RPC EXECUTE를 임시 부여한 격리 음성 테스트를 post-apply verifier가 거부했다.
9. rollback 뒤 RPC·ledger·team ordinal이 제거된 것을 확인했다.

결과: `A4_LOCAL_POSTGRES_REHEARSAL=passed`

## 자동화 회귀

- A4 bundle·기존 design plan 집중 테스트: 15건 통과
- Windows automation 전체: 26개 파일, 332건 통과
- approval bundle verifier: artifact 8개, production apply 미승인·DB mutation 미실행 상태로 통과
- bundle checksum: `3df87e216f9070e19e15da8c5beb40e405c44f280f6023e07b201dd16a50525c`

## 보안·데이터 무결성 결론

- ledger에는 blueprint 원문, join code, 이메일, Auth UUID를 저장하지 않는다.
- RPC는 `org_id`를 입력받지 않고 현재 Auth 사용자와 활성 membership에서 기관을 파생한다.
- 기존 resource가 plan payload와 다르면 update하지 않고 안정 오류 코드로 전체 transaction을 중단한다.
- production 경로는 여전히 비활성 상태이며 별도 적용 승인이 필요하다.
