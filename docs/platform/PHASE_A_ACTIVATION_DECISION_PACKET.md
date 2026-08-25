# Phase A 활성화 결정 패킷

상태: **결정 검토용 초안**

작성 기준: 2026-08-25

실행 권한: `false` — 이 문서의 채택은 production DB, Auth, membership, GRANT, backfill, traffic 변경을 승인하지 않는다.

독립 reader test: Gate 경계 판독 `PASS` — production mutation과 후속 gate가 분리됨을 확인했다. D2·D5·D6의 외부조건은 미해결 상태로 남아 있으며, 이 문서에서는 조건부 결정으로만 다룬다. 검수 결과는 `evaluation/2026-08-25-phase-a-condition-audit.md`에 반영했다.

## 1. 결정 범위와 현재 위치

이 문서는 A1~A4를 어떤 운영 모델로 이어갈지 정한다. 현재 P1/P2 additive schema와 공개 프론트는 production에 배포되어 있지만, P1C 기관 선택 schema, A2 staff 권한, A3 production adapter, A4 migration/RPC는 적용·연결되지 않았다.

- **A1/A2**: 기관 테넌시, staff Auth, 탭별 기관 선택과 권한 활성화
- **A3**: Auth 계정·초대·membership을 계획하고 감사 가능하게 실행하는 기관 접근 프로비저닝
- **A4**: 공론화·회차·주제·조 설계를 청사진에서 서버에 반영하는 설계 프로비저닝
- **P1/P2/P1C**: DB migration 단계 이름. P1/P2는 배포됐고 P1C는 승인된 초안만 존재한다.
- **Phase 2+**: 상위 아키텍처 플랜의 멀티테넌시 이후 제품 개발 범위. 이 문서의 Phase A 작업 묶음과 같은 번호 체계가 아니다.

승인은 두 종류로 분리한다.

1. **제품 결정**: 운영 모델과 비-production 개발 방향을 정한다.
2. **실행 승인**: 특정 production migration, Auth 작업, 데이터 mapping 또는 권한 변경을 증거와 함께 한 단계씩 허용한다.

현재 요청은 1번뿐이다. 제품 결정 승인 직후에는 이 문서와 상태·백로그만 갱신하며 production mutation은 수행하지 않는다.

## 2. 역할과 용어

| 용어 | 이 문서에서의 의미 |
| --- | --- |
| `org_admin` | 기관 접근과 설계를 관리하는 기관 관리자. A4 RPC 허용 후보 역할이다. |
| `operator` | 회차·주제·제출·투표 운영 데이터의 staff 읽기·쓰기 역할. A4 설계 RPC는 허용하지 않는다. |
| `hq` | 본부 staff 역할. 기관 데이터 읽기와 A4 RPC 허용 후보이며 HQ 공유비밀 전환 대상이다. |
| `facilitator` | 현장 진행자. 1차 Auth 전환에서는 제외하고 기존 조코드·현장 경로를 유지한다. |
| 휴면 schema/RPC | migration이 `PUBLIC`, `anon`, `authenticated`의 권한을 명시적으로 `REVOKE`하고 verifier가 ACL·`SECURITY DEFINER`·고정 `search_path`를 확인해 일반 staff traffic이 사용할 수 없는 객체. 적용 자체는 DB mutation이다. |
| readiness evidence | 승인 source·대상 host·시각·비식별 preflight를 외부 감사 HMAC key로 결속한 증거. 현재 HQ 로그인에 쓰는 공유비밀과 별개다. |
| mapping | 기존 session/team 행에 org·parent·ordinal을 근거와 함께 명시하는 비공개 승인 파일. 이름이나 날짜에서 자동 추정하지 않는다. |
| receipt | 실행 operation의 상태·시각·count를 남기는 비식별 감사 기록. |

P1C의 staff 정책은 같은 기관의 active staff에게 읽기를 허용하고 `operator|org_admin`에게 쓰기를 허용한다. A4 설계 RPC는 `org_admin|hq`만 허용한다. 따라서 역할별 허용 범위는 의도적으로 동일하지 않다.

