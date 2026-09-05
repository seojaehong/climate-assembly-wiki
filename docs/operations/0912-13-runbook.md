# 9월 12–13일 현장 운영 런북

이 문서는 `/mod` 조 진행 화면과 `/hq` 본부 화면의 개통·운영·중단·복구 기준이다. 자동 리허설은 합성 fixture만 사용하며 **운영 DB 변경 0건**을 JSON으로 증명한다. 브라우저 fixture는 화면의 요청·응답·복구 흐름만 검증하며 권한, 토큰 수명, 동시성, DB 제약의 보안 증거가 아니다. 해당 계약의 정본은 격리 PostgreSQL에서 실행하는 `scripts/verify-0912-postgres.sh` 결과다. 실제 행사 데이터 변경은 본부 화면 또는 감사 기록이 남는 승인된 RPC만 사용한다.

## 1. 역할과 승인선

| 역할 | 담당 | 할 수 있는 일 | 단독으로 하면 안 되는 일 |
|---|---|---|---|
| 상황 책임자 | 당일 지정 1인 | 개통, 일시 중단, 재개, 종료 결정 | 근거 없이 충돌 강제 덮어쓰기 |
| HQ 조작자 | 교대 2인 | 꼭지 개방·마감, 기기 조회·토큰 폐기 | 접속코드·토큰을 채팅이나 보고서에 기록 |
| 기록 담당 | 당일 지정 1인 | 시각·조작자·RPC 결과·증거 경로 기록 | 비밀번호·원문 개인정보 기록 |
| 복구 담당 | 당일 지정 1인 | 백업 확인, 격리 복원, 복구 결과 대조 | 운영 DB에 복원 리허설 실행 |

HQ 변경은 `요청자 → 조작자 → 확인자` 순서로 읽어 확인한다. 동일 인물이 조작과 확인을 겸하지 않는다. 비상 RPC도 같은 승인선을 따른다.

## 2. 개통 전 체크리스트

### 전날

- [ ] 배포 revision이 승인 commit과 일치한다.
- [ ] 저장소가 요구하는 Node 20에서 `npm.cmd exec --yes --package=node@20.20.1 -- node node_modules/vitest/vitest.mjs run`과, `automation` 폴더의 `npm.cmd exec --yes --package=node@20.20.1 -- node node_modules/vitest/vitest.mjs run`이 통과한다. 시스템 기본 Node 버전으로 대신 실행하지 않는다.
- [ ] 같은 Node 20에서 `node_modules/astro/astro.js check`, `node_modules/astro/astro.js build`, `scripts/write-deployment-revision.mjs`를 순서대로 실행해 프로덕션 산출물과 revision 표식을 만든다. 추적 파일을 다시 만드는 `prebuild`는 검증 중 실행하지 않는다.
- [ ] 저장소 밖 임시 증거 폴더를 만들고 Node 20으로 `scripts/verify-0912-readiness.mjs --output <임시폴더>\0912-13-traceability-report.json`을 실행한다.
- [ ] 프로덕션 build/preview에서 Node 20으로 `scripts/verify-field-rehearsal.mjs --base http://127.0.0.1:4331 --report <임시폴더>\0912-13-field-rehearsal.json`을 실행한다.
- [ ] 같은 preview에서 `scripts/verify-0912-hq-rehearsal.mjs --base http://127.0.0.1:4331 --report <임시폴더>\0912-13-hq-rehearsal.json`을 실행해 HQ v3 충돌·전체 비우기·로그아웃 실패 복구 흐름을 확인한다.
- [ ] 승인 기준 branch와 작업 branch의 보안 diff를 검토하고 `evaluation/0912-13-security-diff-review.md`에 위험 경계·검증 결과·미실행 외부 게이트를 기록한다.
- [ ] 필드 리허설 JSON의 `safety.liveNetworkRequestCount`와 `safety.liveDatabaseMutationCount`가 모두 `0`이고 `networkContract.escapedExternalRequestCount`가 `0`, `capabilityValuesLeakedToDraftQueueOrEvidence`가 실제 scan 결과 `false`다. workshop access token의 session 저장은 `networkContract.workshopSessionPersisted: true`로 따로 확인한다. `/mod`·`/hq`는 외부 CDN 글꼴 없이 시스템 한글 글꼴로 정상 표시돼야 한다.
- [ ] `/mod`, `/hq` 자동 접근성 감사 결과와 수동 보조기술 평가의 미실행·실패 항목을 상황 책임자가 확인한다.
- [ ] 15개 조의 확정 명단·테이블 번호를 별도 정본과 맞춘다. 임시 8월 roster 복사본은 개통 근거로 사용하지 않는다.
- [ ] 합성 fixture에서 세 번째 기기 거부, 두 기기 동시 편집 충돌, 토큰 폐기 후 재사용 거부의 **화면 처리**를 재현한다. 같은 항목의 권한·수명·동시성·폐기 계약은 격리 PostgreSQL 검증에서도 각각 통과해야 하며 fixture 결과로 대체하지 않는다.
- [ ] `scripts/verify-0912-postgres.sh`가 CLI 생성 seed SQL의 정상 15개 조 생성과 partial tenancy 불일치의 fail-closed를 일회용 PostgreSQL 16에서 통과하고, `seedCliCapabilityValuesLogged`가 `0`인지 확인한다.
- [ ] 운영 DB에는 쓰지 않는 읽기 전용 `pg_proc`/ACL inventory를 뽑아 P2a verifier의 identity-argument allowlist와 대조한다. 승인 목록 밖의 `climate_vote` 실행 가능 routine이나 `public.cv_set_active(text)`가 하나라도 있으면 cutover를 중단한다. 과거 inventory는 참고일 뿐 당일 조회를 대신하지 않는다.
- [ ] 배포된 접속코드 교환 endpoint에서 외부 클라이언트가 `x-forwarded-for`·`x-real-ip` 값을 바꿔 보내도 서버의 throttle source가 바뀌지 않는지 직접 probe한다. 게이트웨이가 해당 헤더를 신뢰 가능한 값으로 덮어쓴다는 증거가 없으면 브라우저에서 RPC를 직접 열지 않고 신뢰 가능한 edge-only 교환 경로를 먼저 배포한다.

