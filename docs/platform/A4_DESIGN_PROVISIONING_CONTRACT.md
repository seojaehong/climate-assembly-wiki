# A4 설계 프로비저닝 서버 계약 제안서

상태: **migration 초안 작성 승인(2026-08-25), production 적용 미승인**
작성 기준: 2026-08-25
적용 여부: `false` — 저장소의 SQL 초안·rollback·검증 묶음만 승인되었으며 production DB, Auth, membership, GRANT, adapter는 변경하지 않는다.

## 1. 목적

설계 화면의 schema v4 청사진을 `assembly → session → discussion_topic / team`으로 저장할 때 필요한 서버 계약을 먼저 고정한다. 현재 `platform-design-provisioning-plan.mjs`는 로컬 dry-run 계획만 만들며 항상 `readyForExecution:false`다. 이 문서는 그 상태를 해제하기 위한 승인 대상을 설명할 뿐 실행 권한을 부여하지 않는다.

## 2. 현재 저장소와 청사진의 차이

| 대상 | 현재 확인된 계약 | A4에 남은 차이 |
| --- | --- | --- |
| `assembly` | 추적 migration에 slug·title·purpose·mode·config·status가 있고 slug가 unique다. | 청사진 필드 저장에는 추가 column이 필요하지 않다. 선택 기관의 `org_id`를 서버가 파생해야 한다. |
| `session` | live base table stub에는 slug·title·config·status가 있으나 생성 migration이 저장소에 없다. 후속 migration은 assembly_id·ordinal·held_on만 추가한다. | title/slug를 포함한 base 계약이 migration-owned source of truth가 아니다. 기존 행 사전 점검과 제약 재확인이 필요하다. |
| `discussion_topic` | session_id·ordinal·prompt·status와 `(session_id, ordinal)` unique가 있다. | plan prompt를 저장할 수 있다. 선택 기관과 부모 session의 org 일치를 서버에서 강제해야 한다. |
| `team` | session_id·name·6자리 unique join_code·capacity·status가 있다. | plan의 ordinal을 보존할 column/unique key가 없다. `(session_id, name)`도 unique가 아니어서 다른 plan과 안정적으로 대조할 수 없다. |
| 멱등 실행 | 없음 | 응답 유실 뒤 같은 plan을 재요청했을 때 중복 생성과 다른 payload의 operation ID 재사용을 막을 ledger가 필요하다. |
| 설계 RPC | 없음 | 청사진·plan을 검증하고 기관을 서버에서 파생해 한 transaction으로 저장할 staff 전용 RPC가 필요하다. |

초안 작성 승인 뒤 실행 계획의 현재 blocker 정본은 다음 다섯 가지다.

1. `approval.production_apply_not_granted`
2. `schema.design_provisioning_migration_not_applied`
3. `server.design_provisioning_rpc_not_activated`
4. `server.idempotent_operation_ledger_not_activated`
5. `team.join_code_generation_not_activated`

## 3. 권장 계약

### 3-1. session base 계약

- 기존 live table을 새로 만들지 않고, 승인된 migration이 `session`의 필수 column과 제약을 명시적으로 재확인한다.
- 필수 저장값은 `id`, `slug`, `title`, `status`, `assembly_id`, `ordinal`, `held_on`, `org_id`다.
- slug는 기존 전역 unique 계약을 유지한다. assembly별 중복 허용으로 바꾸는 것은 기존 URL·조회 계약 변경이므로 이 제안 범위에 넣지 않는다.
- title·slug·assembly_id·ordinal·held_on·org_id를 NOT NULL로 바꾸기 전 count-only preflight와 승인된 backfill이 필요하다. 기존 행을 자동 추정해 채우지 않는다.
- `(assembly_id, ordinal)` unique를 추가해 한 공론화 안에서 회차 순서를 안정적으로 식별한다.
- preflight는 `readyForAdditiveMigration`과 `readyForActivation`을 분리한다. 전자는 nullable column·검증 가능한 제약을 추가할 수 있다는 뜻이고, 후자는 session 필수값과 team ordinal mapping·부모/org 일치가 모두 끝나 RPC를 열 수 있다는 뜻이다. 어느 값도 production 적용 승인을 대신하지 않는다.

### 3-2. team 안정 식별자

- `team.ordinal integer`를 추가하고 `(session_id, ordinal)`을 unique로 둔다.
- `name`은 표시값이며 식별자로 사용하지 않는다. 현재 청사진의 표준 이름은 `${ordinal}조`지만 향후 표시명 변경이 identity를 바꾸면 안 된다.
- `plannedCapacity`는 기존 `team.capacity`에 매핑하고 양의 정수 제약을 검증한다.
- 기존 team 행의 ordinal은 사용자 승인된 mapping 없이 이름에서 자동 추출하지 않는다.
- 기존 team 행이 있다는 사실만으로 additive migration을 막지는 않는다. migration 뒤 해당 행은 ordinal `NULL`로 남고, 승인된 mapping을 적용해 `teamOrdinalNullCount=0`이 되기 전에는 activation readiness가 false다.

