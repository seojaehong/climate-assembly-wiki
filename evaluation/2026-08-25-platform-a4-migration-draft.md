# A4 migration 초안 검증 보고서

- 검증일: 2026-08-25 (Asia/Seoul)
- 최종 보강: 2026-08-26 (Asia/Seoul)
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
9. 정상 생성된 team을 `disabled`로 전환한 뒤 mutation exact replay는 `design_resource_conflict`, read-only reconciliation은 `design_reconciliation_conflict`로 거부하고 join code를 반환하지 않으며 ledger·resource 수가 유지되는지 확인했다.
10. 권한 없는 `operator`가 malformed mutation plan 또는 reconciliation query를 보내도 checksum·operation 배열 검증보다 먼저 `design_role_forbidden`으로 중단되는지 확인했다.
11. test-only 지연 trigger와 두 독립 PostgreSQL 연결이 같은 신규 plan을 동시에 실행해도 기관별 transaction advisory lock 뒤 하나는 `applied`, 다른 하나는 `replayed`로 수렴하고 resource 1세트·ledger 4건만 남는지 확인했다.
12. 동일 operation ID의 payload 충돌과 operation payload가 같더라도 전체 plan checksum이 다른 교차-plan replay를 mutation 전에 거부했다.
13. 독립된 새 assembly 안에서 같은 session ordinal을 재사용하는 parent 충돌을 거부했다.
14. 같은 session operation을 두 번 넣어 operation ID와 resource ref가 중복된 plan을 lookup·mutation 전에 거부하고 ledger·assembly 무변경을 확인했다.
15. mutation plan의 실행 boolean과 reconciliation operation count를 JSON 문자열로 바꾸거나 summary를 잘못된 컨테이너로 바꾸고 checksum을 다시 계산해도 각각 `design_plan_invalid`, `design_reconciliation_query_invalid`로 거부했다.
16. 잘못된 달력 날짜, 날짜 역행, 비연속 ordinal, topic/team 순서 역전, 중복 topic prompt, 비정규 team 이름, 세션 누적 정원 초과, topic 또는 team이 없는 세션을 `design_operation_invalid`로 거부하고 앞선 mutation을 rollback했다.
17. join code 생성기는 `extensions.gen_random_bytes(4)`와 rejection sampling을 사용하고 6자리 형상을 유지하며, 충돌 fixture 뒤에도 secure generator가 복원됨을 검증했다. 충돌 20회 소진 시 앞선 assembly/session까지 rollback되는 것도 확인했다.
18. 모든 INSERT 뒤 summary 불일치가 발견돼도 plan 전체가 rollback되는 것을 검증했다.
19. `authenticated`에 mutation/status RPC EXECUTE를 각각 임시 부여한 격리 음성 테스트를 post-apply verifier가 거부했다.
20. ledger·non-null ordinal이 있는 populated rollback은 객체 제거 전에 거부되고 post-apply verifier가 계속 통과하는지 확인했다.
21. exact-scope throwaway cleanup만 synthetic A4 행을 제거하는 것을 확인했다.
22. cleanup 뒤 최종 rollback이 성공해 mutation/status RPC·ledger·team ordinal이 제거되는 것을 확인했다.
23. 정상 생성 뒤 assembly를 `active`, session을 `active`, discussion topic을 `open`으로 각각 바꾼 exact replay가 모두 `design_resource_conflict`로 중단되는지 확인했다. RPC는 서버 생성 상태인 세 resource의 `draft`까지 exact 대조해 이미 활성화·종료된 자원을 새 설계가 채택하지 않는다.
24. team의 `platform_team_capacity_positive`를 제거하고 shadow table에 같은 이름·정의를 둔 경우와, 정확한 team에 완화된 `capacity >= 0` 정의를 둔 경우를 post-apply verifier가 모두 거부했다. 복구한 정확한 table·check 종류·`capacity > 0` 정의에서는 verifier와 전체 semantic rehearsal이 다시 통과했다.
25. `team.ordinal`을 PostgreSQL `bigint`로 바꾼 경우와 `session.assembly_id → assembly.id` FK를 제거한 경우를 post-apply verifier가 각각 column/FK 계약 오류로 거부했다. 21개 필수 column의 type·nullable·default와 session/ledger의 3개 참조 정의를 복구한 뒤 verifier와 전체 semantic rehearsal이 다시 통과했다.
26. mutation RPC가 권한 판정에 사용한 membership·organization 행을 `FOR SHARE`로 transaction 끝까지 잠그는지 두 dblink 연결로 검증했다. plan INSERT를 1초 지연한 동안 membership 역할 변경과 organization `suspended` 전환은 각각 250ms lock timeout으로 밀렸고 두 plan은 정상 적용됐으며 권한 행은 active로 유지됐다.
27. rollback cleanup fixture가 동시성 리허설의 `a4-membership-lock`·`a4-organization-lock` resource까지 exact-scope로 제거하도록 고정했다.
28. migration이 권한을 회수하는 내부 canonical JSON·SHA-256·join-code helper 각각에 `authenticated` EXECUTE를 임시 부여한 PostgreSQL 16 음성 리허설이 모두 `dormant privilege contract is unsafe`로 거부되고, 각 권한 회수 뒤 post-apply verifier가 다시 통과하는지 확인했다. public·anon·authenticated·service_role 네 역할과 세 helper의 12개 effective privilege 조합을 verifier가 전수 검사한다.
29. ledger table의 `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`를 public·anon·authenticated·service_role 각각에 임시 부여한 PostgreSQL 16 음성 리허설이 28개 조합 모두 같은 안정 오류로 거부되고, 매번 권한 회수 뒤 verifier가 다시 통과하는지 확인했다.