### 행사 시작 60분 전

- [ ] `/hq`에서 대상 세션 slug가 `0912-deliberation`인지 소리 내어 확인한다.
- [ ] 꼭지 수·순서·문구·초기 상태를 승인본과 대조한다. 다음 꼭지만 열 수 있는지 확인한다.
- [ ] 접속코드는 필요한 시점에만 1회 전달하고 화면 캡처·운영일지·메신저에 남기지 않는다.
- [ ] HQ 토큰은 개인 브라우저 세션에만 두며 공용 문서, 셸 기록, JSON 증거에 복사하지 않는다.
- [ ] 등록된 HQ 운영자 전원이 자기 이름과 개인 비밀번호로 로그인되는지 확인한다. 공유 비밀번호·임의 표시 이름 경로는 P2a cutover 뒤 사용할 수 없으며, 한 명이라도 개인 로그인이 준비되지 않았으면 개통하지 않는다.
- [ ] 새 백업을 만들고 checksum, 생성 시각, 세션 slug, 조/제출 건수를 기록한다.
- [ ] 백업을 **운영 DB가 아닌 격리 PostgreSQL**에 복원해 행 수와 checksum을 대조한다.

### 개통 직전

- [ ] 상태 레일에서 연결 상태·마지막 확인 시각·미저장·대기·충돌을 읽을 수 있다.
- [ ] 꼭지①에 합성 글을 입력한 채 꼭지②를 열어 입력·포커스·스크롤이 유지된다.
- [ ] `/hq`와 `/mod`를 데스크톱·모바일 폭에서 키보드만으로 열고 본문 바로가기가 작동한다.
- [ ] `evaluation/0912-13-readiness-report.template.json`을 실행 사본으로 복제하고 모든 critical gate에 실제 증거 경로를 붙인다.
- [ ] 실행 보고서를 `node scripts/verify-0912-release-report.mjs --report evaluation/0912-13-readiness-report.json --expected-commit <승인한-40자리-commit>`으로 검증한다. `ready` 후보는 배포 endpoint의 직접 probe에서 읽은 commit을 `--expected-target-revision <배포된-40자리-commit>`으로 추가해야 한다. 검증기는 정본 template을 승인 commit의 Git 객체에서 읽고 고정 증거 경로·파일·생성 보고서 상태를 교차검증한다. 필수 gate, 운영 rollout, 배포 revision 중 하나라도 미실행이면 `not_ready`와 종료코드 `1`이 정상이며 개통하지 않는다.