`hq`도 전 기관 wildcard 역할이 아니다. 접근할 각 기관에 active `hq` membership이 있어야 하고, P1C가 현재 Auth 사용자·JWT session·탭별 org context와 같은 기관을 파생해야 한다. 다른 기관으로 이동할 때는 해당 membership으로 새 context를 발급하며 cross-org 통합 조회는 이 결정 범위에 포함하지 않는다.

## 3. 선택할 제품 결정

각 항목은 **권고안·대안·trade-off·재검토 조건**을 함께 읽고 선택한다. 결정 기한은 Gate B-A2 production 요청 전이다.

### D1. 논리적 테넌시 모델

- **권고**: 현 비공공 managed 배포와 각 물리 deployment 내부에서는 `org_id`, membership, RLS를 사용하는 row-level 테넌시를 기본값으로 둔다.
- **대안**: 기관별 schema 또는 기관별 database
- **권고 이유**: P1/P2가 이미 row-level 계약으로 배포됐고 RPC도 org를 서버에서 파생한다. 다른 모델은 migration과 RPC를 기관 수만큼 분기한다.
- **주요 위험**: RLS/RPC 한 곳의 scope 누락이 기관 간 노출로 이어질 수 있어 deny 테스트와 org 파생 불변식이 필수다.
- **재검토**: 계약·법률 검토가 물리 격리를 요구하거나 D5 확인 결과 공공 트랙에 기관별 프로젝트·database·망분리가 필요한 경우. 이때 공공 트랙의 tenancy topology는 D1을 자동 적용하지 않고 별도로 결정한다.

### D2. staff Auth 범위

- **권고**: 1차는 `org_admin`, `operator`, `hq`; `facilitator`는 기존 현장 경로 유지
- **대안**: 진행자까지 동시에 Auth 계정화
- **권고 이유**: 관리자·운영 데이터와 HQ 행위부터 사용자·기관에 귀속하고, 행사 당일 진행자 로그인 전환은 별도 현장 검증으로 분리한다.
- **주요 위험**: 기존 조코드 경로는 개인 신원 감사가 약하다. 진행자 경로의 종료 시점과 Auth 전환 E2E가 후속 결정으로 남는다.
- **재검토**: 진행자 개인별 감사 요구가 확정되거나 현장 Auth 리허설이 완료된 경우
- **근거 감사**: 상위 역할표도 facilitator를 `join_code (+ 향후 계정)`으로 정의한다. 개인별 감사 의무나 전환 시점은 현재 정본에서 발견되지 않았다.

### D3. HQ 공유비밀 전환 시점

- **권고**: 실제 staff 사용자에게 Phase 2 경로를 열기 전에 HQ 공유비밀을 `hq|org_admin` membership 인증으로 전환
- **대안**: 내부 시험 동안 공유비밀을 임시 유지
- **권고 이유**: 공유비밀은 사용자·기관 귀속이 없고 다기관에서 권위 있는 org를 고를 수 없다.
- **주요 위험**: Auth 계정·membership·세션 복구가 준비되지 않은 상태에서 먼저 전환하면 HQ 운영을 막을 수 있다.
- **완료 기준**: 실제 Auth JWT의 allow/deny E2E, 세션 만료·로그아웃, rollback을 통과한 뒤에만 staff traffic을 연다.
- **근거 감사**: 상위 아키텍처 플랜이 노출 이력과 자기신고 actor 문제 때문에 이 전환을 Phase 2 선행조건으로 이미 고정했다. 남은 것은 방향 선택이 아니라 별도 gate의 안전한 실행 승인이다.

### D4. 설계 셀프서비스 범위

- **권고**: 기관이 schema v4 설계 마법사에서 작성·검증하되, 서버 반영은 승인된 `org_admin|hq` 세션의 제한된 실행으로 분리
- **대안**: 기관은 설계 요청만 전달하고 HQ가 SQL·게이트 UI로 전부 대행
- **권고 이유**: 청사진 UI와 dry-run plan은 이미 구현돼 입력 책임을 기관에 둘 수 있고, production executor는 아직 연결하지 않아 실행 통제를 유지할 수 있다.
- **주요 위험**: 현재 RPC role check는 별도 2인 승인을 뜻하지 않는다. 2인 승인이나 승인 SLA가 필요하면 approval ledger와 독립 reviewer 계약을 추가해야 한다.
- **완료 기준**: 작성→검증→승인 요청→authorized execution→receipt→rollback의 한 pilot rehearsal. 실패 책임자는 실행 담당 staff, 데이터 의미 책임자는 승인자다.
- **근거 감사**: 현재 검수 계약은 reviewer·timestamp·append-only event를 요구하지만 2인 승인 또는 SLA 의무는 두지 않는다. 이를 요구하면 기존 계약의 해석이 아니라 신규 제품 요구사항이다.