### 3-3. 멱등 operation ledger

- ledger는 최소 `org_id`, `operation_id`, `plan_checksum`, `operation_type`, `request_hash`, 원 청사진의 `source_blueprint_sha256`·`source_blueprint_bytes`, production-bound 실행의 `approval_id`·`execution_id`·`approved_plan_checksum`·`authorization_revision`, `resource_id`, `applied_at`을 보존한다. 원문 bytes 자체는 저장하지 않는다. 실행 binding 4개 field는 모두 `NULL`이거나 모두 채워져야 하며 부분 binding은 named constraint로 거부한다. 권한이 회수된 2-인자 low-level core는 격리 semantic rehearsal 호환을 위해 unbound ledger를 만들 수 있지만, 3-인자 fenced wrapper는 같은 transaction에서 모든 operation을 exact binding한 뒤에만 반환하고 이미 다른 execution/approval/revision에 결속된 replay를 거부한다.
- `operation_id`는 현재 plan의 64자 SHA-256이고 primary key 또는 동등한 unique key여야 한다.
- 같은 operation ID·request hash·operation type·전체 plan checksum이 모두 같은 exact replay만 기존 resource를 반환한다. assembly·session·discussion topic은 서버가 생성하는 `draft`, team은 `active` 상태까지 payload·부모·기관과 함께 exact 대조한다. 이미 활성화·종료·보관된 resource를 새 설계가 채택하거나 replay하지 않는다. 다른 plan이 이전 operation을 부분 재사용하면 ledger의 plan checksum과 이후 reconciliation이 어긋나므로 mutation 전에 충돌로 중단한다.
- 같은 operation ID에 다른 request hash가 오면 mutation 전에 실패한다.
- ledger와 대상 행은 같은 transaction에서 기록한다. 대상 INSERT만 성공하거나 ledger만 성공하는 부분 상태를 허용하지 않는다.
- checksum·source 검증을 마친 mutation RPC는 첫 ledger/resource lookup 전에 기관 ID에서 파생한 transaction advisory lock을 잡아 같은 기관의 plan 실행을 직렬화한다. 동시 exact plan은 하나가 `applied`, 다른 하나가 lock 대기 뒤 `replayed`로 수렴하며 hash 충돌은 다른 기관 실행을 불필요하게 직렬화할 뿐 격리나 정합성을 약화하지 않는다.
- ledger·receipt에는 청사진 원문, join code, 이메일, Auth UUID를 기록하지 않는다.
- ledger table은 public·anon·authenticated·service_role에 `SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER` 어떤 권한도 노출하지 않는다. Post-apply verifier는 4개 역할과 7개 table privilege의 28개 effective 조합을 전수 대조하며 RLS 활성화만으로 직접 table 권한 회수를 대신하지 않는다.
- PostgreSQL의 column-level `SELECT|INSERT|UPDATE|REFERENCES`는 table-level privilege와 별도로 부여될 수 있으므로 ledger의 어떤 column에도 노출하지 않는다. Post-apply verifier는 같은 4개 역할과 4개 column privilege의 16개 effective 조합을 `has_any_column_privilege`로 별도 대조한다.

### 3-4. design provisioning RPC

- 권장 형태는 plan 전체를 한 transaction에서 처리하는 staff 전용 RPC다. operation별 공개 RPC는 부분 성공 복구 부담 때문에 채택하지 않는다.
- RPC는 `org_id`를 인자로 받지 않는다. 현재 Auth 사용자와 P1C 선택 context에서 `org_of_uid()`가 검증한 기관을 서버가 파생한다.
- 허용 역할은 `org_admin`과 `hq`로 제한하고 활성 membership·활성 org를 매 요청 확인한다. 최소 root JSON 형상 확인 직후 이 권한 판정을 먼저 수행해 권한 없는 호출이 checksum·source digest나 대규모 operation 배열 검증 비용을 유발하지 못하게 한다. mutation RPC는 검증에 사용한 membership과 organization 행을 `FOR SHARE`로 transaction 종료까지 잠가, plan 실행 중 역할 회수·membership 취소·기관 비활성화 update가 먼저 commit되어 권한 판정과 mutation 결과가 갈라지지 않게 한다. 권한 변경 transaction이 먼저 잠금을 획득했다면 RPC는 갱신 뒤 행을 재평가해 거부해야 한다.
- 입력은 field 이름뿐 아니라 boolean·number·string의 JSON 타입까지 exact schema/version으로 검증하고, plan checksum, 원 청사진 bytes의 길이·SHA-256, operation 순서, parent reference, operation ID를 다시 검증한다. 숫자나 실행 플래그를 문자열로 바꾼 self-resealed 입력은 거부한다. operation ID와 resource ref는 plan 안에서 각각 유일해야 하며, 중복은 어떤 lookup이나 mutation보다 먼저 거부한다. 원 bytes는 검증 중에만 사용하며 ledger·receipt에 저장하지 않는다.
- operation grammar는 assembly 1건 뒤 session을 연속 ordinal로 처리하고, 각 session 안에서 연속 topic 뒤 연속 team을 처리한다. 실제 달력 날짜와 session 날짜 비감소, canonical text, session별 topic prompt 유일성, `${ordinal}조` team 이름, topic·team 각 1건 이상, session 누적 정원 100,000명과 전체 생성 항목 10,000건 상한을 client verifier와 RPC가 함께 검증한다.
- assembly slug, session slug, session/topic/team ordinal을 lookup-before-mutation 방식으로 대조한다. 기존 값이 기대 payload와 다르면 update로 덮지 않고 충돌로 중단한다.
- 모든 operation이 성공한 경우에만 commit한다. 오류는 원문·join code·credential을 포함하지 않는 안정 error code로 반환한다.
- 성공 응답은 생성/재사용 resource ID, operation 상태, count와 plan checksum을 포함하되 원 청사진 본문은 반복하지 않는다.

