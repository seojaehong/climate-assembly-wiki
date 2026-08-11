# 플랫폼 트랙 — 상태·병합 전 게이트

- 갱신: 2026-08-12
- 브랜치: `main`
- **백엔드 스키마와 프론트엔드는 2026-08-10 사용자 승인으로 프로덕션에 배포됨.** 기존 `/mod`·`/b`·`/hq`·`/v` 경로는 유지한다.

## ✅ 프로덕션 배포 (2026-08-10) — labor_money, 8/29 무영향
사용자 명시 승인 후 Management API 적용. P1·P2 적용(HTTP 201). anon 검증: result_get→200 null·issue_list/items→invalid join code·result_publish→hq 인증 요구(G2). 신규 테이블(org·membership·invitation·issue·issue_link·result_page)·RPC 존재 확인.
- **8/29 무영향 보장**: 순수 additive(신규 테이블·함수·nullable 컬럼, 기존 s1~s5 무변경) · P1 RLS 휴면(활성화 GRANT 미실행) · **issue_invalidate_guard 트리거는 submission_item에 부착 제외**(검수 단계 시작 시 부착) · p1b backfill/NOT NULL 미적용 · 기존 mod_join·ballot_list 정상 · 테스트 데이터 0건.
- 후속: (검수 시작 시) issue_invalidate_guard 트리거 부착 + 필요시 p1b backfill.