결과: `A4_LOCAL_POSTGRES_REHEARSAL=passed`

추가 조회 계약 결과: `A4_RECONCILIATION_POSTGRES_REHEARSAL=passed`

휴면 권한·populated guard·cleanup·최종 객체 제거 포함 전체 결과: `A4_RECONCILIATION_FULL_POSTGRES_REHEARSAL=passed`

partial ledger 충돌 은폐 방지 결과: `A4_PARTIAL_CONFLICT_POSTGRES_REHEARSAL=passed`

교차-plan operation replay 차단 결과: `A4_CROSS_PLAN_REPLAY_POSTGRES_REHEARSAL=passed`

join-code CSPRNG·복원 결과: `A4_SECURE_JOIN_CODE_POSTGRES_REHEARSAL=passed`

중복 operation identity 차단 결과: `A4_DUPLICATE_OPERATION_IDENTITY_POSTGRES_REHEARSAL=passed`

JSON scalar 타입 위조 차단 결과: `A4_JSON_SCALAR_TYPE_POSTGRES_REHEARSAL=passed`

canonical plan 의미 계약 결과: `A4_CANONICAL_PLAN_SEMANTICS_POSTGRES_REHEARSAL=passed`

비활성 team join-code 재노출 차단 결과: `A4_DISABLED_TEAM_JOIN_CODE_POSTGRES_REHEARSAL=passed`

권한 판정 우선 실행 결과: `A4_AUTHORIZATION_FIRST_POSTGRES_REHEARSAL=passed`

동시 exact plan 멱등 수렴 결과: `A4_CONCURRENT_EXACT_PLAN_POSTGRES_REHEARSAL=passed`

비-draft 설계 resource 채택 차단 결과: `A4_DESIGN_RESOURCE_STATUS_POSTGRES_REHEARSAL=passed`

제약 table·종류·정의 검증 결과: `A4_CONSTRAINT_IDENTITY_POSTGRES_REHEARSAL=passed`

column type·nullable·default·FK 검증 결과: `A4_COLUMN_FOREIGN_KEY_POSTGRES_REHEARSAL=passed`

authorization row-lock 경쟁 결과: `A4_AUTHORIZATION_ROW_LOCK_POSTGRES_REHEARSAL=passed`

내부 helper 권한 재노출 차단 결과: `A4_INTERNAL_HELPER_PRIVILEGE_POSTGRES_REHEARSAL=passed`

ledger table 권한 재노출 차단 결과: `A4_LEDGER_PRIVILEGE_POSTGRES_REHEARSAL=passed`

## 자동화 회귀

- A4 bundle·design plan·Supabase adapter 집중 테스트: 96건 통과
- Windows automation 전체: 28개 파일, 505건 통과
- 애플리케이션 전체: 65개 파일, 1,081건 통과
- Astro check: 337개 파일, 오류 0건, 경고 0건, 기존 hint 49건
- 저장소 밖 로컬 durable store의 adapter 재시작·lock-free CAS·독립 Node 프로세스 6개 claim 경쟁(1 claimed, 5 conflict, journal record 2개)·orphan temp 복구·append-only replay/conflict·journal 변조·terminal claim/checkpoint/receipt/lifecycle clock 사건시각 역행·junction escape·revocation/claim 경쟁·membership 비활성 finalize와 재활성화 거부·비식별 전체-store/keyed receipt audit·off-store inventory checkpoint 삭제/tail 변경·기본 10분 freshness 테스트 통과
- approval bundle verifier: builder·durable store·Supabase adapter·A4 집중 테스트·CI workflow·LF 규칙을 포함한 artifact 20개, production apply 미승인·DB mutation 미실행 상태로 통과
- 추적 manifest를 current source에서 재구성해 stale source hash를 거부하는 테스트 통과
- bundle checksum: `069c743b49990def2bd6332f1c8e109e609a0977d390e7a91a4953b1c502ca01`