### 정본 운영 패킷과 적용 순서

아래 순서는 개통 정본이다. 운영 DB에 적용하는 각 변경 단계는 **사용자의 명시적 승인 뒤에만** 실행한다. 파일을 검토하거나 `--print-seed-sql`로 SQL을 출력하는 것은 적용 승인이 아니며, 자동 검증은 격리된 `verify` DB에서만 실행한다.

| 순서 | 정본 파일·명령 | 기대 결과와 승인 gate |
|---|---|---|
| 1. 명단 확정 | `scripts/session-rosters.mjs` | `0912-deliberation`에 개인정보 없는 조 구조 15개가 있고, 이름·분과·ordinal을 승인본과 대조한다. |
| 2. P1 tenancy — 미적용 시 별도 운영 승인 | `supabase/migrations/platform_p1_tenancy.sql` | migration 이력과 정본 checksum을 확인한다. 이미 적용됐으면 건너뛰고, 미적용이면 사용자 승인 뒤 먼저 적용한다. seed와 s20은 `org_id`·`assembly_id`를 쓰므로 P1보다 앞서 실행하면 안 된다. |
| 3. 세션·조 비밀 SQL packet 생성·적용 | 새 세션: `node scripts/seed-0829-teams.mjs --print-seed-sql`<br>기존 세션: `node scripts/seed-0829-teams.mjs --print-sync-sql` | P1 확인 뒤 실행한다. 두 명령은 `crypto.randomInt` 기반의 서로 다른 6자리 코드 15개가 포함된 원자 트랜잭션을 stdout으로 만든다. 새 세션에만 seed, 이미 있는 세션·조에는 sync를 쓰며 stdout은 화면에 표시하지 말고 승인된 비밀 scratch 파일로 즉시 리디렉션한다. 별도 승인 후 **세션 1개·active 팀 15개**와 session의 `org_id`·`assembly_id`·`held_on`, 모든 team의 동일 `org_id`를 확인한다. sync가 기존 session 조직·assembly·행사일 또는 team 조직 불일치를 발견하면 fail-closed로 중단하고 SQL을 적용하지 않는다. 인자 없는 실행은 종료코드 `2`로 끝나며 direct live-write 경로는 완전히 비활성화되어 있다. |
| 4. 꼭지 생성 | `supabase/migrations/20260902_s20_open_0912_topics.sql` | P1과 세션·팀 결과 확인 뒤 별도 승인 후 적용한다. 정확히 **draft 꼭지 6개**이고 ordinal이 1–6인지 검증한다. |
| 5. P1a additive 적용 — **운영 승인 gate 1** | `supabase/migrations/platform_p1a_0912_event_access.sql` | P1→seed→s20 선행 상태와 checksum을 확인하고 사용자가 P1a를 명시적으로 승인한 뒤 적용한다. 새 token/exchange RPC를 만들되 아직 anon/auth에 실행 권한을 주지 않고, HQ rotate/status와 staff RPC만 먼저 노출한다. legacy 권한도 이 단계에서는 끊지 않는다. HQ/team bootstrap과 기존 token 사용은 조직·공론화·세션이 모두 `active`이고 세션의 비어 있지 않은 hard expiry가 미래일 때만 허용된다. 대상은 정확한 `0912-deliberation`이며 임의 최신 세션이나 36시간 기본값으로 대체하지 않는다. 토큰 만료가 **2026-09-13 22:00 KST**인지 확인한다. |
| 6. P1a 행동 검증 | `supabase/verify/platform_p1a_0912_event_access.sql` | 두 기기·OCC·proxy vote v3 멱등성·HQ CAS·닫힌 꼭지의 조 재오픈 거부·코드 회전·개별 로그아웃·비밀번호 변경 시 운영자 전 기기 토큰 폐기·감사 불변식과 P1a 공개 권한 경계를 확인한다. CI/로컬 리허설은 `scripts/verify-0912-postgres.sh`로 disposable PostgreSQL만 사용한다. |
| 7. 예측 코드 선교체 | `workshop_hq_rotate_join_codes(p_token, p_session_slug, p_confirmation, p_idempotency_key)` | P1a 검증 뒤 maintenance 진입을 확인하고 `ROTATE 0912-deliberation`과 새 UUID 멱등키로 1회 실행한다. 같은 조작의 재시도에만 같은 UUID를 쓴다. 새 6자리 코드는 봉인된 오프라인 전달표로 옮기되 P2a 검증 전에는 배포하지 않고, 평문을 로그·보고서에 남기지 않는다. |
| 8. 분석·조직 기반 적용 — **운영 승인 gate 2** | `platform_p2_analysis_review.sql` → `platform_p1b_backfill.sql` → `platform_p1c_org_selection.sql` → `platform_p1c_activation_preflight.sql` → `platform_p1c_org_selection_activation.sql` | 단순 파일명 정렬로 실행하지 않는다. P2 테이블을 먼저 만든 뒤 backfill·조직 선택 preflight·activation 순으로 적용하고, 각 preflight 결과가 승인본과 일치해야 한다. 이미 적용된 파일은 migration 이력과 정본 checksum을 대조하고 건너뛴다. |
| 9. maintenance token/staff client 배포 | `src/lib/workshop-access.ts`, `src/lib/deliberation.ts`, `src/lib/mod-console.ts`, `src/lib/platform.ts`, `src/lib/workshop-hq.ts`, `src/lib/attendance.ts` | 승인 revision을 배포하고 `/mod`가 코드 교환 뒤 토큰 RPC만 호출하도록 구성됐는지, 생성·proxy 요청이 UUID 멱등키가 있는 `mod_create_round_v3`·`mod_proxy_vote_v3`·`ballot_create_v3`인지, staff ballot이 `platform_ballot_list_v2`·`platform_ballot_results_v2`인지, `/hq` 로그아웃이 로컬 저장소를 지우기 전에 `workshop_hq_logout_v2`로 서버 토큰을 폐기하는지 정적·합성 리허설 증거로 대조한다. P2a 전에는 team token RPC positive 호출이 공개 권한상 거부되는 것이 정상이다. |
| 10. P2a 원자 cutover — **운영 승인 gate 3** | `supabase/migrations/platform_p2a_0912_token_only_activation.sql` | P2·P1b/P1c, 배포 revision, 당일 read-only routine inventory, 운영자별 개인 로그인 완료를 확인한 뒤, 앞선 gate와 별개의 사용자 명시 승인을 받아 적용한다. 한 트랜잭션에서 token RPC 실행 권한을 열고 legacy code 기반 실행 권한, 공유 HQ 비밀번호·임의 행위자 경로, 운영자 credential-state 표 조회, unscoped readiness·eligible-count·org lookup, PIN/by-code unlock, 비멱등 v2 create/proxy, owner-rights vote view와 `public.cv_set_active`를 폐기한다. `cv_snapshot_now`와 `cv_archive_round`는 브라우저 역할에서 회수하고 `service_role`에만 남긴다. |
| 11. activation positive·negative 검증 | `supabase/verify/platform_p2a_0912_token_only_activation.sql` | 새 token v2/v3와 staff 경로가 성공하고 legacy moderator, cross-session HQ deadline, 비멱등 v2 create/proxy negative 경로가 권한 오류로 거부되는지 확인한다. HQ 로그아웃 토큰의 재사용 거부와 비밀번호 변경 뒤 같은 운영자의 두 기기 토큰이 모두 거부되는지도 확인한다. `pg_proc`의 실제 identity argument 기준으로 PUBLIC 실행 0건, anon/auth 승인목록 밖 실행 0건인지 확인하고, workshop token으로 scoped attendance·eligible count가 정상인지도 확인한다. rollback 정본은 `supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql`, rollback 검증은 `supabase/verify/platform_p2a_0912_token_only_activation_rollback.sql`이다. 이 검증 통과 뒤에만 새 접속코드를 전달한다. |
| 12. P3 design provisioning — 별도 운영 승인 | `supabase/migrations/platform_p3_design_provisioning.sql` | 사용자 승인 뒤 적용하고 `supabase/verify/design_provisioning_post_apply.sql`로 구조·매핑을 검증한다. 코드 생성기는 차단된 예측 범위 `091201`~`091215`를 만들지 않아야 한다. |
| 13. P4 audit log — 별도 운영 승인 | `supabase/migrations/platform_p4_audit_log.sql` | P3 검증 뒤 별도 사용자 승인을 받아 적용한다. 기존 행사 감사 이력을 보존하고, 새 감사 이벤트가 정본 actor/action 필드를 갖는지 기존 P4 검증 절차로 확인한다. |
| 14. P3/P4 이후 legacy 재개방 방지 | `supabase/verify/platform_p2a_0912_token_only_activation.sql` 재실행 | P3·P4 뒤에도 legacy와 cross-session HQ deadline 권한이 다시 열리지 않았고 token/staff positive 경로가 유지되는지 재검증한다. |
| 15. 최종 상태 확인 | HQ의 `workshop_hq_status`·`workshop_hq_devices` | session slug, **1 session / 15 active teams / 6 topics**, 열린 꼭지, 활성 기기 수, 코드 전달 완료, 운영 로그 위치를 두 사람이 확인한 뒤에만 개통한다. |