### 3-5. join code 생성과 복구

- join code는 client plan에 넣지 않고 server transaction 안에서 `pgcrypto` CSPRNG로 생성한다. 32-bit 값을 6자리 공간에 바로 나눈 나머지를 쓰지 않고, 균등하게 나누어지는 상한 밖 값을 버리는 rejection sampling으로 modulo bias를 제거한다. PostgreSQL `random()`은 capability 생성에 사용하지 않는다.
- 기존 6자리 숫자·unique 계약을 유지한다. 충돌은 제한된 횟수만 재시도하고 소진되면 전체 transaction을 실패시킨다.
- 같은 operation ID의 응답 유실 재요청은 ledger가 가리키는 기존 active team의 동일 code를 현재 승인된 기관 staff에게만 다시 반환한다. team이 disabled 상태면 mutation replay와 read-only reconciliation 모두 안정 충돌 오류로 중단하고 code를 반환하지 않는다.
- code는 audit log·ledger·일반 오류·CI artifact에 기록하지 않는다. UI에서도 필요 시에만 제공하고 브라우저 영구저장소에 보존하지 않는다.

### 3-6. rollback 데이터 보존

- ledger 행이나 non-null `team.ordinal`이 하나라도 있으면 기본 rollback은 어떤 객체도 제거하기 전에 전체 transaction을 거부한다.
- 실제 프로비저닝 뒤의 rollback은 ledger 감사기록과 생성 resource·team ordinal mapping을 보존하거나 export하는 별도 데이터 계획과 사용자 승인이 필요하다.
- CI cleanup fixture는 `verify` 데이터베이스와 명시적 throwaway flag에서만 정해진 synthetic ID·slug를 제거한다. production rollback 절차가 아니다.

### 3-7. 실행 승인 artifact와 one-time claim

