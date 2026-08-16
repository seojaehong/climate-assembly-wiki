# 플랫폼 프로덕션 프로비저닝 런북 (턴키)

로컬 HTTP E2E(`supabase/verify/e2e_http.md`)로 스키마·RLS·검수/공개 파이프라인·G2가 실 전송에서 검증됨. 실제 Supabase 프로젝트에 올리는 절차. **8/29 라이브(labor_money)와 별개 프로젝트 권장**(격리).

## 0. 결정 선행 (플랜 §5 — 이것부터)
- [ ] 전용 Supabase 프로젝트 신설 vs 기존 labor_money에 additive (권장: **신설** — 격리·소재지·헤드룸)
- [ ] Supabase Auth 도입 범위: 운영자·기관관리자만(권장) / 진행자까지
- [ ] HQ 공유비밀 → membership 인증 전환(Phase 2 선행조건, G2 최종형)

## 1. 스키마 적용 (SQL Editor, 순서·통째)
1. `platform_p1_tenancy.sql` — org·membership·invitation·org_id·헬퍼·RLS
2. `platform_p1c_org_selection.sql` — 다중 소속의 탭별 기관 선택 컨텍스트·`my_orgs`·`org_select`·선택 범위 RLS. **2026-08-17 사용자 승인된 설계 초안이며 별도 production 적용 승인 전 실행 금지**
3. `platform_p2_analysis_review.sql` — issue·result_page·검수/공개 RPC
4. (데이터 있으면) `platform_p1b_backfill.sql` — 기본 org backfill + NOT NULL(G3)

`platform_p1c_org_selection_activation.sql`은 위 스키마 순서에 포함되지 않는 **별도 권한 활성화 초안**이다. 아래 읽기 전용 preflight·Auth 프로비저닝·사용자의 권한 활성화 승인 전에는 실행하지 않는다.

`platform_p1c_activation_preflight.sql`도 기본 migration chain에 포함되지 않는 **별도 읽기 전용 초안**이다. P1·P1C·P2 스키마가 모두 있는 상태에서만 적용한다. 적용하면 `service_role`만 실행할 수 있는 `platform_activation_preflight()`가 추가되며 원시 행이 아닌 비식별 count/blocker만 한 SQL snapshot에서 반환한다. 이 함수 초안의 production 적용도 별도 DB 승인 전에는 수행하지 않는다.

별도 승인으로 초안을 적용한 직후에는 `psql ... -f supabase/verify/activation_preflight_post_apply.sql`을 실행한다. 이 읽기 전용 verifier는 함수 volatility·보안 속성·고정 설정·service-role 단독 권한과 실제 report의 exact envelope·12개 표 순서·합계·blocker·비식별 경계를 확인한다. verifier 통과는 함수 계약 증거일 뿐 readiness 또는 권한 활성화 승인이 아니다.

### 1-1. A1·A2 활성화 전 읽기 전용 점검

`platform_p1b_backfill.sql` 또는 staff용 GRANT를 실행하기 전에 현재 데이터 준비도를 비식별 집계로 확인한다.

```powershell
cd automation
npm.cmd run preflight:platform-activation
```