순서가 어긋났거나 기대 건수가 다르면 즉시 중단한다. 검증된 핵심 migration 순서는 `P1 → seed/s20 → P1a → P2 → P1b/P1c → P2a → P3 → P4`다. 현장 절차는 `session-rosters 정본 확인(읽기) → P1 적용 이력·checksum 확인 및 미적용 시 승인·적용 → atomic seed/sync SQL 별도 승인·적용 → s20 별도 승인·적용 → P1a 승인·검증 → 4인자 HQ rotate 선교체 → P2 및 P1b/P1c 승인·검증 → maintenance token/staff client 배포 → P2a 별도 승인·원자 cutover → positive/legacy negative 검증 → P3 별도 승인·검증 → P4 별도 승인·검증 → post-P4 legacy negative 재검증 → 최종 상태` 순서를 바꾸지 않는다. 앞선 승인은 뒤 단계 승인을 포함하지 않으며, 사용자의 명시적 운영 승인 전에 어느 DB 단계도 적용하거나 코드를 교체하지 않는다.

`--dry-run`은 코드 칸을 `******`로 가려 구조만 보여 준다. 반면 `--print-seed-sql`과 `--print-sync-sql`의 출력 전체는 접속코드가 든 **비밀 SQL packet**이다. 이 packet을 일반 terminal 출력, shell transcript, CI log, Git, `evaluation/` 증거에 남기지 않는다. 승인된 비밀 scratch에서 검토·적용한 뒤 조직의 비밀 폐기 절차를 따른다.