- 실행 승인은 schema v1 `platform_design_provisioning_execution_approval` artifact로 고정한다. artifact는 exact plan checksum, 원 청사진 byte SHA-256·길이, operation count, approval/execution ID, 대상 organization UUID·host, canonical Auth reviewer, 승인 역할, 발급·만료 시각과 key ID를 외부 HMAC key로 결속한다.
- 승인 역할은 `org_admin|hq`만 허용한다. 현재 schema v1은 승인자와 실제 실행자를 같은 canonical Auth 사용자·역할로 결속한다. artifact의 역할은 발급 당시 판단 기록이며 현재 membership 증거가 아니므로, 실제 adapter는 mutation 직전에 active membership과 선택 기관을 다시 검증해야 한다. 향후 2인 승인 또는 실행 위임은 기존 필드의 느슨한 해석이 아니라 새 schema로 결정한다.
- 유효기간은 trusted runner UTC 기준 최대 15분이다. 미래 발급, 만료, 비canonical 시각, 다른 key ID, source/plan 변경, digest 변조를 모두 거부한다.
- 취소와 재사용 방지는 서명 파일만으로 해결하지 않는다. adapter가 durable approval-state 저장소에서 exact approval ID의 `revokedAt`과 one-time claim을 읽고, 첫 실행 전에 approval ID·execution ID·organization ID·target host·실행 actor·role·plan checksum을 같은 원자 transaction으로 claim해야 한다.
- adapter contract는 `readSnapshot()`에서 approval state와 live Auth/membership/org/host context를 함께 읽고, `claim(expectedSnapshot, claim)`과 `finalize(expectedSnapshot, terminalClaim)`이 두 값을 같은 transaction에서 compare-and-set하도록 요구한다. claim·finalize 응답의 transaction 시점 context도 core가 다시 검증하므로 각 read와 CAS 사이 membership·org 변경은 fail-closed한다.
- production-bound seam은 adapter가 `revisionedLiveAuthorization:true`와 SHA-256 `revision`을 snapshot·claim/finalize 결과에 제공하도록 요구한다. 새 claim은 이 값을 `authorizationRevision`에 결속하고 execution 직전, receipt 봉인 전, reconciliation, finalize에서 현재 revision과 계속 대조한다. Membership·organization이 비활성화됐다가 동일한 active boolean·actor·role로 돌아오는 ABA도 revision이 달라지므로 RPC 재호출·receipt·terminal state 없이 열린 claim으로 남는다.
- production-bound execution adapter는 `revisionFencedExecution:true`, status adapter는 `revisionFencedReconciliation:true`를 선언해야 한다. Core는 RPC 또는 ledger lookup 직전에 검증한 approval/execution ID, approved review plan checksum과 `authorizationRevision`을 exact `platform_design_provisioning_authorization_fence`로 전달하고, adapter 응답이 같은 revision을 되돌릴 때만 결과를 receipt 후보로 처리한다. Capability 누락은 authorization·receipt·key-registry read 전에 거부하고, 다른 revision 응답은 receipt와 terminal state 없이 claim을 열린 상태로 둔다. 휴면 migration 초안의 3-인자 mutation overload와 2-인자 reconciliation overload는 이 exact fence를 받아 현재 revision을 대조하고 응답에 되돌린다. Mutation overload는 실행된 모든 ledger operation에 fence identity/checksum/revision을 원자 결속한다. Reconciliation overload는 fence의 approval/execution ID와 approved checksum이 조회 조건과 정확히 일치하고, ledger binding도 같은 값일 때만 복구한다.
- `createSupabaseDesignProvisioningRpcAdapters()`는 이미 인증된 Supabase client를 주입받아 위 두 fenced overload만 호출하는 비활성 production-bound adapter 초안이다. 환경변수·URL·key를 읽거나 client를 생성하지 않고, contract와 같은 최대 1,000,000 source bytes를 PostgreSQL hex `bytea`로 직렬화하며, 20초 abort signal과 명시적 무재시도, exact RPC 이름·인자, query/fence identity, 응답 revision을 강제한다. Sparse·비JSON·과대 payload와 Supabase 원시 오류·throw 값은 client 접근 전 거부하거나 안정 오류로 치환한다. SQL fence의 UUID v4 제약은 production-bound lifecycle도 authorization/receipt state read와 claim 전에 동일하게 강제한다. 현재 lockfile의 실제 Supabase JS client와 custom fetch를 연결한 격리 통합 테스트는 두 RPC의 `/rest/v1/rpc/*` POST 경로, `Content-Profile: climate_vote`, JSON body·hex `bytea`, abort signal을 확인하고 HTTP 503도 재시도 없이 한 번만 호출한 뒤 원시 오류를 숨긴다. Factory 생성 자체는 RPC를 호출하지 않으며 실제 Auth session·authorization CAS adapter·receipt store·key custody·RPC GRANT·wiring은 제공하지 않는다.
- 휴면 `platform_design_authorization_revision()`은 현재 Auth 사용자·기관과 active `org_admin|hq` membership 집합, org/membership PostgreSQL row version을 정렬해 SHA-256 revision으로 만든다. mutation·fenced reconciliation overload는 권한 행을 `FOR SHARE`로 transaction 종료까지 잠근 뒤 revision을 앞뒤로 대조해 취소 후 같은 역할로 돌아온 ABA도 과거 fence 재사용으로 보지 않는다. 이 revision은 짧은 실행 창의 live fencing token이지 durable 감사 ID가 아니며 dump/restore·row rewrite 뒤 보존을 약속하지 않는다. 내부 helper `platform_json_canonical(jsonb)`, `platform_sha256_hex(text)`, `platform_design_join_code()`, `platform_design_authorization_revision()`과 두 fenced overload는 public/anon/authenticated/service_role 모두 권한이 회수된 초안이다. Post-apply verifier는 각 helper와 역할의 effective EXECUTE를 전수 대조하며 하나라도 재노출되면 적용 증거를 거부한다.
- 왕복 검증에 성공한 production-bound 경로만 execution receipt에 `authorizationRevision`을 추가하고 HMAC으로 결속한다. 재시작·response-loss 복구는 현재 live snapshot/claim revision과 receipt revision이 exact 일치할 때만 terminal finalize를 허용한다. Revision 필드가 없는 legacy receipt와 다른 revision으로 유효하게 서명된 receipt는 RPC를 재호출하지 않되 claim을 열린 상태로 보존하며 거부한다. 저수준 legacy receipt schema v1 검증은 기존 회귀 호환으로 남지만 production-bound wrapper의 복구 증거로 승격되지 않는다.
- `createInMemoryRevisionedDesignProvisioningAuthorizationProvider()`는 context 전이마다 revision을 바꾸고 stale expected revision을 CAS conflict로 반환하는 test double이다. `executeDesignProvisioningApprovalLifecycleWithRevisionedAuthorization()`과 reconciliation 대응 wrapper는 revision capability가 없는 adapter를 side effect 전에 거부한다. Key registry와 결합한 wrapper도 revision gate를 key read 전에 적용한다. 이는 interface 회귀일 뿐 live Supabase membership row version, transaction adapter 또는 authoritative revocation source가 아니다.
- claim이 없으면 순수 verifier는 `claim_required`만 반환한다. 같은 approval/execution/organization/host/actor/role/plan의 진행 중 claim만 `resume_existing_claim`으로 복구할 수 있다. 기본 verifier와 새 claim은 `completed|failed`를 소비된 상태로 거부한다. 이미 유효 시간 안에 시작된 claim의 종료 기록은 승인 만료 뒤에도 허용하되 `finalizedAt >= claimedAt`인 같은 terminal outcome만 `existing|reconciled`로 복구하고, 역행하는 종료시각·반대 outcome 덮어쓰기·terminal state 재-claim은 거부한다.
- 현재 저장소의 `sealDesignProvisioningExecutionApproval()`과 `verifyDesignProvisioningExecutionApproval()`은 artifact/state를 검증하고, `claimDesignProvisioningExecutionApproval()`과 `finalizeDesignProvisioningExecutionApproval()`은 injected adapter의 snapshot/CAS 응답을 검증한다. Legacy in-memory adapter는 순수 core 동시 claim·finalize, response-loss·충돌 테스트 호환으로 남지만 production-bound wrapper는 revisioned authorization과 revision-fenced execution/reconciliation adapter를 함께 요구한다. 저장소 밖 로컬 durable rehearsal adapter는 재시작·경쟁·append-only 복구 계약만 증명하며 live Auth 증거 또는 production 신뢰 저장소가 아니다. 결과는 항상 `readyForExecution:false`, `rpcMutationExecuted:false`, `databaseMutationExecuted:false`다. 승인 발급 CLI와 live authorization·receipt·key adapter 조합은 제공하지 않는다.
- `platform-design-provisioning-key-registry.mjs`는 key material을 직접 받는 저수준 approval seal/verifier와 receipt verifier 앞에 주입하는 adapter-independent 정책 wrapper다. Registry entry는 exact key ID·revision과 `active|verify_only|retired`, 활성화 시각, 발급 중단 시각, 검증 종료 시각을 반환한다. 신규 발급은 `active` entry를 읽은 뒤 `authorizeIssuance()`가 같은 revision을 CAS로 승인하고 registry transaction의 `authorizedAt`이 approval 창 안일 때만 봉인한다. 회전이 먼저 revision을 바꾸거나 CAS가 만료 뒤 선형화되면 거부한다. 과거 approval·receipt 검증은 발급시각이 중단 전이고 현재가 검증 종료 전인 `active|verify_only`만 허용하며 `retired`, cutoff 이후 발급·검증, malformed envelope·entry를 key 사용 전에 거부한다. `executeDesignProvisioningApprovalLifecycleWithKeyRegistry()`와 `reconcileDesignProvisioningApprovalLifecycleWithKeyRegistry()`는 registry가 검증한 한 key snapshot을 injected lifecycle 전체에만 전달하고 첫 trusted clock을 정책 검증과 claim/reconciliation 시각에 동일하게 재사용한다. 이후 완료·finalize clock도 같은 snapshot의 검증 종료시각을 다시 통과해야 하므로 cutoff 뒤 receipt를 봉인하지 않고 claim을 열린 상태로 둔다. 직접 `trustedKey|expectedKeyId` 옵션은 거부하며 verify-only key는 승인 만료 뒤 기존 active claim의 명시적 reconciliation을 허용한다. Wrapper는 key를 결과나 오류에 포함하지 않는다. 이는 registry adapter 계약과 합성 key 회귀일 뿐 실제 KMS/HSM·secret manager, key 생성·보관·회전 작업, production adapter 연결 또는 production key custody가 아니다.

