# A4 설계 프로비저닝 서버 계약 제안서

상태: **승인 전 제안**
작성 기준: 2026-08-17
적용 여부: `false` — SQL migration, RPC, adapter, production 데이터 변경을 포함하지 않는다.

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

이에 따라 현재 blocker 정본은 다음 다섯 가지다.

1. `schema.session_base_contract_not_migration_owned`
2. `schema.team_stable_identity_not_approved`
3. `server.design_provisioning_rpc_not_implemented`
4. `server.idempotent_operation_ledger_not_implemented`
5. `team.join_code_generation_contract_not_approved`

## 3. 권장 계약

### 3-1. session base 계약

- 기존 live table을 새로 만들지 않고, 승인된 migration이 `session`의 필수 column과 제약을 명시적으로 재확인한다.
- 필수 저장값은 `id`, `slug`, `title`, `status`, `assembly_id`, `ordinal`, `held_on`, `org_id`다.
- slug는 기존 전역 unique 계약을 유지한다. assembly별 중복 허용으로 바꾸는 것은 기존 URL·조회 계약 변경이므로 이 제안 범위에 넣지 않는다.
- title·slug·assembly_id·ordinal·held_on·org_id를 NOT NULL로 바꾸기 전 count-only preflight와 승인된 backfill이 필요하다. 기존 행을 자동 추정해 채우지 않는다.
- `(assembly_id, ordinal)` unique를 추가해 한 공론화 안에서 회차 순서를 안정적으로 식별한다.

### 3-2. team 안정 식별자

- `team.ordinal integer`를 추가하고 `(session_id, ordinal)`을 unique로 둔다.
- `name`은 표시값이며 식별자로 사용하지 않는다. 현재 청사진의 표준 이름은 `${ordinal}조`지만 향후 표시명 변경이 identity를 바꾸면 안 된다.
- `plannedCapacity`는 기존 `team.capacity`에 매핑하고 양의 정수 제약을 검증한다.
- 기존 team 행의 ordinal은 사용자 승인된 mapping 없이 이름에서 자동 추출하지 않는다.

### 3-3. 멱등 operation ledger

- ledger는 최소 `org_id`, `operation_id`, `plan_checksum`, `operation_type`, `request_hash`, `resource_id`, `applied_at`을 보존한다.
- `operation_id`는 현재 plan의 64자 SHA-256이고 primary key 또는 동등한 unique key여야 한다.
- 같은 operation ID와 같은 request hash의 재요청은 기존 resource를 반환한다.
- 같은 operation ID에 다른 request hash가 오면 mutation 전에 실패한다.
- ledger와 대상 행은 같은 transaction에서 기록한다. 대상 INSERT만 성공하거나 ledger만 성공하는 부분 상태를 허용하지 않는다.
- ledger·receipt에는 청사진 원문, join code, 이메일, Auth UUID를 기록하지 않는다.

### 3-4. design provisioning RPC

- 권장 형태는 plan 전체를 한 transaction에서 처리하는 staff 전용 RPC다. operation별 공개 RPC는 부분 성공 복구 부담 때문에 채택하지 않는다.
- RPC는 `org_id`를 인자로 받지 않는다. 현재 Auth 사용자와 P1C 선택 context에서 `org_of_uid()`가 검증한 기관을 서버가 파생한다.
- 허용 역할은 `org_admin`과 `hq`로 제한하고 활성 membership·활성 org를 매 요청 확인한다.
- 입력은 exact schema/version, plan checksum, source byte hash, operation 순서, parent reference, operation ID를 다시 검증한다.
- assembly slug, session slug, session/topic/team ordinal을 lookup-before-mutation 방식으로 대조한다. 기존 값이 기대 payload와 다르면 update로 덮지 않고 충돌로 중단한다.
- 모든 operation이 성공한 경우에만 commit한다. 오류는 원문·join code·credential을 포함하지 않는 안정 error code로 반환한다.
- 성공 응답은 생성/재사용 resource ID, operation 상태, count와 plan checksum을 포함하되 원 청사진 본문은 반복하지 않는다.

### 3-5. join code 생성과 복구

- join code는 client plan에 넣지 않고 server transaction 안에서 생성한다.
- 기존 6자리 숫자·unique 계약을 유지한다. 충돌은 제한된 횟수만 재시도하고 소진되면 전체 transaction을 실패시킨다.
- 같은 operation ID의 응답 유실 재요청은 ledger가 가리키는 기존 team의 동일 code를 현재 승인된 기관 staff에게만 다시 반환한다.
- code는 audit log·ledger·일반 오류·CI artifact에 기록하지 않는다. UI에서도 필요 시에만 제공하고 브라우저 영구저장소에 보존하지 않는다.

## 4. migration 초안 승인 시 필요한 산출물

다음 묶음은 하나의 리뷰 단위로 작성하고, production 적용은 별도 승인으로 남긴다.

1. additive migration 초안과 대응 rollback
2. 기존 session/team의 null·중복·부모/org mismatch를 세는 read-only preflight
3. session/team 제약과 ledger/RPC 권한을 확인하는 post-apply verifier
4. PostgreSQL throwaway stage rehearsal
5. 정상 생성, exact replay, payload 충돌, parent 충돌, join code 충돌 소진, transaction rollback, RLS/GRANT 음성 테스트
6. plan source hash와 migration/rollback/verifier hash를 결속한 approval bundle

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
- plan executor·Supabase adapter 연결

이 문서 승인만으로 위 항목을 실행하지 않는다. migration 초안 작성 승인과 production 적용 승인은 분리한다.