### D5. 물리적 호스팅·격리

- **권고**: 두 검토 트랙을 분리한다. 비공공 SaaS·내부 pilot은 managed 단일 Supabase를 유지한다. 공공조달은 데이터 분류와 cloud provider·기반 인프라의 CSAP 적격성을 먼저 확인한 뒤 물리 topology를 별도 결정한다. CSAP 적격 IaaS의 셀프호스트는 검토할 수 있는 fallback이지 Gate A에서 확정하는 기본값이 아니다.
- **대안**: 적격성 확인 없이 모든 고객을 managed 한 트랙으로 운영하거나, 확인 전에 모든 고객을 기관별·셀프호스트 배포로 분리
- **D1과의 차이**: D1은 한 DB 안의 논리적 행 격리이고, D5는 장애·운영·법률 경계를 나누는 물리적 배포 결정이다.
- **권고 이유**: 현재 vertical의 공통 migration·백업·배포를 유지하되, 확인되지 않은 provider 적격성이나 물리 격리 방식을 제품 결정으로 선결하지 않는다.
- **주요 위험**: 공공 트랙이 별도 배포로 결정되면 migration·인증·복구 drift가 생길 수 있다. 데이터 등급과 provider·기반 인프라 적격성이 정해지지 않으면 region·기관별 DB·물리 망분리 요구도 확정할 수 없다.
- **재검토**: 비공공 트랙도 계약상 물리 격리가 필요하거나 공용 자원 한계가 입증된 경우
- **결정 전 외부 확인**: 공공 트랙의 정치적 의견·음성 데이터 등급, 필요한 CSAP 등급, cloud provider·기반 인프라 적격성, 기관별 물리 격리 요구를 법률·컴플라이언스 검토로 확정한다. 현재 개인정보 처리방침은 v0.1이며 관련 법률 검토와 책임자 지정이 남아 있다.

### D6. 플랫폼화 범위

- **권고**: Phase 2+ 개발 지속. 최소 범위는 A2 staff Auth/기관 선택, A3 감사 가능한 접근 프로비저닝 계약, A4 청사진 저장 rehearsal까지다.
- **대안**: Phase 1의 분석·검수·공개 vertical에서 중단하고 기관 온보딩·설계는 수동 운영
- **제품 근거**: 단일 행사 UI를 넘어 기관별 데이터 귀속, 승인된 접근, 반복 가능한 설계가 있어야 재사용 가능한 운영 제품이 된다.
- **완료 기준**: 한 pilot 범위에서 비공개 계획 생성, role별 allow/deny, 설계 dry-run, rollback과 receipt를 재현한다. production mutation은 각 gate 승인 전까지 제외한다.
- **중단 조건**: 대상 기관·운영 owner가 없거나 A3 멱등 저장·receipt 계약을 승인할 수 없으면 production adapter 개발 전에 멈춘다.
- **근거 감사**: 1차 고객군은 갈등관리 수행사 화이트라벨로 권고되어 있다. 다만 named pilot 기관, 운영 owner, 기술·법률 책임자는 정본에서 확정되지 않았다.
- **결정 전 외부 확인**: pilot 기관, 운영 owner, A3 멱등 저장·receipt 계약 승인 책임자를 확인한다. 미확정이면 repository의 non-production 계약·verifier까지만 조건부 지속하고 production adapter는 보류한다.

### 권고 결정 기록 문구

> D1 현 비공공 managed 배포와 각 물리 deployment 내부의 row-level 논리 테넌시, D2 관리자·운영자·HQ 우선 Auth와 facilitator 후속 전환, D3 staff traffic 전 HQ membership 전환, D4 설계 마법사와 authorized execution 분리, D5 비공공 managed 유지와 공공 CSAP 적격성 확인 후 topology 별도 결정, D6 갈등관리 수행사 화이트라벨을 우선한 최소 범위의 Phase 2+ 개발 지속을 제품 방향으로 승인한다. Gate A 제품 결정과 비-production 개발 방향만 승인하며 production DB·Auth·membership·GRANT·backfill·traffic mutation은 승인하지 않는다.