### 3-8. 비식별 execution receipt

- 실행 순서는 `approval claim → design RPC → receipt seal·append-only persistence → terminal finalize`다. receipt 저장이 실패하면 claim을 `completed|failed`로 닫지 않고 진행 중으로 남겨 RPC ledger와 receipt 저장소를 먼저 reconciliation한다.
- 성공 receipt는 승인된 review plan에서 operation·source를 그대로 두고 `blockers:[]`, 실행형 boolean만 바꾼 RPC plan checksum을 결정적으로 파생한다. review checksum과 executed checksum을 모두 HMAC에 결속하고, dry-run checksum을 RPC 결과로 재사용하면 거부한다. 이어 RPC의 exact schema, operation count·순서·ID, resource UUID 형식과 team join code 형식을 메모리에서 검증한 뒤 `resourceId`와 `joinCode`를 모두 폐기한다. 영속 대상에는 operation ID·type·`applied|replayed`와 비식별 count만 남긴다.
- 실패 receipt는 저장된 원문 오류가 아니라 `design_*` allowlist 코드와 `rollbackVerified:true`만 허용한다. rollback이 확인되지 않은 응답 유실·미확정 outcome은 receipt나 terminal failure로 봉인하지 않는다.
- schema v1 receipt는 exact approved/executed plan checksum, source SHA, approval/execution ID, key ID, 시작·완료 시각, 성공·실패 요약을 HMAC으로 결속하며 `containsSensitiveValues:false`를 강제한다. `sealDesignProvisioningExecutionReceipt()`과 `verifyDesignProvisioningExecutionReceipt()`은 순수 함수로 RPC 호출·receipt 저장·DB mutation을 수행하지 않는다.
- Revision-fenced schema v1 receipt는 위 필드에 optional SHA-256 `authorizationRevision`을 추가한다. 일반 verifier는 legacy와 revision-bound receipt를 모두 검증하지만 production-bound lifecycle은 expected revision을 필수로 전달해 필드 누락·불일치를 별도 오류로 거부한다. Durable linkage도 claim과 receipt 중 한쪽에만 revision이 있거나 값이 다르면 append/audit를 거부한다.
- `executeDesignProvisioningApprovalLifecycle()`은 injected authorization·execution·receipt adapter만 조율한다. claim 전과 직후 exact execution ID receipt를 조회하고, 이미 검증 가능한 receipt가 있으면 RPC를 건너뛴 뒤 같은 terminal outcome으로 finalize한다. `claimDisposition:new`을 받은 단 하나의 호출만 RPC 후보가 되며, receipt가 없음을 확인한 뒤 authorization snapshot을 다시 읽어 active membership·organization·actor·role·host와 같은 in-flight claim을 검증해야만 execution adapter를 호출한다. 이 재조회에서 context가 비활성화되거나 claim identity가 달라지면 receipt 없이 claim을 열린 상태로 두고 RPC를 호출하지 않는다. production RPC 자체의 transaction 안 live membership 검증은 여전히 별도 필수 경계이며 이 orchestration 재조회가 이를 대체하지 않는다. 기존·reconciled claim에 receipt가 없으면 미확정 outcome으로 보고 자동 재호출하지 않고 명시적 reconciliation을 요구한다. 새 RPC 결과는 봉인·append 뒤 같은 execution ID를 다시 조회해 exact HMAC receipt가 관찰될 때만 finalize한다. adapter 종류와 무관하게 trusted finalization clock은 `receipt.completedAt` 이상이어야 하며, 더 이른 clock이면 receipt를 보존하고 claim을 열린 상태로 둬 완료시각 이후 replay에서만 종결한다. append 응답 유실 시에도 다음 실행이 저장된 receipt를 복구한다. in-memory receipt adapter는 append-only 충돌과 response-loss·동시 실행 테스트용이며 credential·Supabase·production endpoint를 알지 못한다.
- `reconcileDesignProvisioningApprovalLifecycle()`은 운영자가 명시적으로 호출하는 별도 경로다. 기존 active claim을 먼저 검증하며 새 claim이나 일반 execution adapter를 호출하지 않는다. injected reconciliation adapter에는 mutation RPC로 재사용할 수 있는 실행 plan·원본 bytes 대신 approval/execution ID, approved/executed checksum, source hash·길이, operation ID·type만 담은 비식별 lookup query를 전달한다. adapter는 ledger·operation lookup만 수행해 기존 완료 결과 또는 `pending`을 반환해야 한다. `pending`, lookup 오류, receipt persistence 미확정은 claim을 열린 상태로 유지한다. 완료 결과는 동일한 response 검증·redaction·HMAC receipt·재조회·finalize 절차를 거친다. 유효 시간 안에 시작된 claim은 승인 만료 뒤에도 현재 live actor/org/host 검증을 통과하면 감사 상태를 닫을 수 있다.
- migration 초안의 `design_provisioning_status(jsonb)`는 이 query 전용 `STABLE`·`SECURITY DEFINER` read-only RPC다. 현재 Auth 사용자와 `org_of_uid()` 기관의 active `org_admin|hq`를 재검증하고, 모든 ledger의 approval/execution ID·approved/executed checksum·authorization revision·operation type·원 청사진 SHA-256·byte 길이와 resource org가 일치할 때만 기존 resource와 team join code를 메모리 응답으로 복원한다. operation 하나라도 없으면 `pending`, unbound ledger나 identity/checksum/revision/resource/source evidence가 충돌하면 안정 오류로 끝난다. public/anon/authenticated/service_role EXECUTE는 모두 회수되어 있으며 production migration·권한 활성화와 이를 호출할 adapter는 아직 제공하지 않는다.