## ✅ 프론트엔드 라이브 배포 (2026-08-10) — climate-assembly.org
사용자 승인("지금 배포") 후 feat/deliberation-saas-platform → main fast-forward 머지(8034e0c..62aef0b)·push·배포 워크플로. 라이브 검증:
- **/platform → 200** (PlatformShell 아일랜드 로드), **/platform/o/... 딥링크 → 200**, **/r/* → 200** (SPA fallback: public/_redirects `/platform/*`·`/r/*` → 호스트 200 rewrite, 404 앞 배치).
- **★ 8/29 라우트 무영향**: /mod·/b·/hq·/v·/mod-help 전부 200.
- 프론트는 supabase.ts fallback=labor_money(커밋 .env 없음) → 방금 적용한 프로덕션 백엔드에 연결.
- /r SPA 호스트: getStaticPaths가 `/r/_/` 1개만 emit(실토큰 미열거). 클라이언트가 window.location에서 토큰 파싱.

## 런칭 상태 = 백엔드+프론트 프로덕션 배포·검증 완료
운영 온보딩(다음): Supabase Auth 운영자 계정 + membership 행 생성해야 /platform 콘솔 staff 경로 사용 가능(참여자·공개 결과는 무기명/토큰이라 즉시). 검수 단계 시작 시 issue_invalidate_guard 트리거 부착.

## 구현 완료 (코드 완성 · 빌드/테스트 통과)

플랜 **Phase 1(분석·검수·공개 파이프라인)** + Phase 2 스키마 토대까지:

| 슬라이스 | 산출물 | 커밋 |
|---|---|---|
| 빌드 스펙 | `docs/platform/BUILD_SPEC.md` (데이터 연결 대전제) | 6d5283b |
| P1 멀티테넌시 스키마 | org·membership·invitation + org 파생 헬퍼 + RLS | b020c84 |
| P2 분석·검수·공개 스키마 | issue·issue_link·result_page + 검수/공개 RPC + issue_items | 8b82150·62aabfc |
| 앱 스켈레톤 | 데이터 트리 네비(하드코딩 메뉴 없음)·Auth 경계·스코프 라우팅 | 2af1ce2 |
| 공개 결과 페이지 | `/r/<token>` 매트릭스·랭킹·4×6·표대체본·HITL | 2af1ce2 |
| 검수 콘솔 | 4×6 코딩·재분류·병합·미분류함 본문·게이트 | 62aabfc |

**최근 검증(2026-08-11):** 캔버스 쓰기·연결 집중 Vitest 35건, 플랫폼·결과 집중 Vitest 28건과 automation Vitest 186건 통과, Astro check 오류 0, Node20 정적 빌드 7,913페이지 통과. 전체 src·scripts Vitest 855건도 모두 통과하며, 0704 의제 보드 회귀 계약은 기본 선정 의제 4개와 `?view=all` 전체 후보 17개 모드를 각각 검증한다. 격리 정적 빌드에서 5경로를 데스크톱·모바일 두 뷰포트로 감사한 10개 케이스가 모두 통과했고 자동 위반·자동 판정 불가는 각각 0건이었다. 공개 결과 표의 모든 데이터 셀은 불투명 배경과 명시적 전경색을 사용해 대비 판정 근거를 고정한다. 수동 보조기술 평가 템플릿은 10개 케이스·40개 필수 검사를 정의하며 현재 40개 모두 `not_run`이라 전체 상태는 `needs_review`다. 커밋 `801a454183e650829b5d8462caadc621e732cc98`의 [test run 31474252428](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/31474252428)과 [접근성 run 31474252422](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/31474252422), Cloudflare Pages·Workers 배포가 성공한 뒤 사용자 도메인의 ResultView 자산을 12회 재확인했다. 이어 5개 표면×2개 뷰포트 10개 케이스를 다시 감사해 10/10 통과·자동 위반 0건·자동 판정 불가 0건을 기록했다. 두 추적 JSON은 clean 감사 소스의 commit을 `sourceCommit`으로 보존하지만 사용자 도메인이 배포 revision을 기계 판독 가능하게 노출하지 않으므로 원격 `targetRevision`은 `not_verified`로 구분한다. 격리 불변식(RPC org_id 미전달)은 유지한다.

**A4 추가 검증(2026-08-11):** 설계 청사진 집중 Vitest 21건, automation Vitest 191건과 전체 Vitest 57개 파일·868건이 통과했고 Astro check 오류는 0건(기존 hint 49건), Node 20 정적 빌드는 7,913페이지 통과했다. 실제 Chromium은 인증 fixture로 production `/platform` 셸을 연 뒤 공론화 선택→설계 탭 진입→2회차 입력→역전 날짜 거부→미리보기 생성·편집 즉시 무효화→JSON 다운로드를 실행했다. 이어 잘못된 JSON이 현재 초안을 덮어쓰지 않고 거부되는지, 내려받은 유효 JSON이 title·slug·두 회차의 날짜·주제·조별 인원 계층과 검증된 미리보기를 복원하는지, 복원 후 편집이 미리보기를 다시 무효화하는지 확인했다. 지연된 파일 읽기 중 발생한 최신 편집도 이전 import가 덮어쓰지 못하도록 generation 경합을 실제 브라우저에서 검증했다. 내려받은 파일은 입력 계층과 대조한 뒤 합계를 재계산하며 `dryRun:true`, `databaseMutationExecuted:false`, `requiresApproval:true`를 확인했다. production DB 접근·DB mutation 시도·브라우저 오류·fixture 누락은 모두 0건이었다. 로컬 working-tree 증거는 감사 대상 소스 트리 SHA-256과 Chromium 버전을 포함해 `evaluation/2026-08-11-platform-design-blueprint-browser.json`에 보존하며, 동일 검증은 platform accessibility CI에서 clean checkout 대상으로 재실행한다.

**M1 추가 검증(2026-08-12):** Canvas DB contract preflight 집중 Vitest 8건과 automation 전체 Vitest 17개 파일·199건이 통과했고 Astro check 오류는 0건(기존 hint 49건)이다. synthetic 구조 fixture로 column/type/FK/constraint·operation/role RLS·GRANT·realtime/replica identity·RPC 보안 패턴을 검증하지만, 정적 분석은 SQL 의미를 승인하지 않으며 항상 `not_ready`와 `verification.semantic_review_required`를 남긴다. 현재 저장소에서도 DB/API를 호출하지 않고 종료 코드 1을 반환한다. `evaluation/canvas-db-contract.json`은 source commit·대상 트리 SHA-256·20개 migration·blocker 54건을 보존한다. 이 working-tree 증거는 `sourceTreeClean:false`이며 migration 적용, live DB 상태 또는 M1 승인 완료 증거가 아니다.

**M3 추가 검증(2026-08-12):** Canvas bridge·검수 큐 seed 집중 Vitest 15건, automation 전체 18개 파일·205건, 전체 src·scripts Vitest 57개 파일·868건이 통과했다. Astro check는 오류 0건·기존 hint 49건이다. 첫 병렬 전체 실행에서 기존 Canvas browser 정상 케이스가 5초 제한을 넘겼지만 단독 재실행 3건과 automation 단독 전체 205건은 모두 통과했다. 검증은 local dry-run·plan/seed checksum fail-closed·source plan 재생성 대조·public 출력 거부·검수 선확정 차단·다회차 provenance를 포함하며 DB/API/migration 적용은 포함하지 않는다.

**M0 운영 표면 연결 검증(2026-08-12):** 진행자 라이브와 캔버스 상단에 공용 플랫폼 내비게이션을 연결해 라이브 입력·캔버스 작업대·온톨로지 검수 큐·온톨로지 그래프·그래프 사용설명서 5개 표면을 한 경로로 묶고 현재 위치를 `aria-current`로 표시한다. 안내 문구는 시민 발언과 논증 관계를 보존해 숙의·모더레이션을 지원하지만 회의의 결정을 대신하지 않는다는 경계를 명시한다. 실제 Chromium 읽기 전용 검증에서 캔버스 4개 노드 hydration, 작업대 1440×934, 라이브 초기화 완료와 안정화 이후의 오류·쓰기 차단, 라이브·캔버스 내비게이션 연결, 그래프·가이드 backing asset 2건, Supabase 예상 GET 3건을 확인했고 쓰기 요청·브라우저 오류는 0건이었다. 전체 src·scripts Vitest 58개 파일·870건, automation Vitest 18개 파일·205건과 Astro check 오류 0건(기존 hint 49건)이 통과했다. 이 결과는 로컬 working tree의 동작 증거이며 사용자 도메인 배포 확인은 push 뒤 별도 수행한다. `noindex`와 운영 메뉴는 접근통제가 아니므로 Auth 적용 전 live 입력은 계속 비식별 simulation·승인된 공개 가능 source에만 한정해야 한다. DB/API 데이터와 migration은 변경하지 않았다.

**M3/M4 로컬 검수 작업대 검증(2026-08-12):** 공용 운영 내비게이션에 `/ko/moderator/ontology-review/`를 추가하고 sealed Canvas review plan과 정확한 원 snapshot을 브라우저 메모리에서만 대조하는 사람 검수 화면을 연결했다. 실제 Chromium은 plan·snapshot 업로드, 비식별 역할 ID 입력, node 수정 승인과 node·relation·cluster 반려 plan 다운로드, 같은 node ID를 가진 새 plan 재로딩 때 이전 입력 제거, 두 번째 plan의 node 2건·relation 2건·cluster 1건 승인 및 다운로드를 완료했다. 사람 검수된 Claim의 Evidence, Proposal의 Condition, 고립된 Concern 연결이 빠졌을 때만 결론이 아닌 진행 보조 질문을 만들며 source session·node ID를 함께 표시한다. 실제 두 번째 plan에서는 조건 관계가 없는 Proposal 질문 1건의 화면 출현까지 확인했다. 결과의 canonical 검수 시각·snapshot 43 출처·원문·선택 역할·관계 유형·대표 Issue·검수자와 `databaseMutationExecuted:false`, `publicGraphWritten:false`를 확인했다. 같은 실행에서 DB 쓰기 요청과 브라우저 오류는 0건이었고 graph·guide backing asset도 각각 2xx였다. 전체 src·scripts Vitest 60개 파일·882건, automation Vitest 18개 파일·205건, Astro check 오류 0건(기존 hint 49건), Node 20 정적 빌드 7,914페이지가 통과했다. working-tree Chromium 증거는 `evaluation/2026-08-11-canvas-dev-browser-evidence.json`에 `sourceTreeClean:false`로 정직하게 기록했으며 clean checkout 재실행은 push 뒤 CI에서 확인한다. 이 화면과 `noindex`는 접근통제가 아니며 reviewer 인증, DB queue/RLS/RPC, migration, 공개 graph 반영은 여전히 미구현·승인 대상이다.

### Phase A 점진 구현 (2026-08-11)

**추가 실행 검증:** Canvas browser verifier Vitest 3건이 읽기 전용 정상 렌더, 비인증 드래그·쓰기 요청 차단, GitHub의 재현 가능한 Node 20 콜드 실행 계약을 검증했다. 루트 `package-lock.json`을 추적하고 Canvas 관련 변경 시 `npm ci` 뒤 강제 Astro 콜드 시작과 실제 브라우저 검증을 실행한다. 실제 Node 20 개발 서버의 비식별 증거 JSON과 스크린샷은 `evaluation/2026-08-11-canvas-dev-browser-evidence.json`과 `evaluation/2026-08-11-canvas-dev-browser.png`에 보존했다.

- **M1 Supabase contract preflight**: `automation/canvas-db-contract.mjs`가 production Canvas의 `session/participant/agenda/agenda_link/agenda_edit_log/rounds/attendance` operation과 attendance RPC를 20개 추적 migration의 최종 column/FK·RLS·operation/role policy·GRANT·realtime·SECURITY DEFINER 패턴과 읽기 전용으로 대조한다. 주석뿐인 SQL과 뒤 migration의 DROP/REVOKE/RLS disable을 증거로 세지 않고, matrix 밖 신규 table operation도 blocker로 만든다. 다만 정규식 기반 검사는 RLS/함수 본문 의미를 증명하지 않으므로 어떤 입력에도 M1 `ready`를 발급하지 않으며 `verification.semantic_review_required`를 유지한다. 6개 base table의 migration-owned 계약, 일부 attendance RPC의 explicit PUBLIC 회수, contract 사용자 승인, rollback SQL·stage rehearsal·role별 권한 테스트가 남아 있다. 정책·write failure·rollback 초안은 `docs/platform/CANVAS_DB_CONTRACT.md`에 분리했고 DB/API·환경변수·mutation은 사용하지 않았다. 이 진단은 live DB 부재나 M1 완료를 주장하지 않고, migration 작성·적용은 사용자 승인 뒤 별도 진행한다.
- **M2 캔버스 쓰기 안정화**: 진행자 캔버스의 이동·추가·보관·연결·편집·분류·투표·AI 보조·로그아웃 쓰기를 공통 결과 계약으로 감싸 실패를 로그와 화면 `alert`로 노출한다. 생성·연결·투표·변경 이력은 client-generated stable ID로 insert하고, `23505` 응답은 같은 ID의 저장 행을 다시 읽어 기대 payload 전체와 일치할 때만 기존 커밋 성공으로 인정한다. 본문 편집은 기존 text를 조건으로 UPDATE해 다른 진행자의 최신 편집을 덮지 않으며, UPDATE 성공 뒤 감사 기록이 실패하면 동일 audit ID로 감사 insert만 안전하게 이어간다. 이동·분류·부모 변경처럼 조건부 갱신이 아닌 쓰기는 응답 유실 뒤 저장 재시도를 제공하지 않고 현재 상태 새로고침으로 서버 정본을 재조정해 다른 진행자의 변경을 덮지 않는다. 동시 성공은 먼저 발생한 실패 알림을 덮지 않는다. 초기 snapshot과 realtime payload를 런타임 검증하고 malformed payload·조회 실패·channel 오류는 쓰기를 잠그는 연결 오류로 전환한다. 인증과 realtime이 모두 준비된 경우에만 드래그·연결·삭제·편집과 저장된 재시도를 허용한다. Astro·React·Tailwind 개발 통합을 공통 Vite 6 계열로 고정하고 JSON data island를 명시적 inline으로 분리한 뒤, Node 20 냉간 dependency scan과 실제 Chromium에서 CanvasBoard hydration·라이브 snapshot/realtime ready·로그인 전 비드래그 상태를 읽기 전용으로 확인했다. 본문 UPDATE와 변경 이력 INSERT는 현재 두 요청이어서 단일 DB transaction은 아니며, 브라우저가 종료되기 전에 화면 재시도를 완료해야 감사 기록이 복구된다. 이를 단일 원자 RPC로 바꾸는 migration은 별도 사용자 승인 대상이며, 이번 변경은 DB 스키마·데이터·권한을 직접 변경하지 않았다.
- **M3 온톨로지 검수 큐 계약·seed dry-run**: `docs/platform/ONTOLOGY_REVIEW_QUEUE_CONTRACT.md`가 batch/item/event/exclusion 후보 필드, 검수 상태 불변식, 조직 범위 RLS, 원자 seed·decision RPC와 rollback 순서를 draft로 고정한다. `canvas-ontology-bridge.mjs --seed-plan ... --output-seed ...`는 sealed review plan을 같은 snapshot 원본으로 먼저 검증한 뒤 node/relation/cluster와 제외 provenance를 future DB field의 local seed plan으로 정규화한다. batch source는 `canvas_snapshot`과 stable snapshot UID로 명시하고, 모든 item은 `proposed`로 시작해 source UID·nullable transcript chunk ID·cited UID·원 Canvas 관계·원문과 편집 text·moderator-only metadata·빈 reviewer/timestamp를 보존한다. seed는 canonical self-checksum을 포함하고 `--verify-seed`가 같은 snapshot·plan에서 재생성한 전체 내용까지 대조하지만 외부 서명·작성자 진위·승인 증거는 아니다. 출력은 public 경로를 거부하고 `dryRun:true`, `databaseMutationExecuted:false`, `requiresApproval:true`를 유지한다. 실제 migration/rollback SQL, table/RLS/RPC 적용, stage semantic test와 reviewer 인증은 사용자 승인 전이라 아직 만들거나 수행하지 않았다.
- **M4 Canvas→온톨로지 검수 브리지**: `automation/canvas-ontology-bridge.mjs`가 기존 snapshot JSON의 agenda·agenda_link를 로컬 검수 계획으로 변환한다. node kind·relation은 자동 확정하지 않고 모두 `proposed`로 시작하며 회차별 group과 action parent를 검수 메타데이터로 보존한다. 중복 ID·교차 회차·잘못된 부모·빈 활성 캔버스는 fail-closed하고, 보관 의제·연결은 `excluded`에 원 ID와 사유를 남긴다. 계획은 원 snapshot exact-byte SHA-256과 canonical self-checksum으로 우발 변경을 탐지한다. 검수자는 kind·relation 결정과 함께 표시 label/text를 다듬을 수 있고, 내부 export는 원문 SHA-256을 별도로 보존한다. 사람이 node·relation·cluster를 모두 승인/반려한 뒤에만 현재 workshop graph JSON 형식의 내부 export를 만들며, node는 `is_public:false`, meta는 별도 공개 검토 필요 상태를 유지한다. CLI는 저장소 전체 `public` 디렉터리 직접 출력을 거부하고 DB·API·환경변수에 접근하지 않는다. reviewer 인증·외부 서명·실제 공개 반영과 DB ontology 저장은 아직 포함하지 않는다.
- **M5 Graph DB 읽기 어댑터**: `/workshop-graph/`가 정적 `sources.json`을 필수 fallback으로 먼저 읽고, 선택적 DB catalog가 성공했을 때만 `review_state=approved`·`is_public=true` snapshot을 `DB` source로 추가하는 읽기 어댑터를 사용한다. DB catalog는 20초 timeout·1회 retry를 적용하고 row 수·node 역할/label·edge relation·ID·endpoint 관계가 잘못되거나 내부 node가 공개·사람 검수 상태가 아니면 catalog 전체를 fail-closed해 정적 source를 유지한다. query·credential·fragment가 포함된 endpoint도 요청 전에 거부한다. 선택 source의 실제 node/edge 수와 DB row 수를 표시하며 `cited`·`cited_uids`에 유효한 출처 ID가 없는 node는 advisory/footer에서 알린다. source 전환·polling은 generation guard로 늦은 응답을 폐기하고, 실패는 로그와 live 안내로 노출하며 마지막 정상 source 선택·URL·그래프를 유지한다. 현재 승인 graph snapshot table/RPC·공개 RLS가 없어 endpoint를 설정하지 않았고 정적 fallback만 활성 상태다. DB 계약 생성과 첫 live snapshot은 별도 사용자 승인 대상이다.
- **M6 권고 후보·품질 신호 연결**: `/workshop-graph/`가 `meta.recommendations`와 `meta.quality`를 strict 읽기 전용 모델로 정규화해 권고 후보와 품질 신호를 별도 표시한다. 권고는 명시적 `recommendation_candidate`·`draft`만 허용하고, 후보·소수 우려·품질 신호마다 출처 UID·전사 chunk ID·인용 UID를 서로 합치지 않고 보존한다. 화면은 “결정 아님”, “진실 판정 아님”, “사람 검수 필요”를 항상 표시하고 소수 우려와 각 provenance ID 목록을 별도로 펼쳐 볼 수 있다. 품질 label은 승인된 신호 종류만 허용하며, 모호한 기존 `quality` 내부 메모, 결정형 권고, 무출처·중복 ID·중복 출처·원문처럼 보이는 비 opaque ID는 자산 표시를 fail-closed하고 로그와 live advisory를 남기되 그래프 본체는 유지한다. 열린 보조 패널은 유효 자산 A→B 전환 때 즉시 새 자산으로 바뀌고, 자산이 없거나 형식이 틀리면 이전 보조 내용만 제거한다. 개요·고정 노드 상세처럼 보조 자산과 무관한 패널은 보존한다. 현재 추적 정적 payload에는 이 strict 계약을 만족하는 권고 후보가 없어 production 자산 버튼은 표시되지 않는다. provenance ID를 실제 원문 화면으로 연결하는 역링크는 승인된 ID→item 매핑이 없어 아직 구현하지 않았으며, 첫 실제 8/29 분석 산출 연결·사람 검수·DB 적재와 함께 별도 승인 뒤 진행한다. 브라우저 fixture 검증은 `evaluation/2026-08-11-workshop-graph-advisory-browser.json`에 기록했다.
- **분석코어→검수 계획 호환**: `platform-analysis-import.mjs`가 실제 Python 분석코어의 의도적으로 빈 recommendation title과 문자열형 minority 형상을 provenance map schema v2의 `candidateMappings`로 받는다. 사람이 준비한 후보·소수 우려 표시명과 소수 우려별 cited UID가 모두 있어야 하며 누락·중복·남는 index·소수 우려 원문 SHA-256 불일치는 fail-closed한다. source UID→전사 chunk→submission item/cluster 관계와 recommendation `time_span`은 plan provenance에 보존한다. CLI create/verify가 동일 원본 바이트 해시와 canonical plan을 다시 확인하며 출력은 계속 DB 미변경 dry-run·AI draft·사람 검수 필요 상태다. 실제 8/29 산출물과 ID 매핑은 행사 뒤 별도 승인 입력이 필요하다.
- **A1·A2 활성화 preflight**: `automation/platform-activation-preflight.mjs`가 DB 변경 없이 12개 NOT NULL 대상 테이블의 `org_id` 완전성과 권위 있는 상위 assembly/session/topic 조직 경로의 일치, 활성 조직별 관리자·HQ 역할, 활성 membership의 활성 조직 귀속과 이메일 확인 완료·비익명 Auth 사용자 존재, 다중 조직 사용자와 만료 전 미바인딩 HQ 세션을 집계한다. 출력은 비식별 count와 blocker만 남기며 `ready` 외 상태는 fail-closed한다. `ready`는 report 전체와 commit·정확한 script SHA-256·run/key ID를 외부 키 HMAC으로 결속하고, 검증 CLI가 현재 HEAD/hash·승인 host·HMAC·기본 10분 freshness를 다시 확인한다. 여러 요청을 합치는 읽기라 단일 transaction snapshot 증거는 아니며, 승인된 활성화 직전 쓰기 동결 상태에서 즉시 재실행해야 한다. 현재 `labor_money` 실측은 custom schema 원시 SELECT가 service role에도 닫혀 있어 `evaluation/platform-activation-preflight.json`에 `not_verified / read_access_unavailable`로 기록했다. 이는 데이터 준비 또는 Auth 활성화 완료 증거가 아니며, HMAC secret/key ID 설정·임의 GRANT·backfill·Auth 계정/membership 생성은 수행하지 않았다.
- **A4 승인 전 설계 청사진**: assembly 설계 화면에서 공론화 이름·slug와 여러 회차의 날짜·주제·조 수·예상 참여자 수를 로컬 React 상태로 작성한다. 순수 검증기는 실제 달력 날짜, 회차 순서, 주제 공백·중복, 양의 정수와 무인 조 발생을 fail-closed하고, 회차→주제·조 계층과 조별 계획 인원을 결정적으로 만든다. 검증된 결과만 `dryRun:true`, `databaseMutationExecuted:false`, `requiresApproval:true`가 포함된 JSON으로 미리보기·다운로드할 수 있으며, 같은 JSON을 다시 불러와 로컬 편집을 이어갈 수 있다. 가져오기는 크기·정확한 schema·승인 경계·계층·합계를 다시 검증하고 잘못된 파일은 기존 초안을 보존한 채 원문 비노출 오류로 거부한다. 브라우저 저장소·DB·RPC는 사용하지 않으며 실제 assembly/session/topic/team 생성과 재편집 가능한 서버 저장, 권한·동시성은 §5-4 결정과 DB 변경 승인 뒤 별도 구현한다.
- **A5 자동 감사 기반**: `automation/platform-accessibility-audit.mjs`가 실제 Chromium에서 axe-core WCAG 2.2 AA 태그, 건너뛰기 링크 포커스와 수평 넘침을 데스크톱 1440×1000·모바일 360×800 뷰포트로 검사한다. 플랫폼 로그인·인증 후 셸·접근성 성명·미공개/공개 결과 5경로의 사용자 도메인 증거는 `evaluation/platform-accessibility-audit.json`, 로컬 정적 빌드 10케이스 증거는 `evaluation/platform-accessibility-responsive-audit.json`에 분리해 저장한다. 두 보고서는 검사 checkout의 전체 commit과 감사 대상 경로의 clean 상태를 기록하고, 미커밋 source 또는 GitHub Actions commit과 실제 HEAD 불일치가 있으면 실패한다. 원격 배포 revision은 자동 증거와 분리해 `not_verified`로 보존한다. `.github/workflows/platform-accessibility.yml`은 관련 변경마다 동일한 2개 뷰포트 감사를 재실행한다.
- **A5 수동 평가 증거 게이트**: `evaluation/platform-accessibility-manual-evaluation.json`은 같은 5개 표면을 데스크톱·모바일 스크린리더 프로필로 평가하는 10개 케이스와 40개 필수 검사를 추적한다. `automation/platform-accessibility-manual-evidence.mjs`는 누락·중복·불완전 환경정보·설명 없는 실패를 거부하고, 모든 검사가 `pass`가 되기 전에는 `needs_review` 또는 `fail`을 유지한다. 현재는 실제 수동 평가 전이라 40개 모두 `not_run`이며 품질인증 완료를 주장하지 않는다.
- 인증 셸과 공개 결과는 실제 production 컴포넌트에 CI 전용 읽기 응답을 주입하고 readiness selector 도달을 필수로 한다. fixture 이름·준비 상태·axe `incomplete`·뷰포트·문서 폭을 JSON에 보존한다. 스크린리더·실제 모바일 보조기기 전수 수동평가와 공식 품질인증은 완료로 간주하지 않는다.
- **A7 XAI 산정 설명**: 공개 결과가 현재 스냅샷의 쟁점·미분류 원문·참여 조·합의 분모·HITL 검수 건수를 사용해 범위→집계→분류→검수 과정을 수치로 설명한다. 개별 원문 역링크와 이행추적은 공개 payload에 근거 데이터가 없어 완료로 간주하지 않으며, 데이터 계약과 DB 변경 승인 뒤 별도 구현한다.

## 병합 전 게이트

### ✅ G1. SQL 파싱·계약 검증 — 종료 (2026-08-09)
throwaway Postgres16(Docker)로 **실제 파싱 + 함수 본문 검증 + 계약 스모크 + negative** 전부 통과. 재현 하네스 `supabase/verify/`. 발견된 이식성 이슈 1건(P1 gen_random_bytes 미한정) 정정. 상세 `supabase/verify/README.md`.
- 남은 라이브 확인: 실제 Supabase(전용 DB/병합)에 적용 시 anon RPC 계약 재확인(`result_get`→200 null=적용됨).

### ✅ G2. publish 권한 상향 — 종료 (2026-08-09)
`result_publish`/`result_unpublish`를 조 join_code → **HQ 토큰(attendance scope='hq') 서명**으로 상향. 조 코드 publish 차단(컨테이너 검증: "attendance authorization required"), HQ 토큰만 성공(`published_by=hq:actor`). 플랜 §2-3 부합.
- Phase 2: HQ 공유비밀 → membership 인증 + `org_of_token` org 일치 검사 추가(현재 레거시 HQ 토큰은 org null 가능).

### ✅ 라이브 HTTP E2E — 통과 (2026-08-09)
PostgREST+JWT+RLS throwaway 스택으로 **플랫폼 UI 실 전송(supabase-js→PostgREST→RLS/RPC)** 재현. issue_upsert/items/link/review·**RLS 테넌트 격리(자기 org만)**·anon 401·**G2 조코드 거부/HQ토큰 성공**·result_get body(ResultView 계약 일치) 전부 통과. 상세 `supabase/verify/e2e_http.md`. **= "빌드된다"를 넘어 "실 HTTP로 돌아간다" 증명.**

### G3. org_id NOT NULL 전환 — 마이그레이션 작성됨
`platform_p1b_backfill.sql`(기본 org + backfill + NOT NULL). 단일 테넌트 가정. **데이터 있는 실 프로젝트 적용 시 실행**(빈 상태에선 NOT NULL만).

### 프로덕션 런칭 = 배포 행위 (구현 갭 아님)
전용 Supabase 프로젝트(사용자 계정) + Auth + Cloudflare SPA rewrite. **턴키 런북 `docs/platform/PROVISIONING.md`.** 스키마·RLS·파이프라인·보안은 검증 완료.

## Phase 2 진입 전 사용자 결정 (플랜 §5)

1. **테넌시 모델** — A row-level(권장) / B schema / C db-per-tenant (데이터 소재지 요건 시 C)
2. **Supabase Auth 범위** — 운영자·기관관리자만 vs 진행자까지 (참여자 무기명은 불변)
3. **HQ 공유비밀(`climate2026`) → membership 전환 시점** — Phase 2 선행조건(G2와 연동)
4. **셀프서비스 범위** — 완전 마법사(gongron급) vs 설계는 SQL·게이트만 UI (= 설계 마법사 Phase 3 착수 여부)
5. **호스팅·격리** — 단일 Supabase vs 기관별 분리
6. **플랫폼화 착수 자체** — Phase 1까지(vertical 완성) vs Phase 2+ 진행. 재사용 수요 확인 전제

## 보류 중 (결정 대기)

- **설계 마법사(Phase 3)**: 승인 전 로컬 청사진 작성·검증·JSON export·검증된 JSON 재개는 구현했다. 실제 assembly/session/topic/team 생성 RPC, 서버 저장·불러오기와 기관별 권한은 플랜상 Phase 2(tenancy) 이후이며 §5-4 결정과 DB 변경 승인이 필요하다.
- **분석코어 어댑터**: consensus/DQI 산출의 recommendation candidate와 minority concern을 `origin=ai`, `review_status=draft`인 검수 전용 import plan으로 변환하는 로컬 dry-run 어댑터를 구현했다. source UID를 기존 submission item UUID·cluster UUID에 매핑하고 누락·중복·무출처·스키마 불일치를 fail-closed하며 DB/API를 호출하지 않는다. schema version 2 계획은 두 입력 파일의 정확한 바이트 SHA-256과 canonical self-checksum을 포함하고, `--verify-plan`은 동일 입력으로 계획을 재생성해 불일치·우발 변경을 로컬에서 탐지한다. 외부 secret·서명이 없는 self-checksum이므로 작성자 진위나 의도적 재생성에 대한 tamper-evident 증거는 아니다. 실제 issue 적재(service_role), 8/29 산출물 첫 실행과 사람 검수는 별도 승인·실물 확보 후 진행한다.
- **라이브 프로비저닝**: 전용 DB + Supabase Auth + Cloudflare Pages SPA fallback rewrite(딥링크). 병합 결정 시.
- **A6 자동 export 훅**: 행사일 snapshot workflow에 승인 게이트와 off-DB Drive payload export 경로를 구현했다. repository variable `PLATFORM_SNAPSHOT_ENABLED`는 기본 `false`라 현재 동작과 Drive JSON 형상은 기존 `cv_snapshot_now` 그대로다. 승인 후 정확히 `true`로 켜면 기존 snapshot을 먼저 보존하고 `platform_snapshot_now` 행의 실제 payload를 재조회해 같은 Drive JSON에 담는다. 활성 export에는 GitHub run·commit·snapshot ID·key ID와 platform 행을 외부 secret 기반 HMAC-SHA256으로 결속한 audit manifest가 붙으며, 키·key ID·필수 provenance 누락 시 platform RPC 전에 실패한다. 과거 archive 검증을 위한 키 외부 백업·회전·폐기 절차와 `--verify`·`--rehearse` 읽기 전용 점검을 RUNBOOK에 고정했다. `--rehearse`는 서명·구조·건수에 더해 archive 내부 ID/FK·고유키·투표 문항 허용 척도와 필수 응답을 검사하고 복원 순서와 `org`·주제·조·회차·공론화 외부 부모의 중복 제거 건수만 출력하며 DB나 Drive를 읽거나 쓰지 않는다. `result_page`의 다형 scope도 topic/session/assembly별 부모 건수로 분리한다. 현재 payload에는 `org`, `discussion_topic`, `team`, `session`, `assembly` 부모 collection이 없어 이 결과는 독립 복원 완료가 아닌 `databaseRestoreExecuted: false` 복구 preflight다. 부모 collection을 snapshot 계약에 추가하는 DB 변경은 계속 사용자 승인 대상이다. `finalize-report`도 Drive archive를 pagination 포함 실측해 KST 행사 일정에서 만든 정확한 UTC timestamp 집합, 각 capture의 필수 페이지 파일 완비, capture/snapshot timestamp 유일성을 확인한 뒤 건수를 Sheets/Discord에 기록한다. 범위 밖 capture·빈 snapshot·5% 초과 누락·알림 실패는 fail-closed한다. 7·8·9·10월 정본 워크숍 5건은 capture·snapshot의 지원 가능한 5분 cron과 종료 4시간 뒤 finalize cron에 정확히 대응하며, automation source-contract 테스트가 세 workflow의 누락·시간 드리프트, 잘못된 날짜·시각·5분 비정렬, 정본 이름·round ID·날짜 중복/정렬과 finalize cron→concurrency/job 이름 매핑 누락을 차단한다. 각 시점이 별도 증거인 capture·snapshot은 concurrency coalescing을 사용하지 않고, finalize만 워크숍별 group으로 중복 대기 실행을 합친다. scheduled finalize는 cron의 연례 반복이 과거 워크숍을 다시 갱신하지 않도록 정본 KST 당일·다음 날만 허용하며 수동 명시 실행은 별도로 유지한다. Drive 부모 ID는 일정 파일 placeholder가 아니라 GitHub secret 한 곳에서만 주입한다. 동일 일자·워크숍 Sheets 행은 재실행 때 update한다. 회차별 정본 집계가 없는 최종 표 수는 0으로 과장하지 않고 `미집계`로 남긴다. 실행당 DB 행이 1개에서 2개로 늘기 때문에 secret 구성과 활성화 역시 계속 사용자 승인 대상이다. 실제 격리 DB 복원 rehearsal, PITR/WAL 설정과 사용자 행위용 별도 운영 감사로그는 아직 미구현이며, 기록 화면 CSV도 이를 대체하지 않는다.

## 다음 액션 (권장 순서)
1. Supabase Auth 운영자 계정과 membership을 승인된 운영 절차로 프로비저닝
2. §5 결정 1·2·3·4·6 — A1~A4 활성화 범위 확정
3. (승인 시) G3·RLS 활성화 GRANT·HQ membership 전환·자동 export 연결
4. 스크린리더·모바일 보조기기 수동 접근성 평가
5. 분석코어 어댑터 → 8/29 산출물로 검수 콘솔 첫 실전