구형 개별 코드 helper인 `scripts/rotate-join-code.mjs`도 direct Supabase write 경로가 없고, 정확히 하나의 조 이름과 `--dry-run` 또는 `--print-sql` 중 하나가 없으면 종료코드 `2`로 중단한다. 정상 운영은 감사 기록이 남는 HQ RPC를 우선하며, `--print-sql` 출력이 꼭 필요한 비상 상황에도 별도 승인과 위 비밀 scratch·폐기 규칙을 그대로 적용한다.

## 3. 정상 운영

1. HQ 조작자는 `/hq`의 세션 제목·현재 열린 꼭지·활성 기기 수를 확인한다.
2. 상황 책임자가 다음 꼭지 개방을 승인한다.
3. HQ 조작자는 “기대 순번”을 읽고 개방한다. 이미 다른 조작자가 열었다면 충돌을 정상 상태로 보고 새 snapshot을 다시 읽는다.
4. 기록 담당은 시각, 조작자 역할, 대상 순번, 결과(`opened` 또는 `conflict`)만 기록한다. 토큰과 접속코드는 기록하지 않는다.
5. 조 화면의 새 꼭지 알림을 확인한다. 기존 입력은 자동으로 지우거나 다른 꼭지로 이동시키지 않는다.
6. 저장 충돌 시 서버 snapshot과 이 기기 내용을 나란히 보여 준다. 기본 동작은 서버 보존이며 강제 저장은 확인자 승인 뒤에만 한다.

### Canvas 익명 의견조사 운영 제한