### 3-9. 로컬 durable rehearsal store

- `platform-design-provisioning-durable-store.mjs`는 명시적으로 만든 저장소 밖 빈 디렉터리에만 초기화된다. marker와 모든 journal record boundary는 `authorizationCas:immutable_hard_link_v1`을 결속한다. marker가 없거나 저장소 내부·상대 경로·예상하지 않은 layout이면 쓰기 전에 거부한다.
- authorization state와 고정된 synthetic context는 approval별 immutable hash-chain journal에 기록한다. claim·finalize는 예상 snapshot과 현재 journal tail을 비교한 뒤 다음 sequence record를 hard-link로 원자 게시한다. 같은 tail에서 시작한 동시 경쟁은 동일 filename 중 하나만 생성할 수 있어 lock 없이 하나만 성공하고, 나머지는 최신 journal snapshot conflict로 reconciliation한다.
- 같은 expected snapshot을 읽은 독립 Node 프로세스 6개를 동시에 실행한 rehearsal에서도 `claimed` 하나와 `conflict` 다섯 개, 초기 record를 포함한 연속 journal 2개로 수렴해야 한다.
- `auditLocalDesignProvisioningRehearsalStore()`는 marker가 있는 현재 store를 변경하지 않고 root layout, 존재하는 모든 approval journal의 연속 sequence·hash chain·semantic state, 모든 receipt의 schema·filename·현재 claim 연결을 검사한다. 결과는 approval/execution/Auth 식별값 없이 상태별 건수와 orphan temp 건수만 반환하고 `containsSensitiveValues:false`를 고정한다.
- 기본 audit는 key를 읽지 않아 `receiptSignatureVerified:false`다. 호출자가 32자 이상 합성 HMAC key와 exact key ID를 함께 직접 주입하면 모든 현재 receipt의 canonical payload digest를 상수시간 비교하고, 하나라도 다른 key ID·digest면 식별값 없이 거부한다. receipt가 0개면 key를 제공해도 서명 검증 증거가 없으므로 계속 `false`다.
- `sealLocalDesignProvisioningRehearsalStoreCheckpoint()`는 현재 approval ID·journal record 수·tail hash와 receipt approval/execution ID·digest를 메모리 안 canonical inventory로만 구성하고, store 밖 보관용 checkpoint에는 key ID·생성시각·비식별 건수·HMAC만 반환한다. 생성시각은 현재 state와 receipt에서 관찰되는 `claimedAt|finalizedAt|revokedAt|startedAt|completedAt` 중 가장 늦은 시각보다 빠를 수 없으며 store 파일은 변경하지 않는다.
- audit에 checkpoint·합성 key·exact key ID·canonical 검증 시각을 모두 주입하면 현재 inventory와 checkpoint HMAC을 상수시간 비교하고, checkpoint 생성시각이 현재 관찰 가능한 사건보다 앞서지 않는지와 기본 10분 freshness를 함께 검사한다. approval 디렉터리 삭제, journal tail 추가/제거, receipt 변경, checkpoint 변조, 사건시각보다 과거인 legacy checkpoint, 검증 시각 누락, 10분 초과와 미래 checkpoint를 거부하며 exact inventory와 두 시간 경계가 모두 맞을 때만 `catalogCompletenessVerified:true`, `checkpointFreshnessVerified:true`다. checkpoint가 없으면 둘 다 `false`다. 최대 나이 override는 양의 정수 24시간 이하만 허용한다.
- `initializeLocalDesignProvisioningCheckpointAnchorStore()`는 rehearsal store와 repository 밖의 별도 빈 절대경로에 anchor marker와 전용 `checkpoints/`를 만들고, `createLocalDesignProvisioningCheckpointAnchorAdapter()`는 생성시각 해시별 record를 hard-link로 불변 게시한다. 같은 checkpoint 재게시는 `existing`, 같은 생성시각의 다른 checkpoint는 원본을 보존한 conflict다. Record SHA-256과 exact marker/layout 검사는 재시작·직접 변조·symlink/junction 경계를 fail-closed한다.
- `persistLocalDesignProvisioningRehearsalStoreCheckpoint()`는 checkpoint를 seal한 뒤 append 응답만 신뢰하지 않고 같은 생성시각을 다시 읽어 canonical byte 의미가 일치할 때만 성공한다. Append가 저장 뒤 응답을 잃어도 read-back으로 `recovered`가 되며, 저장 누락·다른 bytes·malformed adapter는 성공으로 보고하지 않는다. Key material과 approval/execution 식별값은 anchor record에 저장하지 않는다.
- checkpoint와 분리 anchor는 생성 시점의 exact inventory와 state/receipt에 남은 canonical 사건시각, 주입된 로컬 검증시각 간 계약만 증명한다. 같은 호스트의 로컬 파일시스템 리허설이므로 timestamp가 없는 초기 authorization 생성과 synthetic context 전이의 실제 발생시각, 운영 외부 durable 보관, production key custody·회전 registry 또는 독립 timestamp authority를 구현하지 않으며 anchor 자체의 삭제와 복원된 동일 bytes·생성 전 손상을 구분하지 못한다.
- local revocation transition은 unclaimed approval에만 canonical UTC `revokedAt`을 같은 journal CAS로 기록한다. claim과 revocation이 경쟁하면 둘 중 하나만 journal tail을 차지하며, revocation이 먼저면 restart 뒤 새 claim도 core verifier가 거부한다. active claim을 뒤늦게 revoke해 receipt reconciliation을 영구 차단하는 전이는 허용하지 않는다.
- synthetic authorization context 교체도 expected snapshot과 같은 journal CAS로 기록한다. identity는 바꾸지 않고 `membershipActive|organizationActive`의 `true→false` 무효화만 허용하며 재활성화를 거부해 revision 없는 local snapshot의 ABA 재일치를 막는다. active claim 뒤 비활성화하면 core는 finalize 직전 context를 다시 거부하고 claim은 열린 상태로 남는다. production live provider는 단방향 fixture 대신 별도 row version을 포함한 transaction 격리가 필요하다.
- receipt는 execution ID별 immutable 파일로 게시한다. 같은 HMAC receipt 재append는 `existing`, 다른 receipt는 원본을 보존한 `conflict`이며 restart 뒤에도 같은 결과를 반환한다. adapter는 operation receipt를 다시 구조 검증해 resource UUID·join code·Auth UUID 같은 필드를 영속하지 못하게 하고, 실제 journal claim과 approval/execution/plan/status를 연결하며 `receipt.startedAt >= claim.claimedAt`을 강제한다. 같은 local store에 receipt가 있으면 terminal finalize도 `finalizedAt >= receipt.completedAt`일 때만 허용하고, 직접 복원된 모순 파일은 전체-store audit이 거부한다. local receipt가 없는 terminal claim은 별도 receipt adapter 가능성을 위해 허용하므로 외부 adapter의 원자성은 이 rehearsal이 증명하지 않는다.
- record SHA-256 chain은 손상·불완전 journal 검출용이지 신뢰 경계의 서명이 아니다. 로컬 파일을 수정하고 hash를 다시 계산할 수 있는 사용자를 방어하지 않는다. record publish 전 crash가 남긴 규격화된 temp 파일은 존재하면 owned regular file인지 검사해 집계하고, 다른 publisher가 열거 직후 정상 unlink해 검사 중 사라지면 무시한다. persistent lock 파일은 만들지 않는다.
- 이 adapter는 fixture context와 local revocation만 같은 journal transaction에 보존한다. live Supabase Auth/membership CAS, authoritative revocation source, production key custody, RPC executor/status adapter, 운영 credential을 구현하지 않으며 production adapter로 사용할 수 없다.