개별 항목을 승인할 때도 다음 한정문을 반드시 붙인다.

> 이 승인은 Gate A의 해당 제품 결정만 승인하며 production mutation은 승인하지 않는다.

일부 항목을 보류하면 의존하는 개발도 보류한다. D1 또는 D5가 보류되면 테넌시 production 작업을, D2 또는 D3가 보류되면 staff traffic 작업을, D4가 보류되면 A4 production adapter를, D6가 보류되면 Phase 2+ 신규 구현을 시작하지 않는다.

D2의 진행자 전환 시점, D5 공공 트랙의 데이터 등급·CSAP 등급·provider/인프라 적격성·tenancy topology, D6의 named pilot·owner는 `조건부`로 기록한다. D4의 2인 승인은 현 요구사항이 아니며 사용자가 새 요구로 채택할 때만 조건부로 추가한다. 조건부 결정은 repository의 문서·계약·검증 코드만 허용하며 관련 production adapter와 gate 요청을 보류한다.

## 4. 근거와 증거 수준

| 범위 | 현재 확인된 증거 | 수준 | 아직 없는 증거 |
| --- | --- | --- | --- |
| P1/P2 | production additive schema와 프론트 배포 기록, `STATUS.md` | 배포 기록 있음 | 이 결정 패킷 시점의 live schema refresh |
| A2/P1C | 승인 기록 `dc43432`, activation bundle `21977d9`, PostgreSQL rehearsal | 초안·격리 리허설 | production P1C/preflight, 실제 readiness, Auth JWT E2E |
| A3 | 계획 `edfd2ec`, executor core 보강 `ea57e86` | 로컬 core 검증 | production adapter, invitation ledger, 메일 provider, append-only receipt 저장소 |
| A4 | 계약 `fa4d0fe`, plan `4ab55b5`, migration 계열 `873a50f..e9721eb`, approval/receipt·injected execution/reconciliation lifecycle core, 휴면 read-only ledger status RPC, 로컬 durable crash/restart·revocation/context·비식별 전체-store audit rehearsal, CI | 초안·격리 PostgreSQL·response-loss/reconciliation·재시작/CAS·취소/claim 경쟁·현재 entry 무결성 검증 | production migration, 실제 mapping/readiness, RPC 권한, authoritative revocation·immutable catalog·receipt signature audit·production-grade durable approval/receipt·live membership CAS·executor/status adapter |
| D2~D6 외부조건 | `evaluation/2026-08-25-phase-a-condition-audit.md` | 로컬 정본·공식 CSAP 자료 근거 감사 | 진행자 전환 시점, 공공 데이터·CSAP 등급·provider 적격성·topology, named pilot·owner |

`readyForExecution:false`는 `platform-design-provisioning-plan.mjs` 출력의 승인 전 불변식이다. migration 초안 승인이나 bundle verifier 성공을 production readiness 또는 실행 승인으로 해석하지 않는다.

## 5. production gate와 의존 순서

Gate A 이후의 각 항목은 **모두 별도 승인**이다. “읽기 함수”나 “휴면 schema”도 production DB mutation이다.

```text
Gate A 제품 결정
  → Gate B-A2 P1C 휴면 schema 또는 Gate B-A4 A4 additive schema를 각각 별도 승인
  → Gate C A2 count-only 진단 설치·실행
      ├─ not_verified → 중단
      ├─ not_ready → blocker에 필요한 D/E만 별도 승인 → 해당 preflight 재실행
      └─ ready → F-A2 또는 F-A4를 각각 별도 승인
                    → role별 E2E
                    → Gate G traffic을 별도 승인
```

P1C count-only RPC는 P1·P1C·P2가 모두 있어야 하므로 Gate B-A2가 Gate C보다 먼저다. `not_ready`는 권한 활성화를 중단하지만 blocker를 해소하는 범위가 명시된 remediation 승인까지 금지하지 않는다. remediation 뒤 A2 count-only preflight와 A4 activation preflight 중 해당 검사를 다시 실행해 `ready`를 받아야 F/G로 갈 수 있다.