`/v`의 모든 공개 QR 투표와 public ballot은 caller가 제공한 기기 식별자로 중복만 줄이는 **비구속 현장 조사**다. 개인별 1회 참여를 증명하지 못하므로 공식 의사결정, 정족수 또는 대표성 판단의 단독 근거로 사용하지 않는다. 조 모더레이터가 책임 아래 입력하는 대리 기록과도 별개다. Canvas 운영자는 `pending → active → closed` 순서로만 상태를 바꾸고, 마감 뒤 공개되는 집계만 참고 자료로 기록한다. ballot 응답은 ballot·조직·공론화·세션이 모두 active이고 hard expiry 전일 때만 수락하며, 마감과 제출은 같은 ballot 행 잠금으로 순서를 확정한다. 마감이 먼저 확정되면 대기하던 제출도 거부되는 것이 정상이다. 강한 1회용 개인 ballot capability가 필요한 공식 표결은 별도 개인정보·배포 설계와 운영 승인을 거쳐 후속 구현한다.

## 4. HQ와 비상 RPC

정상 경로는 `/hq`다. 화면이 열리지 않지만 Supabase RPC가 정상일 때만 아래 **비상 RPC**를 사용한다. 직접 `update`·`delete` SQL은 사용하지 않는다.

| 목적 | RPC | 필수 확인 |
|---|---|---|
| 현재 상태 | `workshop_hq_status(p_token, p_session_slug)` | 세션 slug, 현재 순번, 열린 꼭지 |
| 다음 꼭지 열기 | `workshop_hq_open_next_topic(p_token, p_session_slug, p_expected_ordinal, p_idempotency_key)` | 기대 순번, 새 멱등키, 확인자 |
| 꼭지 상태 변경 | `workshop_hq_set_topic_status(p_token, p_session_slug, p_topic_id, p_expected_status, p_status, p_idempotency_key)` | topic id, 기대 상태, 목표 상태 |
| 꼭지 마감 변경 | `workshop_hq_set_deadline(p_token, p_session_slug, p_topic_id, p_expected_deadline_at, p_deadline_at, p_idempotency_key)` | topic id, 기존 마감(CAS), 새 마감 또는 해제 `null` |
| 활성 기기 조회 | `workshop_hq_devices(p_token, p_session_slug)` | 조명, 기기 라벨, 마지막 사용 시각 |
| 토큰 폐기 | `workshop_hq_revoke_device(p_token, p_session_slug, p_token_hash, p_reason, p_idempotency_key)` | token hash, 사유, 영향받는 조 |
| 현재 조 기기 연결 종료 | `workshop_team_logout_v2(p_token)` | 서버가 `true`를 반환한 뒤에만 `/mod`의 로컬 토큰을 지운다. 실패하면 토큰을 유지하고 다시 시도한다. |
| 현재 HQ 기기 로그아웃 | `workshop_hq_logout_v2(p_token)` | 서버가 `true`를 반환한 뒤에만 브라우저의 로컬 토큰을 지운다. 실패하면 토큰을 유지하고 다시 시도한다. |
| 접속코드 전체 교체 | `workshop_hq_rotate_join_codes(p_token, p_session_slug, p_confirmation, p_idempotency_key)` | 확인 문자열 `ROTATE 0912-deliberation`, UUID 멱등키, 책임자 승인. 같은 세션의 기존 workshop·attendance 팀 토큰이 모두 폐기되는지 확인 |

비상 RPC 실행 규칙:

- HQ 토큰은 승인된 비밀 입력 경로로만 전달하고 명령행 인자·스크린샷·로그에 넣지 않는다.
- 멱등키는 조작 1건마다 새 UUID를 만들고 재시도할 때만 같은 값을 쓴다.
- `conflict`면 성공으로 바꾸려 재호출하지 않는다. 상태를 다시 읽고 새 승인을 받는다.
- 결과에는 RPC명, 대상의 비밀 아닌 식별자, 결과 상태, 실행·확인 역할만 남긴다.
- 접속코드 전체 교체 결과는 1회만 보인다. 승인된 오프라인 전달표에 옮긴 뒤 화면·클립보드를 닫는다.
- HQ 비밀번호 변경이 `current_password_incorrect` 또는 `rate_limited`를 반환하면 화면의 실패 안내를 그대로 보여 주고 성공으로 간주하지 않는다. 오답 기록은 예외 롤백으로 지우지 않으며, 짧은 시간 안의 다섯 번 실패 뒤 추가 시도는 잠긴다. 반복 시도하지 말고 상황 책임자에게 인계한다. 성공하면 해당 운영자 이름으로 발급된 모든 HQ 토큰이 즉시 폐기되므로 현재 기기와 다른 기기 모두 새 비밀번호로 다시 로그인한다.