## 4. migration 초안 승인 시 필요한 산출물

다음 묶음은 하나의 리뷰 단위로 작성하고, production 적용은 별도 승인으로 남긴다.

1. additive migration 초안과 대응 rollback
2. 기존 session/team의 null·중복·부모/org mismatch를 세는 read-only preflight
3. session/team 제약과 ledger/RPC 권한을 확인하는 post-apply verifier
4. PostgreSQL throwaway stage rehearsal
5. 정상 생성, exact replay, payload 충돌, parent 충돌, join code 충돌 소진, transaction rollback, authorization row-lock 경쟁, RLS/GRANT 음성 테스트
6. plan source, bundle builder, A4 plan·bundle 집중 테스트와 migration/rollback/verifier hash를 결속한 approval bundle
7. 실행 승인 artifact의 role·expiry·revocation·one-time claim·terminal finalization 순수 verifier와 음성 테스트
8. exact RPC response redaction, rollback-verified failure, HMAC execution receipt와 append-response-loss·unknown-outcome·동시 lifecycle test
9. 기존 claim 전용 명시적 reconciliation, pending 보존, 만료 뒤 감사 종결과 adapter 오류 비노출 test
10. 휴면 read-only ledger lookup RPC, checksum·role·resource 검증과 무변경 PostgreSQL rehearsal