## 보안·데이터 무결성 결론

- ledger에는 blueprint 원문, join code, 이메일, Auth UUID를 저장하지 않는다.
- RPC는 `org_id`를 입력받지 않고 현재 Auth 사용자와 활성 membership에서 기관을 파생한다.
- mutation/status RPC는 최소 root 형상 확인 직후 Auth·기관·역할을 먼저 판정해 권한 없는 요청의 checksum·digest·operation 전수 검증을 실행하지 않는다.
- mutation RPC는 권한 판정에 사용한 membership·organization 행을 transaction 종료까지 `FOR SHARE`로 잠가 실행 중 역할 회수·membership 취소·기관 비활성화가 먼저 commit되는 것을 막는다.
- reconciliation RPC는 mutation plan·원본 bytes를 받지 않는 `STABLE` 조회 함수이며 ledger/resource를 변경하지 않는다.
- 로컬 durable store는 synthetic authorization context만 immutable journal에 함께 보존하며 production Auth/membership 증거로 사용하지 않는다.
- lifecycle은 새 claim 뒤 receipt가 없을 때 authorization snapshot을 다시 읽고 active membership·organization·actor·role·host와 exact claim을 재검증한 뒤에만 execution adapter를 호출한다. 이 재조회는 production RPC transaction 내부의 live membership 검증을 대체하지 않는다.
- 전체-store audit는 존재하는 journal·receipt와 claim 연결을 비식별 집계하고 합성 HMAC key로 receipt와 off-store inventory checkpoint를 검증할 수 있다. checkpoint 감사는 canonical 검증 시각과 기본 10분 freshness를 강제하지만, checkpoint 없는 기본 audit, 실제 외부 보관·production key custody/rotation·독립 timestamp authority는 여전히 증명하지 않는다.
- 기존 resource가 plan payload와 다르거나 같은 operation이 다른 전체 plan checksum으로 재사용되면 update하지 않고 안정 오류 코드로 전체 transaction을 중단한다.
- assembly·session·discussion topic은 payload·부모·기관뿐 아니라 서버 생성 상태 `draft`까지 일치해야 하며, 이미 활성화되거나 열린 resource를 새 설계의 성공 또는 replay로 채택하지 않는다.
- post-apply verifier는 8개 제약을 이름만 세지 않고 정확한 table·종류·canonical definition으로 대조해 shadow 제약과 완화된 check 식을 거부한다.
- post-apply verifier는 21개 필수 column의 type·nullable·default와 session/ledger의 3개 FK 참조 정의도 exact 대조해 이름만 같은 비호환 schema를 거부한다.
- post-apply verifier는 canonical JSON·SHA-256·join-code 내부 helper가 public·anon·authenticated·service_role 중 하나에라도 EXECUTE로 재노출되면 적용 증거를 거부한다.
- post-apply verifier는 ledger table의 7개 PostgreSQL 권한이 public·anon·authenticated·service_role 중 하나에라도 재노출되면 RLS 상태와 무관하게 적용 증거를 거부한다.
- 같은 기관의 동시 mutation plan은 source 검증 뒤 transaction advisory lock으로 직렬화해 exact plan 경쟁을 `applied`와 `replayed`로 수렴시킨다.
- plan 내부의 operation ID와 resource ref는 각각 유일해야 하며 중복 plan은 lookup·mutation 전에 거부한다.
- plan과 reconciliation query의 boolean·number·string JSON 타입을 exact 검사해 문자열로 바꾼 self-resealed 입력을 거부한다.
- RPC가 client verifier와 같은 session/topic/team 순서·ordinal·달력 날짜·text·prompt 유일성·team 이름·세션 정원·생성 항목 상한을 재검증한다.
- join code는 비암호학적 `random()` 대신 `pgcrypto` CSPRNG와 rejection sampling으로 생성하며 ledger·일반 오류에는 기록하지 않는다.
- join code를 다시 반환하는 mutation replay와 read-only reconciliation은 team의 active 상태를 재확인하며 disabled resource는 안정 충돌 오류로 닫는다.
- production 경로는 여전히 비활성 상태이며 별도 적용 승인이 필요하다.