## 5. 토큰 폐기

다음 경우 즉시 개별 **토큰 폐기**를 검토한다: 기기 분실, 화면 공유 중 권한 노출, 알 수 없는 세 번째 기기, 담당자 교대 후 공용 기기 미반납.

1. `workshop_hq_devices`로 조·기기 라벨·마지막 사용 시각을 대조한다.
2. 상황 책임자가 폐기 대상을 읽고 확인한다.
3. `workshop_hq_revoke_device`를 실행한다. 원문 토큰이 아니라 `token_hash`를 지정한다.
4. 해당 기기에서 `mod_session_get`이 거부되는지 확인한다.
5. 정상 기기 한 대가 계속 조회·저장 가능한지 확인한다.
6. 접속코드 자체가 노출됐으면 개별 폐기 뒤 전체 코드 교체를 별도 승인한다.

## 6. 백업

백업은 “파일이 생겼다”가 아니라 “읽을 수 있고 복원된다”까지가 완료다.

1. 승인된 운영 환경에서 snapshot workflow를 수동 실행한다. `cv_snapshot_now`·`cv_archive_round` 실행은 `service_role` 전용이며 서비스 역할 키와 HMAC 키는 비밀 저장소에서만 읽는다. 브라우저나 authenticated 사용자 세션에서 직접 실행하지 않는다.
2. 워크플로 산출물의 commit, run id, key id, snapshot id, HMAC 검증 결과를 기록한다.
3. 조별 산출물 보조 백업은 기존 읽기 전용 스크립트를 세션 인자와 함께 쓸 수 있다. 이름은 과거 날짜지만 `--session 0912-deliberation`을 반드시 명시한다.

   ```powershell
   $env:HQ_OPERATOR = Read-Host '운영자 표시 이름'
   $env:HQ_PASSWORD = Read-Host '본부 비밀번호'
   node scripts/backup-0829.mjs --session 0912-deliberation --out '..\10_작업산출물\2026-09-12_백업'
   Remove-Item Env:HQ_PASSWORD
   ```

4. `latest.json`의 session, captured time, checksum, 조·항목·최종제출 건수를 기록한다. 파일 내용에는 원문과 운영자 표시 이름이 있으므로 Git·공개 평가 산출물에 넣지 않는다.
5. 백업 실패가 이어지면 새 꼭지를 열지 않고 중단 기준으로 이동한다.

## 7. 복원 리허설

운영 DB에는 복원 리허설을 하지 않는다.

1. 백업 무결성을 `node automation/snapshot-db.mjs --verify <archive.json>`으로 확인한다.
2. `SNAPSHOT_RESTORE_DATABASE`를 임시 DB 이름으로 설정하고 `--prepare-restore-rehearsal`로 SQL을 만든다.
3. 네트워크가 격리된 임시 PostgreSQL 16 컨테이너에만 SQL을 실행한다.
4. 트리거·제약조건을 켠 상태에서 복원하고, 원본 counts와 복원 counts를 테이블별로 대조한다.
5. 결과 로그에 `restore_rehearsal_passed`, archive checksum, 컨테이너 이름, 실행 commit을 남긴다.
6. 임시 컨테이너를 폐기한다. 복원 SQL과 archive에 비밀이 없는지 확인한 뒤 승인된 보관 위치로 옮긴다.

CI의 `Rehearse signed snapshot restore in isolated PostgreSQL` 단계는 코드 경로의 회귀를 막는다. 행사 직전 실제 archive 복원 확인을 대신하지는 않는다.

### P2a 비상 rollback 안전선

P2a rollback은 구형 클라이언트를 살리는 대신 예측 가능한 접속코드 권한과 넓은 vote 접근을 의도적으로 다시 연다. 일반 migration 실행으로는 시작되지 않으며, 상황 책임자의 별도 승인·사고 참조번호·복구 종료시각을 먼저 기록한 뒤 같은 `psql` 연결에서 아래 두 설정을 하고 실행한다.