post-apply verifier는 column 이름이나 제약 이름만 schema 전체에서 세지 않는다. 21개 필수 column의 정확한 PostgreSQL type·nullable·default, session/ledger의 3개 FK 참조 정의, source evidence와 execution binding 완전성을 포함한 각 named 제약의 대상 table·`check|unique|primary key` 종류와 canonical definition을 함께 대조한다. 잘못된 type·default·FK 누락, 다른 table의 동명 제약이나 완화된 식, 내부 helper의 EXECUTE 또는 ledger table/column privilege 재노출을 적용 증거로 인정하지 않는다. 체크섬 신뢰 경계인 `platform_json_canonical(jsonb)`와 `platform_sha256_hex(text)`는 존재 여부뿐 아니라 정확한 언어·`IMMUTABLE`·`STRICT`·invoker security·고정 `search_path`, canonical object key/array 순서와 SHA-256 known-answer까지 검증한다. Helper body나 설정을 바꿔 plan·operation·authorization revision checksum을 약화한 상태는 post-apply 성공으로 인정하지 않는다.

## 5. 승인 전에 결정할 항목

- team identity를 권장안인 `(session_id, ordinal)`로 확정할지
- session slug의 기존 전역 unique 계약을 유지할지
- plan 전체 단일 transaction RPC를 채택할지
- 생성된 join code를 성공 응답에서 재표시할 수 있는 staff 역할과 UI 수명
- 기존 session/team backfill mapping의 정본 파일과 승인자

## 6. 비범위

- production Supabase 적용
- 기존 행 backfill·NOT NULL 전환
- Auth 계정·membership 생성
- staff GRANT 활성화 또는 traffic open
- 실제 join code 생성
- production plan executor·Supabase adapter 연결
- 승인 발급 CLI, 실제 HMAC key, 운영 외부 durable anchor, production-grade durable revocation/claim·append-only receipt 저장소와 live membership row-version CAS adapter

이 문서 승인만으로 위 항목을 실행하지 않는다. migration 초안 작성 승인과 production 적용 승인은 분리한다.