### Gate A — 제품 결정만 확정

- 변경: 이 문서의 결정 상태, 승인자·시각, 상태 문서와 비-production backlog 갱신
- production mutation: 없음
- 승인 문구: §3의 전체 문구 또는 개별 문구 + 한정문
- 허용되는 개발: A2~A4의 repository 문서·순수 plan/verifier·adapter interface·test double·throwaway PostgreSQL rehearsal
- 금지되는 개발: production credential 로딩, production adapter 연결, 외부 Auth·메일·초대 provider 호출, 실제 DB·데이터·권한·traffic 변경

### Gate B-A2 — P1C 휴면 schema 적용

- 대상: P1C 기관 선택 migration 적용 후 `expect_staff_grants=off` 검증
- 금지: preflight RPC, Auth·membership, backfill, staff GRANT, traffic
- 완료 증거: migration SHA, post-apply verifier, rollback 가능 상태, ACL 휴면 확인

### Gate B-A4 — A4 additive schema 적용

- 대상: A4 migration과 post-apply verifier. A4 preflight는 설치 객체가 아닌 read-only SQL이며 mapping 전후에 실행한다.
- 금지: mapping·backfill, NOT NULL, RPC GRANT, executor 연결, traffic
- 완료 증거: migration SHA, post-apply verifier의 함수·ledger ACL과 고정 `search_path`, populated rollback 거부 계약

### Gate C — A2 count-only preflight RPC 설치·진단

- 선행: Gate B-A2와 P1/P2 schema의 post-apply 검증
- 대상: `platform_p1c_activation_preflight.sql` production 적용과 post-apply verifier
- 권한: migration이 `PUBLIC|anon|authenticated`를 명시적으로 revoke하고 service role만 execute한다.
- 금지: backfill, Auth·membership, staff GRANT, traffic
- 승인 문구: `A1/A2 count-only preflight RPC의 production 설치와 post-apply 읽기 검증만 승인`
- 진단 증거: 적용 SHA, ACL·`SECURITY DEFINER`·고정 `search_path` verifier, 비식별 `not_ready|ready` report. `not_verified`이면 모든 후속 production 작업을 중단한다.

### Gate D — Auth·membership remediation

- 대상: 승인된 비공개 A3 접근 계획의 exact 계정·membership operation
- 선행: D2, 대상 기관·역할·승인자, invitation 멱등 ledger와 append-only receipt 저장소 구현, crash/retry/reconciliation test 통과
- 승인 freshness: canonical reviewer와 key ID를 가진 HMAC approval을 trusted runner UTC 기준 15분 이내 검증한다.
- 금지: P1C/A4 migration, staff GRANT, traffic
- 완료 증거: 비식별 receipt, operation별 lookup/reconciliation, 실패 후 pending 보존

### Gate E — 기존 데이터 mapping·backfill remediation

- 선행: 대상 column을 소유한 Gate B-A2 또는 B-A4와 exact mapping 승인
- mapping 필수 필드: 안정 기존 row ID, 목표 org/parent, session 또는 team ordinal, 근거, 검수자, 승인 시각
- 책임 분리: mapping 작성자와 의미 검수자는 다른 사람으로 기록하고, production mutation은 그 checksum을 명시한 사용자 승인까지 별도로 받는다.
- 금지: 이름·날짜·순서에서 값 자동 추정, 범위 밖 행 갱신
- 완료 증거: 전후 비식별 count, applicable preflight `ready`, mapping checksum, 범위 밖 변경 없음

### Gate F-A2 — staff table GRANT 활성화

- 선행: 대상 host·source commit에 결속되고 trusted clock 기준 600초 이내인 A2 readiness evidence, 대상 staff 테이블 쓰기 동결, Auth·membership, rollback rehearsal, 운영 담당자
- 범위: 승인 bundle의 staff GRANT만. A4 RPC 권한과 traffic은 포함하지 않는다.
- 완료 증거: 실제 Auth JWT의 role별 allow/deny E2E와 GRANT rollback 재검증

### Gate F-A4 — design RPC 실행 권한 활성화(현재 차단)