```sql
set climate_vote.emergency_rollback_ack = 'I_ACCEPT_LEGACY_ACCESS_REOPEN';
set climate_vote.emergency_rollback_incident = '승인된-사고-참조번호';
\i supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql
reset climate_vote.emergency_rollback_ack;
reset climate_vote.emergency_rollback_incident;
```

승인값이나 사고 참조번호가 없으면 rollback 파일은 첫 변경 전에 실패한다. rollback 직후에는 새 꼭지를 열지 않고 영향 시간을 기록하며, 정한 종료시각 안에 P2a를 재적용하고 `supabase/verify/platform_p2a_0912_token_only_activation.sql`을 다시 통과시킨다. 구형 권한이 열린 상태를 정상 운영이나 단순 검증 완료로 기록하지 않는다.

## 8. 중단 기준과 재개

아래 중 하나면 **새 꼭지 개방과 최종 제출을 중단**한다.

- 서로 다른 두 기기의 정상 저장이 경고 없이 덮어써진다.
- 서버 조회 실패 뒤 마지막 정상 입력이나 꼭지 목록이 화면에서 사라진다.
- 폐기한 토큰으로 조회·저장이 된다.
- 세 번째 활성 기기가 허용된다.
- 잘못된 세션 slug 또는 승인되지 않은 꼭지가 보인다.
- 최근 검증된 백업이 없거나 격리 복원이 실패한다.
- 운영 DB를 향한 합성 리허설 요청이 한 건이라도 관찰된다.
- `/hq` 조작 결과와 `/mod` 상태가 재조회 두 번 뒤에도 일치하지 않는다.
- 접근성 필수 과업에서 키보드 포커스가 갇히거나 오류·충돌 상태를 읽을 수 없다.

중단 시 조에는 “입력은 지우지 말고 현재 화면을 유지해 달라”고 안내한다. 기록 담당은 최초 시각·영향 범위·마지막 성공 조작을 적고, HQ 조작자는 상태 조회만 한다. 원인이 확인되고 합성 리허설·토큰·백업 gate가 다시 통과한 뒤 상황 책임자와 확인자가 함께 재개한다.

## 9. 종료와 증거

검증 도중 생성한 파일 때문에 후속 보고서의 `sourceTreeClean`이 거짓으로 바뀌지 않도록, JSON·로그는 먼저 저장소 밖의 임시 폴더에 만든다. 모든 검증이 끝난 뒤 비밀·개인정보가 없고 source commit과 clean 상태가 정확한지 확인한 승인본만 `evaluation/`에 한 번 반입한다. 예시는 다음과 같다.

```powershell
$evidenceDir = Join-Path $env:TEMP ("0912-evidence-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidenceDir | Out-Null
node scripts/verify-0912-readiness.mjs --output (Join-Path $evidenceDir '0912-13-traceability-report.json')
node scripts/verify-field-rehearsal.mjs --base http://127.0.0.1:4331 --report (Join-Path $evidenceDir '0912-13-field-rehearsal.json')
```

현장 리허설 JSON의 `screenshots`에는 절대 로컬 경로가 아니라 `.tmp-verify/rehearsal-*.png` 같은 저장소 기준 portable 경로만 기록한다. 스크린샷은 합성 화면만 포함하는지 확인한 뒤 별도 증거 묶음으로 보관한다. readiness/field CLI는 절대 출력 경로를 지원하며, 임시 폴더의 검증본을 반입하기 전에는 `evaluation/`을 쓰지 않는다.

- [ ] 마지막 꼭지 상태와 제출 건수를 저장하고 새 백업을 만든다.
- [ ] 격리 복원 결과를 확인한다.
- [ ] 행사 임시 기기 토큰을 폐기한다.
- [ ] 필요하면 접속코드를 교체한다.
- [ ] `evaluation/0912-13-readiness-report.template.json` 기반 실행 보고서에 실제 증거 경로를 채운다.
- [ ] `scripts/verify-0912-release-report.mjs`로 실행 보고서가 승인 source commit과 결합되어 있고 미실행 gate를 `ready`로 위장하지 않는지 확인한다.
- [ ] 운영일지에는 비밀·접속코드·원문 개인정보가 없는지 두 사람이 확인한다.
- [ ] 미실행, 실패, 차단 gate가 하나라도 있으면 `releaseDecision`을 `not_ready` 또는 `stopped`로 유지한다.