- 입력은 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`(또는 `SUPABASE_SERVICE_ROLE`)다. Auth 세션은 저장하지 않고, 원시 custom-schema SELECT 대신 service-role 전용 count-only RPC만 호출한다.
- 12개 NOT NULL 대상 테이블의 전체 행·`org_id IS NULL` 건수와 assembly→session→topic→하위 행의 권위 있는 조직 경로 일치 여부를 점검한다. 활성 조직별 `org_admin`·`hq` 커버리지, 활성 membership의 활성 조직 귀속, 다중 조직 활성 사용자, membership이 가리키는 이메일 확인 완료·비익명 Supabase Auth 사용자의 존재·비활성 여부, 만료 전 HQ 세션의 활성 조직 바인딩도 확인한다.
- 출력은 집계와 blocker 코드만 포함하며 조직·사용자 UUID, 토큰, 원문을 포함하지 않는다. `databaseMutationExecuted`는 항상 `false`다.
- 종료 상태는 `ready`만 성공이다. `not_ready`는 실제 데이터 blocker, `not_verified`는 읽기 증거 자체가 불완전한 상태다. 두 상태 모두 활성화를 중단한다.
- 현재 프로덕션에는 count-only RPC 초안을 적용하지 않아 실측 결과가 `not_verified / read_access_unavailable`이다. 이를 우회하려고 원시 테이블 GRANT를 추가하지 않는다.
- RPC 적용 후의 진단은 읽기 전용 `STABLE` 함수가 호출 statement 시작 snapshot과 `statement_timestamp()`를 공유해 계산하지만, 진단 직후 데이터 변경까지 막지는 않는다. 승인된 활성화 직전 쓰기를 잠시 멈춘 상태에서 다시 실행하고 freshness 검증을 통과해야 한다.
- `ready` 결과는 `ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY`(32자 이상)와 `ACTIVATION_PREFLIGHT_AUDIT_KEY_ID`가 모두 있을 때만 생성된다. schema v2 approval evidence는 report 전체와 source commit·정확한 스크립트 SHA-256·승인 대상 clean source tree·실행 ID·key ID를 외부 키 기반 HMAC-SHA256으로 결속하며 키는 JSON·stdout·오류에 포함하지 않는다.
- clean source 범위는 preflight CLI와 automation manifest/lockfile, 전체 `supabase/migrations`·`rollbacks`·`verify`다. 이 범위의 tracked 변경이나 untracked 파일이 하나라도 있으면 ready evidence 생성·검증을 모두 거부한다. 활성화와 무관한 working-tree 파일은 이 판정에 섞지 않는다.
- 활성화 직전 아래 검증을 같은 checkout에서 실행한다. 현재 HEAD·스크립트 hash·승인 source clean 상태·대상 host·key ID·HMAC·미래 시각·기본 10분 freshness 중 하나라도 다르면 실패한다. `--max-age-seconds` 완화는 승인 기록이 있을 때만 사용한다.

```powershell
cd automation
npm.cmd run verify:platform-activation -- ..\evaluation\platform-activation-preflight.json --expected-host pleyuknjnprsckssxvrh.supabase.co
```

- HMAC 키는 GitHub secret 한 곳에만 두지 말고 key ID별 외부 보안 저장소에 별도 백업한다. 회전은 활성화를 중단한 상태에서 과거 evidence 검증→새 key ID 발급→새 evidence 생성 순서로 진행하며, 과거 키 폐기는 별도 승인 기록 뒤 수행한다.
- `ready` + 검증 성공도 활성화 행위를 자동 승인하지 않는다. 쓰기 동결 상태의 즉시 재실행 결과와 사용자의 DB·권한 변경 승인이 모두 필요하다.
- 최신 비식별 실행 증거: `evaluation/platform-activation-preflight.json`.

### 1-2. A2 활성화 승인 묶음

`evaluation/platform-a2-activation-bundle.json`은 production 실행 파일이 아니라 승인자가 검토할 read-only dry-run manifest다. P1→P1C→P2 선행 스키마, count-only preflight 설치·검증, fresh ready evidence 생성·검증, staff GRANT 활성화·검증, GRANT 회수·휴면 검증·preflight 제거의 순서와 각 SQL/CLI 바이트 SHA-256을 고정한다.

```powershell
cd automation
npm.cmd run plan:platform-a2-activation -- --output ..\evaluation\platform-a2-activation-bundle.candidate.json
npm.cmd run verify:platform-a2-activation -- ..\evaluation\platform-a2-activation-bundle.json
```

- 생성과 검증은 DB·Auth·환경 credential을 읽지 않으며 `databaseMutationExecuted:false`, `requiresApproval:true`를 유지한다.
- checksum만 다시 계산한 임의 순서 변경도 현재 repo의 정본 source 전체 재구성과 다르면 거부한다.
- 생성은 candidate 파일에 수행해 추적된 승인 묶음을 자동으로 덮어쓰지 않는다. candidate diff를 사람이 검토한 뒤 승인된 변경에만 명시적 `--force`로 추적 파일을 갱신한다.
- 모든 단계는 앞 단계 성공 후에만 진행하며 staff GRANT는 fresh schema v2 ready evidence 검증 뒤에만 허용한다. 실패 시 다음 단계를 실행하지 않는다.
- rollback은 staff GRANT 회수→휴면 verifier→preflight RPC 제거→제거 verifier 순서다. P1C schema 자체를 되돌려야 할 때도 이 rollback을 먼저 완료한다.
- manifest 검증 성공은 production 적용 승인이 아니다. 실제 SQL 실행, Auth 계정·membership 준비, 쓰기 동결과 traffic open은 각각 사용자 승인과 별도 실행 증거가 필요하다.

> Supabase는 pgcrypto가 `extensions`에 있고 search_path에 포함 → 마이그레이션 그대로 동작.
> 적용 검증: anon 키로 `POST /rest/v1/rpc/result_get {"p_token":"0..0"}` → `200 null` = 적용됨.

## 2. Auth 활성화 (staff RLS 경로)
P1의 RLS 정책은 `revoke all from authenticated` 때문에 **휴면**이다. 별도 승인 후 `platform_p1c_org_selection_activation.sql`을 통째로 실행해 schema USAGE, membership SELECT, 5개 staff 테이블의 SELECT·INSERT·UPDATE만 활성화한다. 파일은 단일 transaction이므로 중간 권한 적용이 실패하면 이전 GRANT도 모두 rollback된다.
- P1C는 `my_orgs`·`org_select`의 함수 EXECUTE 정의만 준비하고 schema USAGE와 직접 테이블 권한은 휴면으로 둔다. activation 초안은 별도 권한 활성화 승인 뒤에만 실행하며 DELETE는 허용하지 않는다.
- Supabase Auth로 운영자 계정 생성 → `climate_vote.membership(org_id,user_id,role)` 행 삽입(초대 플로우 `invitation` 활용).
- `auth.uid()`는 Supabase 기본 제공(JWT sub). 우리 정책이 이를 membership과 대조.

### 2-1. 다중 소속 기관 선택

- 한 개 활성 기관에만 소속된 사용자는 선택 없이 해당 기관으로 진입한다.
- 여러 활성 기관에 소속된 사용자는 데이터 트리를 읽기 전에 기관 선택기가 표시된다. URL의 기관 ID만으로는 선택하지 않는다.
- `org_select`는 요청 기관의 활성 membership을 검증한 뒤 opaque UUID를 한 번 발급한다. 브라우저는 이를 현재 탭의 `sessionStorage`에만 저장하고 Supabase 요청의 `x-platform-org-context` 헤더로 보낸다.
- DB에는 토큰 원문 대신 SHA-256만 저장한다. `org_of_uid()`는 헤더 토큰, `auth.uid()`, JWT `session_id`, 활성 membership, 활성 org가 모두 일치할 때만 다중 소속 RLS 범위를 반환한다.
- P1C는 activation grant 전에 assembly/session/topic/submission/ballot 5개 staff table의 RLS를 모두 명시적으로 활성화한다. 특히 기존 `session_tenant_*` policy만 있고 RLS enable이 빠진 legacy `session` table을 이 단계에서 닫는다.
- 선택 컨텍스트는 발급 후 12시간에 만료된다. RLS 조회는 만료된 토큰을 즉시 거부하고, 다음 `org_select` 호출이 만료 행을 정리한다. 활성화 전 운영 시간에 맞춰 이 수명을 다시 승인한다.
- 같은 Auth 세션을 공유하는 여러 탭도 서로 다른 선택 토큰을 사용한다. 로그아웃은 현재 탭의 토큰을 제거한다.
- `session_id`는 Supabase Auth JWT의 필수 세션 식별자다. 공식 계약: [JWT claims](https://supabase.com/docs/guides/auth/jwt-fields), [User sessions](https://supabase.com/docs/guides/auth/sessions).
- `org_context` 수명주기는 승인된 P1C 초안에 포함됐지만 실제 migration 적용과 staff GRANT 활성화는 별도 운영 승인 범위다. service role은 RLS를 우회하므로 사용자 요청 경로에서 사용하지 않는다.
- P1C 적용 직후에는 `psql ... -v expect_staff_grants=off -f supabase/verify/org_selection_post_apply.sql`로 `org_context` 컬럼 타입·NOT NULL·기본값·12시간 수명·PK/FK/check·인덱스, RLS 정책 역할·본문, 함수 실행 속성과 휴면 권한을 읽기 전용 검증한다. 별도 승인된 staff GRANT 뒤에는 같은 파일을 `expect_staff_grants=on`으로 다시 실행한다. 둘 중 하나라도 실패하면 Auth 트래픽을 열지 않는다.
- 활성화 뒤 P1C를 되돌릴 때는 먼저 `supabase/rollbacks/platform_p1c_org_selection_activation_BEFORE.sql`로 직접 테이블 권한을 하나의 transaction으로 회수하고 `expect_staff_grants=off` 검증을 통과시킨다. 그런 다음 `platform_p1c_activation_preflight_BEFORE.sql`로 count-only 함수를 제거하고 `platform_p1c_org_selection_BEFORE.sql`을 실행한다. schema USAGE는 P1C 이전 legacy RPC와 공유될 수 있어 activation rollback이 임의로 회수하지 않는다.

### 2-2. 기관 접근 계획 파일

기관 루트의 `/platform/o/<기관>/access` 화면은 실제 계정이나 권한을 만들지 않는 로컬 사전 점검 도구다. 이메일 초대와 기존 Auth 사용자 UUID의 역할 계획을 추가한 뒤 `계획 검증`을 실행하고 JSON을 내려받는다.

- 허용 역할은 migration 정본과 같은 `org_admin`, `operator`, `hq`, `facilitator`다.
- 파일의 canonical 기관 UUID가 승인 대상 기관과 같은지, 이메일·사용자 UUID·중복 역할이 유효한지 다시 확인한다.
- 내려받은 파일은 같은 기관 접근 화면의 `접근 계획 JSON 불러오기`로 다시 열 수 있다. 현재 기관 ID·표시명, exact schema, 허용 필드·역할, canonical 이메일·UUID, 모든 dry-run 경계를 다시 검증한 뒤에만 편집 초안과 미리보기를 복원한다.
- 다른 기관·변조·알 수 없는 필드·256KiB 초과 파일은 기존 초안을 바꾸지 않고 거부한다. 파일 읽기 중 사용자가 편집하거나 화면을 벗어나면 늦게 끝난 import도 폐기한다.
- `dryRun:true`, `authAccountsCreated:false`, `invitationsSent:false`, `databaseMutationExecuted:false`, `requiresApproval:true`가 하나라도 다르면 적용 자료로 사용하지 않는다.
- 파일에는 이메일과 Auth 사용자 UUID가 포함되므로 승인 담당자에게만 전달하고 공개 저장소·브라우저 저장소에 보관하지 않는다.
- 이 파일은 실행 명령이 아니다. 실제 Auth 계정 생성, invitation/membership 추가, 메일 발송, RLS/GRANT 변경은 별도 사용자 승인과 감사 가능한 서버 작업으로 수행한다.

### 2-3. A3 접근 프로비저닝 계획 검증

`platform-access-provisioning-plan.mjs`는 2-2의 기관 접근 계획을 실제 실행 가능한 쓰기 명령으로 바꾸지 않고, 향후 승인된 executor가 따라야 할 안정 operation ID와 복구 정책을 고정한 read-only 계획으로 변환한다. 입력과 출력에는 이메일 또는 Auth 사용자 UUID가 있으므로 둘 다 저장소·`public/`·공유 evaluation artifact 밖의 승인된 보안 폴더에 둔다.

```powershell
cd automation
$accessPlan = Join-Path $env:LOCALAPPDATA 'climate-assembly-private\organization-access-plan.json'
$provisioningPlan = Join-Path $env:LOCALAPPDATA 'climate-assembly-private\organization-access-provisioning-plan.json'
npm.cmd run plan:platform-access-provisioning -- --source $accessPlan --output $provisioningPlan
npm.cmd run verify:platform-access-provisioning -- $provisioningPlan --source $accessPlan
```

- 생성기는 UI와 같은 추적 contract에서 exact schema·역할·256KiB 한계·dry-run 경계를 읽고, 입력 원문 바이트 SHA-256과 각 작업의 deterministic operation ID를 기록한다.
- verifier는 checksum뿐 아니라 원 접근 계획에서 전체 계획을 다시 생성해 순서·조직·이메일·사용자·역할·실행 정책이 달라진 자체 재봉인 파일도 거부한다.
- 입력·출력 경로가 저장소 내부이거나 symlink/junction을 통해 저장소를 가리키면 실행 전에 거부한다. 기존 출력은 명시적 `--force` 없이는 덮어쓰지 않는다.
- stdout과 오류에는 이메일·사용자 UUID·credential·파일 경로를 싣지 않는다. 계획 파일 자체는 민감한 운영 자료이므로 승인자 외에는 전달하지 않는다.
- 이 명령은 Supabase·Auth·메일·환경 credential에 접근하지 않고 `databaseMutationExecuted:false`를 유지한다.

Executor core는 exact plan 검증 뒤 15분 이내 HMAC 승인(외부 보관 key + key ID + canonical Auth reviewer), stable lookup, 순차 apply, 응답 유실 뒤 조회 reconciliation, 첫 실패 중단, 비식별 receipt 영구화를 강제한다. 자동 mutation retry는 하지 않으며 receipt에는 operation ID·상태·count만 남기고 이메일·사용자 UUID를 넣지 않는다. Receipt 전체도 같은 trusted key와 key ID로 HMAC 결속하고 verifier가 상태별 count·시간 순서·operation ID 중복·plan checksum을 다시 확인한다.

승인 key는 GitHub secret만을 유일한 보관처로 사용하지 않는다. 불변 key ID별로 별도 보안 저장소에 백업하고, 회전할 때는 신규 승인 발급을 멈춘 뒤 진행 중 15분 창과 receipt 검증을 끝내며, 과거 key는 승인된 보존기간 동안 read-only로 유지한다. 폐기에는 영향받는 approval ID·receipt run ID와 승인자를 별도 감사 기록으로 남긴다.

다만 production Supabase/Auth adapter와 CLI 실행 경로는 아직 연결하지 않았다. 특히 현재 `invitation` table에는 `(org_id,email,role)` unique 또는 별도 operation ledger가 없어 응답 유실 뒤 중복 초대·메일을 서버가 확실히 막을 수 없다. 이 멱등 저장 계약, 초대 메일 provider, receipt의 외부 append-only 저장소를 별도 승인·검증하기 전에는 executor core에 production adapter를 주입하거나 계획을 수동 SQL/API 작업 목록으로 사용하지 않는다.

### 2-4. A4 설계 프로비저닝 계획 검증

`platform-design-provisioning-plan.mjs`는 설계 화면에서 내려받은 schema v4 청사진을 DB 명령으로 실행하지 않고, 향후 승인된 서버 계약이 소비할 assembly→session→topic/team 순서의 결정적 작업 계획으로 변환한다. 입력과 출력은 source prompt와 운영 목적을 포함하므로 저장소·`public/` 밖의 승인된 로컬 폴더에 둔다.

```powershell
cd automation
$blueprint = Join-Path $env:LOCALAPPDATA 'climate-assembly-private\platform-design-blueprint.json'
$designPlan = Join-Path $env:LOCALAPPDATA 'climate-assembly-private\platform-design-provisioning-plan.json'
npm.cmd run plan:platform-design-provisioning -- --source $blueprint --output $designPlan
npm.cmd run verify:platform-design-provisioning -- $designPlan --source $blueprint
```

- UI와 CLI는 `design-blueprint-contract.json`의 schema version, 운영 방식, 준비도 vocabulary, slug와 크기 한계, dry-run 경계를 함께 사용한다.
- 생성기는 exact source byte SHA-256과 assembly/session/topic/team별 stable operation ID, parent reference, 합계를 기록한다. verifier는 checksum뿐 아니라 원 청사진에서 전체 계획을 다시 생성해 순서·본문·계층·정원·정책이 바뀐 자체 재봉인 파일도 거부한다.
- 계획은 항상 `readyForExecution:false`, `serverContractImplemented:false`, `databaseMutationExecuted:false`다. 실행 CLI나 Supabase adapter는 제공하지 않는다.
- 현재 blocker는 회차 title/slug 저장 schema 미승인, design provisioning RPC 미구현, idempotent operation ledger 미구현, team join code 생성 계약 미승인이다. 네 항목이 migration·rollback·stage rehearsal·권한 테스트와 함께 별도 승인되기 전에는 이 plan을 SQL/API 작업 목록으로 사용하지 않는다.
- 입력·출력 경로가 symlink/junction을 포함해 저장소를 가리키면 거부하며, 기존 출력은 명시적 `--force` 없이는 덮어쓰지 않는다. 오류에는 청사진 원문이나 파일 경로를 싣지 않는다.

## 3. 프론트 배포
- `/platform/*`·`/r/*` 라우트는 정적 빌드 + 클라이언트 라우팅. **딥링크 새로고침** 위해 Cloudflare Pages SPA fallback rewrite 필요:
  - `_redirects`에 `/platform/* /platform/app/index.html 200`, `/r/* /r/[token] 200` (또는 SSR 어댑터 도입).
- `PUBLIC_SUPABASE_URL`·`PUBLIC_SUPABASE_ANON_KEY`를 신 프로젝트 값으로.

## 4. G2 최종형 (Phase 2)
현재 `result_publish`는 attendance HQ 토큰(공유비밀 유래) 서명. Phase 2에서:
- HQ 토큰 발급을 membership(role in hq/org_admin) 인증으로 교체.
- `attendance_auth_session.org_id`를 membership에서 채워 `result_publish`의 org 일치 검사 활성.

## 5. 라이브 E2E (프로비저닝 후)
`supabase/verify/e2e_http.md`의 8단계를 **실 프로젝트 anon 키 + Auth JWT**로 재현. 전부 통과하면 런칭 가능.

## 남은 하드 게이트
- **G3**(NOT NULL): `platform_p1b_backfill.sql` = 단일 테넌트 가정. 다중 org 도입 시 org별 재배치 후 적용.
- 분석코어 어댑터(consensus/DQI → issue, service_role): 8/29 산출물로 첫 실전.
- 설계 마법사(Phase 3): assembly/session/topic 생성 UI(§5-4 결정 시).