- 현재 blocker: 외부 HMAC approval artifact, role·expiry·revocation·one-time claim·terminal finalization, 비식별 receipt, injected response-loss lifecycle과 기존 claim 전용 명시적 reconciliation core, 휴면 read-only ledger status RPC 초안, 저장소 밖 로컬 durable crash/restart·revocation/context와 현재 entry 전체-store audit rehearsal은 구현됐고 receipt 없는 기존 claim의 RPC 자동 재시도도 차단했다. 그러나 실제 key custody·authoritative revocation·immutable catalog 기반 삭제 검출·receipt signature audit·production-grade durable approval/append-only receipt state·live membership CAS adapter와 production executor·status adapter·권한은 없다. A4 plan은 계속 `readyForExecution:false`이며 이 production 경로와 아래 선행조건을 별도 repository 변경·사용자 승인으로 완성하기 전에는 F-A4를 승인 요청하지 않는다.
- 선행: A4 migration·mapping·read-only activation preflight, `org_admin|hq` Auth E2E, rollback 데이터 보존 계획, 승인된 execution artifact
- 범위: 승인된 A4 RPC 권한만. A2 staff GRANT와 traffic은 포함하지 않는다.
- 완료 증거: 정상·replay·conflict·transaction rollback과 role deny E2E

### Gate G — staff traffic open

- 선행: 승인된 F-A2/F-A4 범위의 E2E와 rollback, 운영 담당자·관측·복구 절차
- HQ route 선행: 기존 공유비밀 발급·검증 경로 revoke/disable, 기존 비밀 재사용 deny, active `hq|org_admin` membership과 탭별 org 귀속 E2E
- A2 staff 화면과 A4 설계 실행 traffic은 각각 별도 승인할 수 있다.
- 완료 증거: open 시각·담당자·대상 route, live role allow/deny, rollback 또는 close 확인

## 6. 즉시 중단 조건

- source commit·migration·bundle checksum이 승인 기록과 다름
- preflight가 `not_verified`, 또는 F/G 직전 `not_ready`
- 승인 범위 밖 org·session·team·사용자 행이 mapping에 포함됨
- 기존 row의 org·parent·ordinal을 근거 없이 추정해야 함
- role별 거부 테스트, rollback 또는 receipt persistence가 실패함
- Auth·membership·GRANT가 부분 적용됐는데 reconciliation 상태가 확정되지 않음
- A4 ledger 행 또는 non-null team ordinal이 있는 상태에서 데이터 보존 계획 없이 rollback이 필요함

## 7. 실행 전 증거와 실행 후 완료 증거

### 실행 전

1. 정확한 gate 승인 문구와 승인자·시각
2. 실행 대상 commit과 원격 CI 성공
3. 현재 source로 재검증한 해당 A2/A4 bundle
4. 대상 host에 결속된 fresh preflight evidence
5. 비공개 Auth·membership 또는 mapping plan checksum
6. 단계별 rollback 명령과 throwaway rehearsal

### 실행 후

1. post-apply verifier와 role별 E2E
2. mutation·실패·reconciliation을 담은 비식별 receipt
3. 범위 밖 변경 없음과 권한 휴면/활성 상태 확인
4. rollback 또는 traffic close 재검증 결과

## 8. 지금 요청할 결정

현재 요청 대상은 **Gate A의 D1~D6 제품 결정뿐**이다. 승인되면 결정 상태와 허용 범위가 닫힌 비-production backlog를 커밋한다. 다음 production 요청은 P1C 선행조건 때문에 Gate B-A2 휴면 schema 적용 여부로 한정하고, 그 뒤에만 Gate C count-only 진단 설치 여부를 요청한다. 각 gate마다 source·증거·승인 문구를 다시 제시한다.

## 근거 문서

- `10_작업산출물/2026-08-09_공론화플랫폼_아키텍처_플랜.md` §4~§5
- `docs/platform/PROVISIONING.md`
- `docs/platform/A4_DESIGN_PROVISIONING_CONTRACT.md`
- `evaluation/platform-a2-activation-bundle.json`
- `evaluation/2026-08-16-platform-a2-postgres-rehearsal.md`
- `evaluation/platform-a4-migration-bundle.json`
- `evaluation/2026-08-25-platform-a4-migration-draft.md`
- `evaluation/2026-08-25-phase-a-condition-audit.md`
